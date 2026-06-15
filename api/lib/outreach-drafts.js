const { createDraftEmail, recentSentEmailExamples, reengagementCandidates } = require("./gmail");
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
    rejectTerms: ["school", "university", "college", "tadika", "taska", "preschool", "kindergarten", "day care", "daycare", "admissions", "early years", "children", "childcare", "campus", ".edu"],
    requireTerms: ["corporate", "company", "berhad", "bhd", "sdn bhd", "group", "hr", "human resources", "csr", "esg", "sustainability", "employee", "foundation", "bank", "airports", "plantation", "property", "telekom", "insurance", "logistics", "manufacturing"],
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
    requireTerms: ["travel", "tour", "tourism", "agent", "gap", "volunteer abroad", "career break", "influencer", "media", "blog", "publisher", "magazine", "referral partner", "adventure", "expedition", "responsible tourism", "eco tourism", "ecotourism"],
    sentSearchTerms: ["travel", "volunteer", "Perhentian", "PTP", "PMRS", "PEEP", "collaboration", "partner"],
  },
  "re-engager": {
    name: "Re-engager",
    focus: "people Daniel has emailed who have not replied in the last month",
    offer: "a light reconnection email that follows the existing conversation and invites a simple reply",
    audienceNote: "Review the previous thread context. Do not pressure them, do not pretend there was a reply, and do not invent new facts.",
    sentSearchTerms: ["school", "CSR", "travel", "volunteer", "camp", "expedition", "collaboration", "Perhentian"],
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
  const email = cleanText(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return false;
  if (/[\/\\]/.test(email)) return false;
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|ico)$/i.test(email)) return false;
  if (email.includes("noreply") || email.includes("no-reply")) return false;
  return true;
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

function isStrictlyEligibleForProfile(profile, lead) {
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

  if (profile.name === "Corporate Outreach Finder") {
    return !/(school|university|college|tadika|taska|preschool|kindergarten|day care|daycare|admissions|campus|\.edu)/i.test(haystack)
      && /(corporate|company|berhad|bhd|sdn bhd|group|hr|human resources|csr|esg|sustainability|employee|foundation|bank|airports|plantation|property|telekom|insurance|logistics|manufacturing)/i.test(haystack);
  }

  if (profile.name === "Travel Outreach Finder") {
    return !/(school|university|college|tadika|taska|preschool|kindergarten|day care|daycare|admissions|campus|\.edu|berhad|bhd|sdn bhd|corporation|holdings|bank)/i.test(haystack)
      && /(travel|tour|tourism|travel agent|travel agency|volunteer travel|volunteer abroad|gap year|career break|responsible tourism|responsible travel|eco tourism|ecotourism|adventure travel|travel media|travel blog|publisher|directory|referral partner|collaboration partner|influencer)/i.test(haystack);
  }

  return true;
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
    .filter((lead) => !profile.segments || !profile.segments.length || segmentMatches(profile, lead.lead_segment))
    .filter((lead) => isValidEmail(lead.email))
    .filter((lead) => !isPreviouslyDrafted(lead))
    .filter((lead) => !isRejectedLead(profile, lead))
    .filter((lead) => satisfiesRequiredLeadTerms(profile, lead))
    .filter((lead) => isStrictlyEligibleForProfile(profile, lead))
    .map((lead) => ({ ...lead, _score: scoreLead(profile, lead) }))
    .filter((lead) => lead._score >= 25)
    .sort((a, b) => b._score - a._score || cleanText(a.organisation_name).localeCompare(cleanText(b.organisation_name)));

  return candidates.slice(0, limit);
}

function isOpenAiQuotaError(error) {
  return /insufficient_quota|exceeded your current quota|billing details/i.test(cleanText(error && error.message));
}

function isGmailReadScopeError(error) {
  return /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|insufficient permission|PERMISSION_DENIED/i.test(cleanText(error && error.message));
}

function summarizeError(error, maxLength = 360) {
  return truncateText(cleanText(error && error.message ? error.message : error), maxLength);
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

async function generateReengagementDraftPlans({ profile, candidates, runDate, limit }) {
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
            "You write short reconnection email drafts for Daniel at Fuze Ecoteer.",
            "Use only the supplied Gmail thread summaries. Do not invent replies, commitments, names, dates, or private facts.",
            "The recipient has not replied for at least one month. Be warm, light, practical and low-pressure.",
            "Each draft must be safe for Daniel to review before sending and must have one simple reply CTA.",
            "Return only valid JSON.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Run date in Kuala Lumpur: ${runDate}.`,
            `Task: write up to ${limit} reconnection email drafts.`,
            "Each body should be 80-150 words. Reference the earlier email topic only when the thread summary supports it.",
            "Use this signature exactly: Best,\\nDaniel\\nFuze Ecoteer",
            "Return a JSON array with exactly these keys per item: to, subject, body, lead_name, personalization_basis.",
            "Use only the email address from the candidate.to field for to.",
            "",
            "Candidates:",
            JSON.stringify(candidates, null, 2),
          ].join("\n"),
        },
      ],
      max_output_tokens: 7000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI re-engagement draft generation failed: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.output_text || (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");

  const jsonText = extractJson(text, "re-engagement draft");
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    throw new Error("Re-engagement draft response was not a JSON array");
  }
  return parsed;
}

function fallbackReengagementDraftPlans({ candidates }) {
  return candidates.map((candidate) => ({
    to: candidate.to,
    subject: candidate.subject && /^re:/i.test(candidate.subject) ? candidate.subject : `Re: ${candidate.subject || "Following up"}`,
    body: [
      "Hi,",
      "",
      "I wanted to gently follow up on my earlier email in case it got buried.",
      "",
      "No pressure at all, but if this is still relevant, would it be useful for me to send over a short outline or a couple of options to make it easier to review?",
      "",
      "Best,",
      "Daniel",
      "Fuze Ecoteer",
    ].join("\n"),
    lead_name: candidate.to,
    personalization_basis: "Previous sent email with no reply in the last month",
  }));
}

function plansForSelectedReengagementCandidates(plans, candidates) {
  const selectedEmails = new Set(candidates.map((candidate) => cleanText(candidate.to).toLowerCase()));
  const usablePlans = (Array.isArray(plans) ? plans : []).filter((plan) => {
    const to = cleanText(plan && plan.to).toLowerCase();
    return to && selectedEmails.has(to);
  });

  if (usablePlans.length >= candidates.length) return usablePlans;

  const plannedEmails = new Set(usablePlans.map((plan) => cleanText(plan.to).toLowerCase()));
  const missingCandidates = candidates.filter((candidate) => !plannedEmails.has(cleanText(candidate.to).toLowerCase()));
  return [...usablePlans, ...fallbackReengagementDraftPlans({ candidates: missingCandidates })];
}

function plansForSelectedLeads(plans, profile, leads) {
  const selectedEmails = new Set(leads.map((lead) => cleanText(lead.email).toLowerCase()));
  const usablePlans = (Array.isArray(plans) ? plans : []).filter((plan) => {
    const to = cleanText(plan && plan.to).toLowerCase();
    return to && selectedEmails.has(to);
  });

  if (usablePlans.length >= leads.length) return usablePlans;

  const plannedEmails = new Set(usablePlans.map((plan) => cleanText(plan.to).toLowerCase()));
  const missingLeads = leads.filter((lead) => !plannedEmails.has(cleanText(lead.email).toLowerCase()));
  return [...usablePlans, ...fallbackDraftPlans({ profile, leads: missingLeads })];
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
      ["order", "last_drafted_at.asc.nullsfirst,last_seen_at.desc.nullslast"],
      ["limit", "5000"],
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

  if (agentId === "re-engager") {
    let candidates;
    try {
      candidates = await reengagementCandidates({ olderThanDays: 30, newerThanDays: 730, maxResults: limit });
    } catch (error) {
      return {
        profile,
        selectedLeads: [],
        created: [],
        skipped: [`Could not scan Gmail sent threads for re-engagement candidates: ${summarizeError(error)}`],
        dryRun,
      };
    }

    if (!candidates.length) {
      return {
        profile,
        selectedLeads: [],
        created: [],
        skipped: ["No sent Gmail threads matched the re-engagement rule: last message from Daniel, older than one month, with no later reply. Draft-only outreach will not qualify until Daniel sends it, and brand-new sent emails will not qualify until they are at least one month old."],
        dryRun,
      };
    }

    if (dryRun) {
      return {
        profile,
        selectedLeads: candidates,
        created: [],
        skipped: [],
        dryRun,
      };
    }

    const skipped = [];
    let plans;
    try {
      plans = await generateReengagementDraftPlans({ profile, candidates, runDate, limit: candidates.length });
      plans = plansForSelectedReengagementCandidates(plans, candidates);
    } catch (error) {
      if (!isOpenAiQuotaError(error)) {
        skipped.push(`OpenAI re-engagement draft generation failed, so template drafts were used instead: ${summarizeError(error)}`);
      } else {
        skipped.push("OpenAI quota was exhausted, so simple template re-engagement drafts were created instead of AI-generated drafts.");
      }
      plans = fallbackReengagementDraftPlans({ candidates });
    }

    const created = [];
    for (const plan of plans.slice(0, limit)) {
      const to = cleanText(plan.to);
      const matchingCandidate = candidates.find((candidate) => candidate.to.toLowerCase() === to.toLowerCase());
      if (!isValidEmail(to) || !matchingCandidate) {
        skipped.push(`Skipped ${cleanText(plan.lead_name) || "unknown recipient"} because the generated recipient did not match a selected Gmail candidate.`);
        continue;
      }

      try {
        const draft = await createDraftEmail({
          to: [to],
          subject: cleanText(plan.subject).slice(0, 180) || `Re: ${matchingCandidate.subject || "Following up"}`,
          body: cleanText(plan.body),
        });
        created.push({
          draftId: draft.id,
          messageId: draft.message && draft.message.id,
          to,
          leadName: cleanText(plan.lead_name) || to,
          personalizationBasis: cleanText(plan.personalization_basis) || "No reply in the last month",
        });
      } catch (error) {
        skipped.push(`Could not create re-engagement draft for <${to}>: ${summarizeError(error)}`);
      }
    }

    if (!created.length && candidates.length) {
      throw new Error(`No Gmail re-engagement drafts were created. ${skipped.slice(-3).join(" ")}`);
    }

    return {
      profile,
      selectedLeads: candidates,
      created,
      skipped,
      dryRun,
    };
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
    if (isGmailReadScopeError(error)) {
      skipped.push("Could not load recent sent-email examples because Gmail read scope is not available. Draft creation can still continue.");
    } else {
      skipped.push(`Could not load recent sent-email examples: ${summarizeError(error)}`);
    }
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
    plans = plansForSelectedLeads(plans, profile, selectedLeads);
  } catch (error) {
    if (!isOpenAiQuotaError(error)) {
      skipped.push(`OpenAI outreach draft generation failed, so template drafts were used instead: ${summarizeError(error)}`);
    } else {
      skipped.push("OpenAI quota was exhausted, so CRM-based template drafts were created instead of AI-generated drafts.");
    }
    plans = fallbackDraftPlans({ profile, leads: selectedLeads });
  }

  const created = [];
  for (const plan of plans.slice(0, limit)) {
    const to = cleanText(plan.to);
    const matchingLead = selectedLeads.find((lead) => cleanText(lead.email).toLowerCase() === to.toLowerCase());
    if (!isValidEmail(to) || !matchingLead) {
      skipped.push(`Skipped ${cleanText(plan.lead_name) || "unknown lead"} because the generated recipient did not match a selected CRM lead.`);
      continue;
    }

    try {
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
    } catch (error) {
      skipped.push(`Could not create draft for ${matchingLead.organisation_name} <${to}>: ${summarizeError(error)}`);
    }
  }

  if (!created.length && selectedLeads.length) {
    throw new Error(`No Gmail drafts were created. ${skipped.slice(-3).join(" ")}`);
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
