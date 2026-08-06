#!/usr/bin/env node
const { selectRows, upsertRows } = require("../api/lib/supabase-admin");
const { sendEmail } = require("../api/lib/gmail");

const TABLE = "marketing_cold_email_leads";
const SEGMENTS = [
  ["School", "international school OR primary school OR secondary school OR school trips OR outdoor education"],
  ["Tadika / Preschool", "Malaysia preschool OR tadika OR taska OR kindergarten OR childcare"],
  ["University", "Malaysia university OR college OR study abroad OR faculty OR student volunteering"],
  ["Corporate HR / CSR", "Malaysia company CSR OR ESG OR sustainability OR employee volunteering OR corporate foundation"],
  ["Network / Referral Partner", "travel agency OR volunteer travel OR eco tourism OR responsible travel OR tour operator"],
];

function env(name) { if (!process.env[name]) throw new Error("Missing " + name); return process.env[name]; }
function text(v) { return String(v || "").trim(); }
function validEmail(v) {
  const e = text(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)
    && !/(example\.(com|org|net)|sentry\.io|noreply|no-reply|^test@|^sample@)/i.test(e);
}
function key(r) { return [text(r.lead_segment), text(r.organisation_name), text(r.country)].join("|").toLowerCase(); }
function parseJson(s) {
  const t = text(s).replace(/^\uFEFF/, "");
  const a = t.indexOf("["); const b = t.lastIndexOf("]");
  if (a < 0 || b <= a) throw new Error("No JSON array returned");
  return JSON.parse(t.slice(a, b + 1));
}
async function searchRows(segment, query, existing) {
  const prompt = [
    "Find genuinely new public organisations for Fuze Ecoteer outreach.",
    "Segment: " + segment,
    "Search terms: " + query,
    "Use public web search creatively: search engines, official websites, public social profiles, directories, chambers, tourism boards, school directories, association pages, PDFs, brochures, press releases, and contact pages.",
    "Return organisations worldwide, with extra priority for Malaysia where relevant. Prefer small and medium organisations, not famous repeated brands.",
    "For every organisation provide the official website and the exact source URL where it was found. Do not invent emails. Email may be null.",
    "Do not return any organisation already in this list: " + existing.join("; "),
    "Return JSON array only with keys: lead_segment, organisation_name, country, city, website, contact_department, contact_name, email, research_notes, likely_need, recommended_offer, personalization_angle, priority, next_action, source, confidence.",
    "Use the exact requested segment. Keep each field concise."
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+env("OPENAI_API_KEY")},
    body:JSON.stringify({
      model:process.env.OPENAI_MODEL||"gpt-5.4-mini",
      input:prompt,
      tools:[{type:"web_search_preview"}],
      max_output_tokens:6000
    })
  });
  const raw=await response.text();
  if(!response.ok) throw new Error("OpenAI "+response.status+" "+raw.slice(0,400));
  const out=JSON.parse(raw).output_text||"";
  return parseJson(out);
}
async function pageEmails(website) {
  const base=text(website).replace(/\/+$/,"");
  if(!base) return [];
  const urls=[base,base+"/contact",base+"/contact-us",base+"/about",base+"/about-us"];
  const found=new Set();
  for(const url of urls) {
    try {
      const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 FE-CRM-Research"}});
      if(!r.ok) continue;
      const html=await r.text();
      const matches=html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[];
      for(const e of matches.map(x=>x.toLowerCase()).filter(validEmail)) found.add(e);
      const mailtos=[...html.matchAll(/mailto:([^"'?\s>]+)/ig)].map(m=>decodeURIComponent(m[1]));
      for(const e of mailtos.filter(validEmail)) found.add(e);
    } catch (_) {}
  }
  return [...found];
}
function normalize(r, segment, runDate) {
  const website=text(r.website||r.url||r.link)||null;
  const email=validEmail(r.email)?text(r.email).toLowerCase():null;
  return {
    lead_segment:segment, organisation_name:text(r.organisation_name||r.organisation||r.company||r.name),
    country:text(r.country)||"Unknown", city:text(r.city)||null, website,
    contact_department:text(r.contact_department)||null, contact_name:text(r.contact_name)||null,
    email, linkedin_url:null, research_notes:text(r.research_notes)||null,
    likely_need:text(r.likely_need)||null, recommended_offer:text(r.recommended_offer)||null,
    personalization_angle:text(r.personalization_angle)||null, priority:text(r.priority)||"medium",
    status:"new", next_action:"Review evidence, then prepare approved outreach",
    source:text(r.source)||website, confidence:Number.isFinite(Number(r.confidence))?Number(r.confidence):null,
    run_date:runDate, last_seen_at:new Date().toISOString(), updated_at:new Date().toISOString()
  };
}
(async()=>{
  const runDate=new Date().toISOString().slice(0,10);
  const existing=await selectRows(TABLE, [["select","lead_segment,organisation_name,country,website,email,source,research_notes"],["limit","20000"]]);
  const existingKeys=new Set(existing.map(key));
  const existingNames=existing.map(r=>text(r.organisation_name)).filter(Boolean);
  const stats={generated:0,duplicates:0,invalid:0,inserted:0,emails:0,bySegment:{}};
  const candidates=[];
  for(const [segment,query] of SEGMENTS) {
    const before=candidates.length;
    try {
      const rows=await searchRows(segment,query,existingNames);
      stats.generated+=rows.length;
      for(const r of rows) {
        const n=normalize(r,segment,runDate);
        if(!n.organisation_name||!n.website){stats.invalid++;continue;}
        if(existingKeys.has(key(n))||candidates.some(x=>key(x)===key(n))){stats.duplicates++;continue;}
        candidates.push(n);
      }
    } catch(e) {
      stats.bySegment[segment]="ERROR: "+e.message;
    }
    stats.bySegment[segment]=stats.bySegment[segment]||{generated:candidates.length-before};
  }
  let scans=0;
  for(const row of candidates) {
    if(!row.email&&scans<Number(process.env.CRM_MAX_EMAIL_SCANS||250)) {
      scans++;
      const emails=await pageEmails(row.website);
      if(emails[0]) { row.email=emails[0]; row.research_notes=[row.research_notes,"Public email found on official page: "+emails[0]].filter(Boolean).join(" "); row.source=[row.source,row.website].filter(Boolean).join(" | "); }
    }
    if(row.email) stats.emails++;
  }
  if(candidates.length) {
    const saved=await upsertRows(TABLE,candidates,"lead_segment,organisation_name,country");
    stats.inserted=saved.length;
  }
  const body=[
    "CRM Discovery v2 completed","Date: "+runDate,"",
    "Generated: "+stats.generated,"New candidates: "+candidates.length,
    "Saved/upsert response: "+stats.inserted,"Duplicates rejected: "+stats.duplicates,
    "Invalid rows rejected: "+stats.invalid,"Verified public emails: "+stats.emails,
    "Official-page scans: "+scans,"","By segment:",JSON.stringify(stats.bySegment,null,2),
    "","No emails were sent to prospects."
  ].join("\n");
  console.log(body);
  if(process.env.CRM_REPORT_TO) await sendEmail({to:process.env.CRM_REPORT_TO,subject:"CRM Discovery v2 | "+runDate,body});
})().catch(e=>{console.error(e);process.exit(1);});
