const { createDraftEmail, recentSentEmailExamples } = require("./gmail");
const { selectRows, updateRows } = require("./supabase-admin");

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
    segments: ["School", "Tadika / Preschool", "Day care / Tadika / Taska", "University"],
    focus: "schools, taska, tadika, universities and education groups",
    countries: ["Malaysia", "Singapore", "Thailand", "Hong Kong", "Korea", "China", "Indonesia", "Japan"],
    offer: "Fuze Ecoteer school camps, student expeditions, service-learning trips and conservation education in Malaysia",
    audienceNote: "Focus first on Malaysia, Singapore, Thailand, Hong Kong, Korea and China. Include suitable global education leads when the fit is strong.",
    sentSearchTerms: ["school camp", "school camps", "expedition", "service learning", "student", "university", "outdoor education"],
  },
  "corporate-outreach-finder": {
    name: "Corporate Outreach Finder",
    segments: ["Corporate HR / CSR"],
    focus: "corporate HR, CSR, ESG, sustainability and employee engagement teams",
    countries: ["Malaysia"],
    locations: ["Kuala Lumpur", "KL", "Selangor", "Kelantan", "Terengganu", "Pahang"],
    offer: "Fuze Ecoteer corporate team building with a cause, ESG volunteering, CSR impact days and conservation-led employee engagement",
    audienceNote: "Focus on Kuala Lumpur and Selangor first, then Kelantan, Terengganu and Pahang.",
    sentSearchTerms: ["CSR", "ESG", "corporate", "team building", "employee engagement", "sustainability"],
  },
  "travel-outreach-finder": {
    name: "Travel Outreach Finder",
    segments: ["Network / Referral Partner"],
    focus: "travel websites, travel agents, volunteer travel platforms, gap-year companies, responsible tourism sites, travel media, career-break partners, influencers and collaboration partners",
    countries: ["Malaysia", "Singapore", "Thailand", "Hong Kong", "Korea", "China", "Indonesia", "Japan"],
    offer: "Fuze Ecoteer Perhentian volunteer conservation projects: PTP turtle conservation, PMRS marine research and PEEP eco education",
    audienceNote: "Do not use schools, universities, taska, tadika or day-care leads for this agent. Prioritize travel websites, travel agents, volunteer travel platforms, gap-year providers, responsible tourism publishers, travel media, career-break sites, influencers and referral/collaboration partners that can promote PTP, PMRS and PEEP.",
    rejectTerms: ["school", "university", "college", "tadika", "taska", "preschool", "kindergarten", "day care", "daycare"],
    requireTerms: ["travel", "tour", "tourism", "agent", "gap", "volunteer abroad", "career break", "influencer", "media", "blog", "website", "referral", "collaboration", "adventure", "expedition", "responsible tourism", "eco tourism", "ecotourism"],
    sentSearchTerms: ["travel", "volunteer", "Perhentian", "PTP", "PMRS", "PEEP", "collaboration", "partner"],
  },
};

const SEGMENT_ALIASES = {
  "Tadika / Preschool": ["Day care / Tadika / Taska", "Day care", "Taska", "Tadika", "Preschool", "Kindergarten"],
  "Day care / Tadika / Taska": ["Tadika / Preschool", "Day care", "Taska", "Tadika", "Preschool", "Kindergarten"],
  "Corporate HR / CSR": ["Corporate", "CSR", "ESG", "HR", "Sustainability"],
  "Network / Referral Partner": ["Travel / Tourism", "Travel Agent", "Referral Partner", "Influencer", "Career Services"],
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

function segmentMatches(profile, segment) {
  const normalizedSegment = cleanText(segment).toLowerCase();
  return profile.segments.some((profileSegment) => {
    const values = [profileSegment, ...(SEGMENT_ALIASES[profileSegment] || [])];
    return values.some((value) => cleanText(value).toLowerCase() === normalizedSegment);
  });
}

function isRejectedLead(profile, lead) {
  if (!profile.rejectTerms || !profile.rejectTerms.length) return false;
  const haystack = [
    lead.lead_segment,
    lead.organisation_name,
    lead.contact_department,
    lead.research_notes,
    lead.likely_need,
    lead.recommended_offer,
    lead.personalization_angle,
    lead.source,
    lead.website,
  ].join(" ").toLowerCase();
  return profile.rejectTerms.some((term) => haystack.includes(String(term).toLowerCase()));
}

function satisfiesRequiredLeadTerms(profile, lead) {
  if (!profile.requireTerms || !profile.requireTerms.length) return true;
  const haystack = [
    lead.lead_segment,
    lead.organisation_name,
    lead.contact_department,
    lead.research_notes,
    lead.likely_need,
    lead.recommended_offer,
    lead.personalization_angle,
    lead.source,
    lead.website,
  ].join(" ").toLowerCase();
  return profile.requireTerms.some((term) => haystack.includes(String(term).toLowerCase()));
}

function isPreviouslyDrafted(lead) {
  const status = cleanText(lead.status).toLowerCase();
  return Boolean(
    lead.last_drafted_at ||
    status.startsWith("drafted") ||
    status.includes("draft email made") ||
    status.includes("draft created")
  );
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

  if (segmentMatches(profile, lead.lead_segment)) score += 30;
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
    .filter((lead) => !isPreviouslyDrafted(lead))
    .filter((lead) => !isRejectedLead(profile, lead))
    .filter((lead) => satisfiesRequiredLeadTerms(profile, lead))
    .map((lead) => ({ ...lead, _score: scoreLead(profile, lead) }))
    .filter((lead) => lead._score >= 25)
    .sort((a, b) => b._score - a._score || cleanText(a.organisation_name).localeCompare(cleanText(b.organisation_name)));

  return candidates.slice(0, limit);
}

function isOpenAiQuotaError(error) {
  return /insufficient_quota|exceeded your current quota|billing details/i.test(cleanText(error && error.message));
}

function truncateText(value, maxLength = 260) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function fallbackSubject(profile, lead) {
  if (profile.name === "Education Outreach Finder") {
    return `School camp and expedition ideas for ${lead.organisation_name}`;
  }
  if (profile.name === "Corporate Outreach Finder") {
    return `CSR team building idea for ${lead.organisation_name}`;
  }
  return `Collaboration idea for ${lead.organisation_name}`;
}

function fallbackOpening(profile, lead) {
  const location = [lead.city, lead.country].map(cleanText).filter(Boolean).join(", ");
  const segment = cleanText(lead.lead_segment).toLowerCase();
  const context = truncateText(lead.personalization_angle || lead.research_notes || lead.likely_need || lead.recommended_offer, 240);
  const placeText = location ? ` in ${location}` : "";

  if (profile.name === "Education Outreach Finder") {
    return `I am reaching out because ${lead.organisation_name}${placeText} looks like a relevant fit for experiential education, school groups or student development. ${context || "Your organisation appears to serve learners who could benefit from structured outdoor, conservation and service-learning experiences."}`;
  }

  if (profile.name === "Corporate Outreach Finder") {
    return `I am reaching out because ${lead.organisation_name}${placeText} looks like a relevant fit for CSR, ESG or employee engagement work. ${context || "Your organisation appears to have teams who may value practical sustainability activities with a clear community and conservation angle."}`;
  }

  if (segment.includes("school") || segment.includes("university")) {
    return `I am reaching out because ${lead.organisation_name}${placeText} may be a good fit for student volunteering, conservation learning or referral partnerships. ${context || "Your audience seems aligned with structured, meaningful experiences in Malaysia."}`;
  }

  return `I am reaching out because ${lead.organisation_name}${placeText} looks like a possible collaboration partner for conservation travel, volunteer placements or responsible tourism. ${context || "Your audience may be interested in credible nature-based projects with a practical impact story."}`;
}

function fallbackOffer(profile) {
  if (profile.name === "Education Outreach Finder") {
    return "Fuze Ecoteer runs school camps, student expeditions and conservation education programmes connected to real field projects in Malaysia, including marine research, turtle conservation and eco education. We can shape the experience around learning outcomes, safety, logistics and group objectives.";
  }

  if (profile.name === "Corporate Outreach Finder") {
    return "Fuze Ecoteer runs corporate team building with a cause, CSR impact days and conservation-led employee engagement programmes. The aim is to give teams a useful shared experience while supporting practical environmental and community outcomes.";
  }

  return "Fuze Ecoteer runs three Perhentian conservation volunteer projects: PTP for turtle conservation, PMRS for marine research and PEEP for eco education. We are looking for thoughtful partners who can help suitable travellers, students or career explorers find these projects.";
}

function fallbackDraftPlans({ profile, leads }) {
  return leads.map((lead) => ({
    to: cleanText(lead.email),
    subject: fallbackSubject(profile, lead),
    body: [
      "Hi,",
      "",
      fallbackOpening(profile, lead),
      "",
      fallbackOffer(profile),
      "",
      "Would it be useful if I sent over a short outline of the programme options and how they could work for your audience or team?",
      "",
      "Best,",
      "Daniel",
      "Fuze Ecoteer",
    ].join("\n"),
    lead_name: cleanText(lead.organisation_name),
    personalization_basis: truncateText(lead.personalization_angle || lead.research_notes || lead.likely_need || "CRM segment and location match", 180),
  }));
}

async function generateDraftPlans({ profile, leads, researchRows, sentExamples, runDate, limit }) {
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
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
            "When sent email examples are provided, learn Daniel's tone, structure, phrasing, CTA style and level of specificity from those examples. Do not copy whole paragraphs verbatim.",
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
            "",
            "Recent sent-email examples from Daniel to learn style and improve these drafts:",
            JSON.stringify(sentExamples.slice(0, 6), null, 2),
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
      ["select", "id,lead_segment,organisation_name,country,city,website,contact_department,contact_name,email,linkedin_url,research_notes,likely_need,recommended_offer,personalization_angle,priority,status,next_action,source,confidence,run_date,last_seen_at,last_drafted_at,last_drafted_by_agent,last_draft_id,last_draft_message_id,draft_count"],
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

async function markLeadDrafted({ lead, profile, draft, runDate }) {
  const now = new Date().toISOString();
  const draftCount = Number.isFinite(Number(lead.draft_count)) ? Number(lead.draft_count) + 1 : 1;
  const values = {
    status: `drafted ${runDate} by ${profile.name}`,
    next_action: "Review Gmail draft before sending",
    last_drafted_at: now,
    last_drafted_by_agent: profile.name,
    last_draft_id: draft.id || null,
    last_draft_message_id: draft.message && draft.message.id ? draft.message.id : null,
    draft_count: draftCount,
    updated_at: now,
  };

  if (lead.id) {
    return updateRows("marketing_cold_email_leads", [["id", `eq.${lead.id}`]], values);
  }

  return updateRows("marketing_cold_email_leads", [
    ["lead_segment", `eq.${lead.lead_segment}`],
    ["organisation_name", `eq.${lead.organisation_name}`],
    ["country", `eq.${lead.country}`],
  ], values);
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

  const skipped = [];
  let plans;
  let sentExamples = [];
  try {
    sentExamples = await recentSentEmailExamples({
      queryTerms: profile.sentSearchTerms,
      days: 180,
      maxResults: 6,
    });
    if (!sentExamples.length) {
      skipped.push("No recent sent-email examples were found for this agent, so drafts used CRM and research context only.");
    }
  } catch (error) {
    skipped.push(`Could not load recent sent-email examples: ${error.message}`);
  }

  try {
    plans = await generateDraftPlans({
      profile,
      leads: selectedLeads,
      researchRows,
      sentExamples,
      runDate,
      limit: selectedLeads.length,
    });
  } catch (error) {
    if (!isOpenAiQuotaError(error)) {
      throw error;
    }
    plans = fallbackDraftPlans({ profile, leads: selectedLeads });
    skipped.push("OpenAI quota was exhausted, so CRM-based template drafts were created instead of AI-generated drafts.");
  }

  const created = [];
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
    await markLeadDrafted({ lead: matchingLead, profile, draft, runDate });
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
