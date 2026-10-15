#!/usr/bin/env node
const { selectRows, updateRows, upsertRows } = require("../api/lib/supabase-admin");
const { sendEmail } = require("../api/lib/gmail");

const TABLE = "marketing_cold_email_leads";
const SCHOOL_DIRECTORY_SOURCES = [
  ["Malaysia", "https://visit.doris.school/schools/malaysia"],
  ["United Kingdom", "https://visit.doris.school/schools/united-kingdom"],
  ["Japan", "https://visit.doris.school/schools/japan"],
  ["Hong Kong", "https://visit.doris.school/schools/hong-kong"],
  ["Singapore", "https://visit.doris.school/schools/singapore"],
  ["China", "https://visit.doris.school/schools/china"],
];
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
function organisationKey(r) { return [text(r.organisation_name), text(r.country)].join("|").toLowerCase(); }
function parseJson(s) {
  const t = text(s).replace(/^\uFEFF/, "");
  const direct = JSON.parse(t);
  if (Array.isArray(direct)) return direct;
  if (direct && Array.isArray(direct.rows)) return direct.rows;
  throw new Error("No JSON rows returned");
}
function classifyOrganisation(row, requestedSegment) {
  const haystack = [row.organisation_name, row.organisation, row.company, row.name,
    row.website, row.source, row.research_notes, row.likely_need].map(text).join(" ").toLowerCase();
  const school = /\b(school|academy|kindergarten|preschool|pre-school|tadika|taska|montessori|institute|lycee|lycée|international school|boarding school|prep school)\b/i.test(haystack);
  const university = /\b(university|universiti|college|faculty|campus)\b/i.test(haystack);
  const preschool = /\b(preschool|pre-school|kindergarten|tadika|taska|montessori|nursery|early years)\b/i.test(haystack);
  if (preschool) return "Tadika / Preschool";
  if (university) return "University";
  if (school) return "School";
  return requestedSegment;
}
async function searchRows(segment, query, existing) {
  const schoolDirectoryInstructions = segment === "School"
    ? [
        "Use these school-directory pages as required discovery sources:",
        ...SCHOOL_DIRECTORY_SOURCES.map(([country, url]) => `- ${country}: ${url}`),
        "Prioritize Malaysia and the United Kingdom first, and return at least 15 distinct schools from each of those two directories when the directory has enough entries. Then search Japan, Hong Kong, Singapore, and China for additional schools.",
        "Open the directory listings and follow each selected school's official website link. Use the school's own website as the organisation website and source URL wherever possible.",
        "For contact details, inspect only the school's official contact, admissions, partnerships, service-learning, outdoor-education, trips, geography, ecology, or staff pages. Prefer role addresses or publicly listed professional work emails; never infer addresses and never use parent/student personal data.",
        `Return up to ${process.env.CRM_SCHOOL_DIRECTORY_LIMIT || 100} genuinely different schools in this school batch, weighted toward Malaysia and the United Kingdom.`,
      ].join("\n")
    : "";
  const prompt = [
    "Find genuinely new public organisations for Fuze Ecoteer outreach.",
    "Segment: " + segment,
    "Search terms: " + query,
    "Use public web search creatively: search engines, official websites, public social profiles, directories, chambers, tourism boards, school directories, association pages, PDFs, brochures, press releases, and contact pages.",
    "Malaysia is the primary market. Search every run across Kuala Lumpur, Selangor, Perak and Ipoh, Penang, Melaka, Negeri Sembilan, Johor, Kedah, Kelantan, Terengganu, Pahang, Sabah, Sarawak, and Putrajaya. Use city/state-specific searches and include companies and schools in each area before expanding worldwide.",
    "For Malaysian companies search SMEs, manufacturers, hotels, tourism businesses, banks, professional firms, CSR/ESG teams, chambers and business directories. For schools search Malaysia plus Singapore, Hong Kong, Japan, Taiwan, and China as separate school markets.",
    "For schools in Singapore, Hong Kong, Japan, Taiwan, and China search international schools, private schools, primary and secondary schools, boarding schools, universities, Montessori/preschool groups, outdoor education providers, and school-trip or service-learning programmes. Use local country and city terms, English and local-language variants where useful.",
    "Also search schools across the Middle East and Europe, including UAE, Saudi Arabia, Qatar, Bahrain, Kuwait, Oman, Jordan, Turkey, France, Germany, Spain, Italy, Netherlands, Switzerland, Scandinavia, Ireland, and the United Kingdom.",
    "For the UK, prioritize independent/private schools, prep schools, boarding schools, public schools, academies, school groups, outdoor education departments, geography/ecology departments, and service-learning or overseas trip coordinators. Search by city, county, school association, and official school website.",
    schoolDirectoryInstructions,
    "Prefer small and medium organisations, not famous repeated brands.",
    "For every organisation provide the official website and the exact source URL where it was found. Do not invent emails. Email may be null.",
    "Do not return any organisation already in this list: " + existing.join("; "),
    "Return a JSON object with a rows array. Each row must use keys: lead_segment, organisation_name, country, city, website, contact_department, contact_name, email, research_notes, likely_need, recommended_offer, personalization_angle, priority, next_action, source, confidence.",
    "Use the exact requested segment. Keep each field concise."
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+env("OPENAI_API_KEY")},
    body:JSON.stringify({
      model:process.env.OPENAI_MODEL||"gpt-5.4-mini",
      input:prompt,
      tools:[{type:"web_search_preview"}],
      text:{format:{type:"json_schema",name:"crm_leads",strict:true,schema:{
        type:"object",additionalProperties:false,required:["rows"],properties:{
          rows:{type:"array",items:{type:"object",additionalProperties:false,
            required:["lead_segment","organisation_name","country","website","email","source"],
            properties:{
              lead_segment:{type:"string"},organisation_name:{type:"string"},country:{type:"string"},
              website:{type:["string","null"]},email:{type:["string","null"]},source:{type:["string","null"]}
            }
          }}
        }
      }}},
      max_output_tokens:16000
    })
  });
  const raw=await response.text();
  if(!response.ok) throw new Error("OpenAI "+response.status+" "+raw.slice(0,400));
  const parsed=JSON.parse(raw);
  const out=parsed.output_text || (parsed.output||[]).flatMap(item=>item.content||[]).map(item=>item.text||"").filter(Boolean).join("\n");
  if(!out) throw new Error("OpenAI returned no text output");
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
  const organisation_name=text(r.organisation_name||r.organisation||r.company||r.name);
  const finalSegment=classifyOrganisation({...r, organisation_name, website}, segment);
  return {
    lead_segment:finalSegment, organisation_name,
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
  const existing=await selectRows(TABLE, [["select","id,lead_segment,organisation_name,country,website,email,source,research_notes"],["limit","20000"]]);
  const existingKeys=new Set(existing.map(key));
  const existingNames=existing.map(r=>text(r.organisation_name)).filter(Boolean);
  const stats={generated:0,duplicates:0,reclassified:0,invalid:0,inserted:0,emails:0,bySegment:{}};
  const candidates=[];
  const existingByOrganisation=new Map(existing.filter(r=>r.id).map(r=>[organisationKey(r),r]));
  for(const [segment,query] of SEGMENTS) {
    const before=candidates.length;
    try {
      const rows=await searchRows(segment,query,existingNames);
      stats.generated+=rows.length;
      for(const r of rows) {
        const n=normalize(r,segment,runDate);
        if(!n.organisation_name||!n.website){stats.invalid++;continue;}
        const prior=existingByOrganisation.get(organisationKey(n));
        if(prior && text(prior.lead_segment)!==n.lead_segment) {
          const patch={lead_segment:n.lead_segment, updated_at:n.updated_at, last_seen_at:n.last_seen_at};
          if(n.website) patch.website=n.website;
          if(n.email) patch.email=n.email;
          await updateRows(TABLE, [["id","eq."+prior.id]], patch);
          existingByOrganisation.set(organisationKey(n), {...prior,...patch});
          stats.reclassified++;
          continue;
        }
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
      "Existing organisations reclassified: "+stats.reclassified,
    "Invalid rows rejected: "+stats.invalid,"Verified public emails: "+stats.emails,
    "Official-page scans: "+scans,"","By segment:",JSON.stringify(stats.bySegment,null,2),
    "","No emails were sent to prospects."
  ].join("\n");
  console.log(body);
  if(process.env.CRM_REPORT_TO) await sendEmail({to:process.env.CRM_REPORT_TO,subject:"CRM Discovery v2 | "+runDate,body});
})().catch(e=>{console.error(e);process.exit(1);});
