const { createDraftEmail } = require("./gmail");
const { selectRows } = require("./supabase-admin");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const AGENT_PROFILES = {
  "education-outreach-finder": {
    name: "Education Outreach Finder",
    segments: ["School", "Tadika / Preschool", "University"],
    focus: "schools, taska, tadika, universities and education groups",
    countries: ["Malaysia", "Singapore", "Thailand", "Hong Kong", "Korea", "China", "Indonesia", "Japan"],
    offer: "Fuze Ecoteer school camps, student expeditions, service-learning trips and conservation education in Malaysia",
    audienceNote: "Focus first on Malaysia, Singapore, Thailand, Hong Kong, Korea and China. Include suitable global education leads when the fit is strong.",
  },
  "corporate-outreach-finder": {
    name: "Corporate Outreach Finder",
    segments: ["Corporate HR / CSR"],
    focus: "corporate HR, CSR, ESG, sustainability and employee engagement teams",
    countries: ["Malaysia"],
    locations: ["Kuala Lumpur", "KL", "Selangor", "Kelantan", "Terengganu", "Pahang"],
    offer: "Fuze Ecoteer corporate team building with a cause, ESG volunteering, CSR impact days and conservation-led employee engagement",
    audienceNote: "Focus on Kuala Lumpur and Selangor first, then Kelantan, Terengganu and Pahang.",
  },
  "travel-outreach-finder": {
    name: "Travel Outreach Finder",
    segments: ["Network / Referral Partner", "School", "University"],
    focus: "travel agents, travel websites, career services, gap-year partners, influencers and collaboration partners",
    countries: ["Malaysia", "Singapore", "Thailand", "Hong Kong", "Korea", "China", "Indonesia", "Japan"],
    offer: "Fuze Ecoteer Perhentian volunteer conservation projects: PTP turtle conservation, PMRS marine research and PEEP eco education",
    audienceNote: "Look for partnership and referral angles that can promote PTP, PMRS and PEEP.",
  },
};

function cleanText(value) {
  return String(value || "").trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value));
}

function textIncludesAny(text, values = []) {
  const lower = cleanText(text).toLowerCase();
  return values.some((value) => lower.includes(String(value).toLowerCase()));
}

function scoreLead(profile, lead) {
  let score = 0;
  const haystack = [
    lead.lead_segment,
    lead.country,
    lead.city,
    lead.organisation_name,
    lead.contact_department,
    lead.research_notes,
    lead.likely_need,
    lead.recommended_offer,
    lead.personalization_angle,
    lead.priority,
  ].join(" ");

  if (profile.segments.includes(lead.lead_segment)) score += 30;
  if (profile.countries && textIncludesAny(lead.country, profile.countries)) score += 15;
  if (profile.locations && textIncludesAny(`${lead.country} ${lead.city} ${lead.research_notes}`, profile.locations)) score += 20;
  if (isValidEmail(lead.email)) score += 25;
  if (/priority a|priority b|high|strong/i.test(cleanText(lead.priority))) score += 10;
  if (textIncludesAny(haystack, profile.focus.split(/,\s*|\s+and\s+/))) score += 5;

  return score;
}

function pickLeads(profile, leads, limit) {
  const candidates = leads
    .filter((lead) => lead && cleanText(lead.organisation_name))
    .filter((lead) => isValidEmail(lead.email))
    .map((lead) => ({ ...lead, _score: scoreLead(profile, lead) }))
    .filter((lead) => lead._score >= 25)
    .sort((a, b) => b._score - a._score || cleanText(a.organisation_name).localeCompare(cleanText(b.organisation_name)));

  return candidates.slice(0, limit);
}

async function generateDraftPlans({ profile, leads, researchRows, runDate, limit }) {
  const model = process.env.OPENAI_MODEL || "gpt-5.4";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            "You write concise, practical B2B outreach email drafts for Fuze Ecoteer.",
            "Use only the provided CRM and market-research data. Do not invent private facts, recent events, personal names, job titles, or relationships.",
            "Each draft must be safe to review before sending: respectful, specific, not pushy, and with one clear reply CTA.",
            "Return only valid JSON.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Run date in Kuala Lumpur: ${runDate}.`,
            `Agent: ${profile.name}.`,
            `Task: write ${limit} personalized sales email drafts and save them as Gmail drafts later.`,
            `Audience focus: ${profile.focus}. ${profile.audienceNote}`,
            `Offer to promote: ${profile.offer}.`,
            "Tone: warm, commercial, short, credible, human. No fake familiarity. No invented case studies. Mention uncertainty only when needed.",
            "Each body should be 120-190 words, include a relevant first paragraph from the CRM notes, one short offer paragraph, and a simple CTA.",
            "Use this signature exactly: Best,\\nDaniel\\nFuze Ecoteer",
            "Return a JSON array with exactly these keys per item: to, subject, body, lead_name, personalization_basis.",
            "Use only the email address from the lead.email field for to.",
            "",
            "CRM leads:",
            JSON.stringify(leads, null, 2),
            "",
            "Market research context:",
            JSON.stringify(researchRows.slice(0, 25), null, 2),
          ].join("\n"),
        },
      ],
      max_output_tokens: 9000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI outreach draft generation failed: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.output_text || (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");

  const jsonText = extractJson(text, "outreach draft");
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    throw new Error("Outreach draft response was not a JSON array");
  }
  return parsed;
}

function extractJson(text, label) {
  const trimmed = cleanText(text);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) return match[1].trim();
  const first = trimmed.indexOf("[");
  const last = trimmed.lastIndexOf("]");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error(`No JSON array found in ${label} response`);
}

async function loadOutreachContext() {
  const [leads, researchRows] = await Promise.all([
    selectRows("marketing_cold_email_leads", [
      ["select", "lead_segment,organisation_name,country,city,website,contact_department,contact_name,email,linkedin_url,research_notes,likely_need,recommended_offer,personalization_angle,priority,status,source,confidence,last_seen_at"],
      ["order", "last_seen_at.desc.nullslast"],
      ["limit", "250"],
    ]),
    selectRows("marketing_research_rows", [
      ["select", "research_type,organisation,offer,visible_price,strength,risk,fe_response,target_market,category,source,confidence,country,location,current_score,trend,what_we_can_learn,how_we_are_better,recommended_action,run_date"],
      ["order", "last_seen_at.desc.nullslast"],
      ["limit", "60"],
    ]).catch(() => []),
  ]);

  return { leads, researchRows };
}

async function createOutreachDrafts({ agentId, runDate, limit = 10, dryRun = false } = {}) {
  const profile = AGENT_PROFILES[agentId];
  if (!profile) {
    throw new Error(`Unknown outreach draft agent: ${agentId}`);
  }

  const { leads, researchRows } = await loadOutreachContext();
  const selectedLeads = pickLeads(profile, leads, limit);
  if (!selectedLeads.length) {
    return {
      profile,
      selectedLeads: [],
      created: [],
      skipped: ["No CRM leads with usable public email addresses matched this agent."],
      dryRun,
    };
  }

  if (dryRun) {
    return {
      profile,
      selectedLeads,
      created: [],
      skipped: [],
      dryRun,
    };
  }

  const plans = await generateDraftPlans({
    profile,
    leads: selectedLeads,
    researchRows,
    runDate,
    limit: selectedLeads.length,
  });

  const created = [];
  const skipped = [];
  for (const plan of plans.slice(0, limit)) {
    const to = cleanText(plan.to);
    const matchingLead = selectedLeads.find((lead) => cleanText(lead.email).toLowerCase() === to.toLowerCase());
    if (!isValidEmail(to) || !matchingLead) {
      skipped.push(`Skipped ${cleanText(plan.lead_name) || "unknown lead"} because the generated recipient did not match a selected CRM lead.`);
      continue;
    }

    const draft = await createDraftEmail({
      to: [to],
      subject: cleanText(plan.subject).slice(0, 180) || `${profile.name} outreach`,
      body: cleanText(plan.body),
    });
    created.push({
      draftId: draft.id,
      messageId: draft.message && draft.message.id,
      to,
      leadName: cleanText(plan.lead_name) || matchingLead.organisation_name,
      personalizationBasis: cleanText(plan.personalization_basis),
    });
  }

  return {
    profile,
    selectedLeads,
    created,
    skipped,
    dryRun,
  };
}

module.exports = {
  AGENT_PROFILES,
  createOutreachDrafts,
};
