const fs = require("fs");
const path = require("path");
const { insertRows, selectRows, upsertRows } = require("./supabase-admin");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function extractJson(text, label) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) return match[1].trim();
  const first = trimmed.indexOf("[");
  const last = trimmed.lastIndexOf("]");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error(`No JSON array found in ${label} response`);
}

function extractTopLevelJsonObjects(candidate) {
  const text = cleanText(candidate);
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function tryParseJson(candidate) {
  try {
    return JSON.parse(candidate);
  } catch (_error) {
    return null;
  }
}

function parseJsonRows(text, label) {
  const candidate = extractJson(text, label);
  const direct = tryParseJson(candidate);
  if (Array.isArray(direct)) return direct;
  if (direct && Array.isArray(direct.rows)) return direct.rows;

  const repaired = [];
  for (const chunk of extractTopLevelJsonObjects(candidate)) {
    const parsed = tryParseJson(chunk);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      repaired.push(parsed);
    }
  }

  if (repaired.length) return repaired;
  throw new Error(`Could not parse usable JSON rows from ${label} response`);
}

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

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function replacePromptVars(template, replacements) {
  let rendered = cleanText(template).replace(/^\uFEFF/, "");
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(`\${${key}}`, value);
  }
  return rendered;
}

function normalizeBriefPrompt(brief, { runDate, limit }) {
  if (!cleanText(brief)) return "";
  const rendered = replacePromptVars(brief, {
    runDate: String(runDate || ""),
    limit: String(limit),
  });

  return rendered
    .split(/\r?\n/)
    .filter((line) => !line.includes("${brief.slice("))
    .join("\n")
    .trim();
}

const CRM_SEGMENTS = [
  "School",
  "Tadika / Preschool",
  "University",
  "Corporate HR / CSR",
  "Network / Referral Partner",
];

const CRM_SEGMENT_TARGET_DEFAULTS = {
  "School": 5000,
  "Tadika / Preschool": 5000,
  "University": 2500,
  "Corporate HR / CSR": 5000,
  "Network / Referral Partner": 5000,
};

const CRM_BATCH_SIZE = Math.max(10, Math.min(20, Number(process.env.CRM_BATCH_SIZE || 20) || 20));

function crmSegmentTargets() {
  return {
    "School": Math.max(0, Number(process.env.CRM_TARGET_SCHOOLS || CRM_SEGMENT_TARGET_DEFAULTS["School"]) || 0),
    "Tadika / Preschool": Math.max(0, Number(process.env.CRM_TARGET_PRESCHOOLS || CRM_SEGMENT_TARGET_DEFAULTS["Tadika / Preschool"]) || 0),
    "University": Math.max(0, Number(process.env.CRM_TARGET_UNIVERSITIES || CRM_SEGMENT_TARGET_DEFAULTS["University"]) || 0),
    "Corporate HR / CSR": Math.max(0, Number(process.env.CRM_TARGET_CORPORATES || CRM_SEGMENT_TARGET_DEFAULTS["Corporate HR / CSR"]) || 0),
    "Network / Referral Partner": Math.max(0, Number(process.env.CRM_TARGET_TRAVEL || CRM_SEGMENT_TARGET_DEFAULTS["Network / Referral Partner"]) || 0),
  };
}

function buildColdEmailSegmentPlan({ existingCounts = {}, maxNewRows = 0 }) {
  const safeLimit = Math.max(0, Number(maxNewRows) || 0);
  const targets = crmSegmentTargets();
  const deficits = CRM_SEGMENTS
    .map((segment) => ({
      segment,
      remaining: Math.max(0, Number(targets[segment] || 0) - Number(existingCounts[segment] || 0)),
    }))
    .filter((item) => item.remaining > 0);

  if (!deficits.length || safeLimit <= 0) {
    return [];
  }

  const plan = deficits.map((item) => ({ segment: item.segment, count: 0 }));
  let remainingBudget = safeLimit;
  while (remainingBudget > 0) {
    const open = deficits.filter((item) => item.remaining > 0);
    if (!open.length) break;
    for (const item of open) {
      if (remainingBudget <= 0) break;
      item.remaining -= 1;
      remainingBudget -= 1;
      const target = plan.find((entry) => entry.segment === item.segment);
      target.count += 1;
    }
  }

  return plan.filter((item) => item.count > 0);
}

function segmentSpecificPrompt(segment) {
  if (segment === "Network / Referral Partner") {
    return [
      "Return only travel, tourism, volunteer-travel, referral, publisher, influencer, media, collaboration or partnership leads.",
      "Do not include schools, universities, taska, tadika, daycare centres, preschools, education groups, or corporate HR / CSR leads.",
      "Prioritize real travel websites, travel agencies, volunteer travel platforms, gap-year companies, travel media, travel blogs, responsible tourism sites, eco-tourism directories, and collaboration partners that can promote PTP, PMRS and PEEP.",
      "If you cannot find a public email, still return the lead with email set to null.",
    ].join(" ");
  }
  if (segment === "Corporate HR / CSR") {
    return "Return only real corporate, CSR, ESG, HR, sustainability, foundation, or employee-engagement leads. Do not include schools, universities, or preschools.";
  }
  if (segment === "University") {
    return "Return only universities, colleges, faculties, departments, study-abroad offices, research groups, or higher-education programmes.";
  }
  if (segment === "Tadika / Preschool") {
    return "Return only preschools, taska, tadika, kindergartens, early-years centres, or daycare groups.";
  }
  return "Return only schools and school-group leads. Do not include universities, preschools, or corporates.";
}

const TRAVEL_REFERRAL_TERMS = [
  "travel",
  "tour",
  "tourism",
  "tour operator",
  "travel agency",
  "travel agent",
  "volunteer travel",
  "volunteer abroad",
  "gap year",
  "gap-year",
  "career break",
  "responsible tourism",
  "responsible travel",
  "eco tourism",
  "ecotourism",
  "adventure travel",
  "adventure",
  "expedition",
  "backpacker",
  "publisher",
  "media",
  "magazine",
  "blog",
  "travel blog",
  "directory",
  "referral partner",
  "collaboration partner",
  "influencer",
];

const EDUCATION_TERMS = [
  "school",
  "university",
  "college",
  "faculty",
  "campus",
  "tadika",
  "taska",
  "preschool",
  "kindergarten",
  "day care",
  "daycare",
  "admissions",
  ".edu",
];

const CORPORATE_TERMS = [
  "berhad",
  "bhd",
  "sdn bhd",
  "corporation",
  "corp",
  "group",
  "holdings",
  "foundation",
  "csr",
  "esg",
  "hr",
  "human resources",
  "sustainability",
  "employee engagement",
];

const UNIVERSITY_TERMS = [
  "university",
  "college",
  "faculty",
  "polytechnic",
  "campus",
  "higher education",
  "study abroad",
];

const PRESCHOOL_TERMS = [
  "tadika",
  "taska",
  "preschool",
  "pre-school",
  "kindergarten",
  "day care",
  "daycare",
  "early years",
  "nursery",
  "childcare",
];

const SCHOOL_TERMS = [
  "school",
  "international school",
  "secondary school",
  "primary school",
  "academy",
  "student trip",
  "school trip",
  "outdoor education",
];

const TRAVEL_REFERRAL_SEEDS = [
  {
    organisation_name: "GoAbroad",
    country: "United States",
    city: null,
    website: "https://www.goabroad.com/",
    source: "Seeded official website benchmark for travel / volunteer platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Projects Abroad",
    country: "United Kingdom",
    city: null,
    website: "https://www.projects-abroad.org/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "GoEco",
    country: "International",
    city: null,
    website: "https://www.goeco.org/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Kaya Responsible Travel",
    country: "United Kingdom",
    city: null,
    website: "https://www.kayavolunteer.com/",
    source: "Seeded official website benchmark for responsible travel / volunteer platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "WorkingAbroad",
    country: "International",
    city: null,
    website: "https://www.workingabroad.com/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "International Volunteer HQ",
    country: "New Zealand",
    city: null,
    website: "https://www.volunteerhq.org/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "GVI",
    country: "International",
    city: null,
    website: "https://www.gviworld.com/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Volunteer World",
    country: "Germany",
    city: null,
    website: "https://www.volunteerworld.com/",
    source: "Seeded official website benchmark for volunteer travel directory",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Go Overseas",
    country: "United States",
    city: null,
    website: "https://www.gooverseas.com/",
    source: "Seeded official website benchmark for travel and gap-year directory",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Love Volunteers",
    country: "New Zealand",
    city: null,
    website: "https://www.lovevolunteers.org/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Maximo Nivel",
    country: "United States",
    city: null,
    website: "https://maximonivel.com/",
    source: "Seeded official website benchmark for travel and volunteering platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Plan My Gap Year",
    country: "New Zealand",
    city: null,
    website: "https://www.planmygapyear.co.uk/",
    source: "Seeded official website benchmark for gap-year and volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Frontier",
    country: "United Kingdom",
    city: null,
    website: "https://www.frontiergap.com/",
    source: "Seeded official website benchmark for gap-year and conservation travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Global Nomadic",
    country: "United Kingdom",
    city: null,
    website: "https://globalnomadic.com/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Oyster Worldwide",
    country: "United Kingdom",
    city: null,
    website: "https://www.oysterworldwide.com/",
    source: "Seeded official website benchmark for gap-year and volunteering platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Grassroots Volunteering",
    country: "International",
    city: null,
    website: "https://www.grassrootsvolunteering.org/",
    source: "Seeded official website benchmark for volunteer travel directory",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Idealist",
    country: "United States",
    city: null,
    website: "https://www.idealist.org/",
    source: "Seeded official website benchmark for mission-driven opportunities directory",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Year Out Group",
    country: "United Kingdom",
    city: null,
    website: "https://yearoutgroup.org/",
    source: "Seeded official website benchmark for gap-year referral network",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Volunteer Forever",
    country: "United States",
    city: null,
    website: "https://www.volunteerforever.com/",
    source: "Seeded official website benchmark for volunteer travel publisher",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Transitions Abroad",
    country: "United States",
    city: null,
    website: "https://transitionsabroad.com/",
    source: "Seeded official website benchmark for meaningful travel publisher",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Responsible Travel",
    country: "United Kingdom",
    city: null,
    website: "https://www.responsibletravel.com/",
    source: "Seeded official website benchmark for responsible tourism publisher",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Travel Massive",
    country: "International",
    city: null,
    website: "https://www.travelmassive.com/",
    source: "Seeded official website benchmark for travel industry network",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Adventure Travel Trade Association",
    country: "United States",
    city: null,
    website: "https://www.adventuretravel.biz/",
    source: "Seeded official website benchmark for adventure travel network",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "TourRadar",
    country: "Austria",
    city: null,
    website: "https://www.tourradar.com/",
    source: "Seeded official website benchmark for tour marketplace",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Bookmundi",
    country: "Denmark",
    city: null,
    website: "https://www.bookmundi.com/",
    source: "Seeded official website benchmark for travel marketplace",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Evaneos",
    country: "France",
    city: null,
    website: "https://www.evaneos.com/",
    source: "Seeded official website benchmark for responsible travel marketplace",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "TourHero",
    country: "International",
    city: null,
    website: "https://www.tourhero.com/",
    source: "Seeded official website benchmark for creator-led travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Volunteer Latin America",
    country: "International",
    city: null,
    website: "https://www.volunteerlatinamerica.com/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Working Traveller",
    country: "International",
    city: null,
    website: "https://www.workingtraveller.com/",
    source: "Seeded official website benchmark for travel opportunity platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Conservation Travel Africa",
    country: "South Africa",
    city: null,
    website: "https://www.conservationtravelafrica.org/",
    source: "Seeded official website benchmark for conservation travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "VolunteerBase",
    country: "International",
    city: null,
    website: "https://www.volunteerbase.com/",
    source: "Seeded official website benchmark for volunteering directory",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Go Volunteer Africa",
    country: "Uganda",
    city: null,
    website: "https://www.govolunteerafrica.org/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Volunteer Southern Africa",
    country: "South Africa",
    city: null,
    website: "https://www.volunteersouthernafrica.org/",
    source: "Seeded official website benchmark for volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Volunteer Eco Students Abroad",
    country: "United States",
    city: null,
    website: "https://www.volunteereco.org/",
    source: "Seeded official website benchmark for eco-volunteer travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Greenloons",
    country: "United States",
    city: null,
    website: "https://www.greenloons.com/",
    source: "Seeded official website benchmark for responsible travel platform",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
  {
    organisation_name: "Volunteer Travellers",
    country: "International",
    city: null,
    website: "https://www.volunteertravellers.com/",
    source: "Seeded official website benchmark for volunteer travel publisher",
    recommended_offer: "PTP, PMRS, or PEEP collaboration",
  },
];

function dedupeRowsByKey(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [
      cleanText(row.lead_segment).toLowerCase(),
      cleanText(row.organisation_name).toLowerCase(),
      cleanText(row.country).toLowerCase(),
    ].join("|");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchExistingColdEmailLeadsSnapshot() {
  const rows = await selectAllColdEmailLeadRows();
  const counts = Object.fromEntries(CRM_SEGMENTS.map((segment) => [segment, 0]));
  const existingNames = Object.fromEntries(CRM_SEGMENTS.map((segment) => [segment, new Set()]));

  for (const row of rows) {
    const segment = cleanText(row.lead_segment);
    if (!counts[segment] && counts[segment] !== 0) continue;
    counts[segment] += 1;
    const name = cleanText(row.organisation_name);
    if (name) existingNames[segment].add(name);
  }

  return {
    rows,
    counts,
    existingNames: Object.fromEntries(
      Object.entries(existingNames).map(([segment, names]) => [segment, [...names]])
    ),
  };
}

async function selectAllColdEmailLeadRows() {
  return selectRows("marketing_cold_email_leads", [
    ["select", "lead_segment,organisation_name,country,email,last_drafted_at,status"],
    ["limit", "30000"],
  ]);
}

function existingOrgPrompt(existingNames = [], maxNames = 120) {
  const names = existingNames
    .map((name) => cleanText(name))
    .filter(Boolean)
    .slice(0, maxNames);
  if (!names.length) return "";
  return `Do not return these organisations because they are already in the CRM: ${names.join("; ")}.`;
}

function combinedLeadText(row) {
  return [
    cleanText(row.lead_segment || row.segment || row.type),
    cleanText(row.organisation_name || row.organisation || row.company || row.school || row.name),
    cleanText(row.country),
    cleanText(row.city || row.location),
    cleanText(row.website || row.url || row.link),
    cleanText(row.contact_department || row.department),
    cleanText(row.contact_name || row.contact),
    cleanText(row.research_notes || row.notes || row.background),
    cleanText(row.recommended_offer || row.offer),
    cleanText(row.personalization_angle || row.angle),
    cleanText(row.source || row.website || row.url || row.link),
  ].join(" ").toLowerCase();
}

function textHasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function isTravelReferralLead(row) {
  const text = combinedLeadText(row);
  const lowerSegment = cleanText(row.lead_segment).toLowerCase();
  const site = cleanText(row.website || row.url || row.link).toLowerCase();
  const org = cleanText(row.organisation_name || row.organisation || row.company || row.name).toLowerCase();
  const email = cleanText(row.email).toLowerCase();
  const contact = cleanText(row.contact_department || row.department || row.contact_name || row.contact).toLowerCase();

  if (textHasAny(text, EDUCATION_TERMS) || textHasAny(site, EDUCATION_TERMS) || textHasAny(org, EDUCATION_TERMS)) {
    return false;
  }
  if (textHasAny(text, CORPORATE_TERMS) && !textHasAny(text, TRAVEL_REFERRAL_TERMS)) {
    return false;
  }
  if (textHasAny(site, CORPORATE_TERMS) && !textHasAny(site, TRAVEL_REFERRAL_TERMS)) {
    return false;
  }
  if (textHasAny(contact, ["admissions", "principal", "kindergarten", "school"])) return false;

  const hasTravelEvidence =
    textHasAny(text, TRAVEL_REFERRAL_TERMS) ||
    textHasAny(site, TRAVEL_REFERRAL_TERMS) ||
    textHasAny(org, TRAVEL_REFERRAL_TERMS) ||
    textHasAny(contact, ["partnership", "travel", "media", "editor", "collaboration"]);

  if (lowerSegment.includes("travel") || lowerSegment.includes("referral") || lowerSegment.includes("partner")) return hasTravelEvidence;
  return hasTravelEvidence;
}

function isCorporateLead(row) {
  const text = combinedLeadText(row);
  return textHasAny(text, CORPORATE_TERMS) && !textHasAny(text, EDUCATION_TERMS);
}

function isUniversityLead(row) {
  return textHasAny(combinedLeadText(row), UNIVERSITY_TERMS);
}

function isPreschoolLead(row) {
  return textHasAny(combinedLeadText(row), PRESCHOOL_TERMS);
}

function isSchoolLead(row) {
  const text = combinedLeadText(row);
  return textHasAny(text, SCHOOL_TERMS) && !textHasAny(text, UNIVERSITY_TERMS) && !textHasAny(text, PRESCHOOL_TERMS);
}

function cleanConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.min(1, Math.max(0, numeric));
}

function cleanScore(value, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(max, Math.round(numeric)));
}

function compactDetails(fields) {
  return Object.entries(fields)
    .filter(([, value]) => cleanText(value))
    .map(([key, value]) => `${key}: ${cleanText(value)}`)
    .join(" | ");
}

function readAutomationBrief(name) {
  const directPath = process.env[`BRIEF_FILE_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`];
  const candidates = [
    directPath,
    path.join(process.cwd(), "prompts", `${name}.md`),
    path.join(process.cwd(), "prompts", `${name}.txt`),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, "utf8");
      }
    } catch (_error) {
      // ignore and continue to next candidate
    }
  }

  return "";
}

async function openAiResponsesJson({ system, prompt, label, maxOutputTokens = 4000, jsonSchema = null }) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: system }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    reasoning: { effort: "low" },
    max_output_tokens: maxOutputTokens,
  };

  if (jsonSchema && jsonSchema.name && jsonSchema.schema) {
    body.text = {
      format: {
        type: "json_schema",
        name: jsonSchema.name,
        schema: jsonSchema.schema,
      },
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI ${label} failed: ${JSON.stringify(payload)}`);
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const textParts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string" && content.text.trim()) {
        textParts.push(content.text.trim());
      }
    }
  }

  const merged = textParts.join("\n").trim();
  if (!merged) {
    throw new Error(`OpenAI ${label} returned no text output`);
  }
  return merged;
}

async function generateJsonRows({ system, prompt, label, maxOutputTokens = 4000, jsonSchema = null }) {
  const text = await openAiResponsesJson({ system, prompt, label, maxOutputTokens, jsonSchema });
  return parseJsonRows(text, label);
}

function crmLeadArraySchema() {
  return {
    name: "crm_lead_rows",
    schema: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "lead_segment",
          "organisation_name",
          "country",
          "city",
          "website",
          "contact_department",
          "contact_name",
          "email",
          "linkedin_url",
          "research_notes",
          "likely_need",
          "recommended_offer",
          "personalization_angle",
          "priority",
          "next_action",
          "source",
          "confidence",
        ],
        properties: {
          lead_segment: { type: "string" },
          organisation_name: { type: "string" },
          country: { type: "string" },
          city: { type: ["string", "null"] },
          website: { type: ["string", "null"] },
          contact_department: { type: ["string", "null"] },
          contact_name: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          linkedin_url: { type: ["string", "null"] },
          research_notes: { type: ["string", "null"] },
          likely_need: { type: ["string", "null"] },
          recommended_offer: { type: ["string", "null"] },
          personalization_angle: { type: ["string", "null"] },
          priority: { type: ["string", "null"] },
          next_action: { type: ["string", "null"] },
          source: { type: ["string", "null"] },
          confidence: { type: ["number", "null"] },
        },
      },
    },
  };
}

async function fetchPublicEmailCandidates(website) {
  const rootUrl = cleanText(website);
  if (!/^https?:\/\//i.test(rootUrl)) return [];

  const candidates = [];
  const urlsToTry = uniqueStrings([
    rootUrl,
    `${rootUrl.replace(/\/$/, "")}/contact`,
    `${rootUrl.replace(/\/$/, "")}/contact-us`,
    `${rootUrl.replace(/\/$/, "")}/about`,
    `${rootUrl.replace(/\/$/, "")}/about-us`,
  ]);

  for (const url of urlsToTry) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Codex Outreach Agent" } });
      if (!response.ok) continue;
      const html = await response.text();
      const matches = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
      for (const match of matches) {
        const email = cleanText(match).toLowerCase();
        if (isValidEmail(email)) candidates.push({ email, sourceUrl: url });
      }
    } catch (_error) {
      // best-effort only
    }
  }

  return candidates;
}

async function buildTravelReferralFallbackRows(runDate, neededCount = 0) {
  const fallbackRows = [];
  const limit = Math.max(0, Number(neededCount) || 0);
  const seeds = TRAVEL_REFERRAL_SEEDS.slice(0, limit || TRAVEL_REFERRAL_SEEDS.length);

  for (const seed of seeds) {
    const emailCandidates = await fetchPublicEmailCandidates(seed.website);
    const firstEmail = emailCandidates[0] || null;
    fallbackRows.push({
      lead_segment: "Network / Referral Partner",
      organisation_name: seed.organisation_name,
      country: seed.country,
      city: seed.city,
      website: seed.website,
      contact_department: "Partnerships / Enquiries",
      contact_name: null,
      email: firstEmail ? firstEmail.email : null,
      linkedin_url: null,
      research_notes: `${seed.organisation_name} is a travel / volunteer travel / responsible tourism platform relevant to referral partnerships for PTP, PMRS and PEEP.${firstEmail ? ` Public email found: ${firstEmail.email}.` : " No public email verified yet."}`,
      likely_need: "Fresh responsible travel or conservation programme partners for Asia listings and referrals",
      recommended_offer: seed.recommended_offer,
      personalization_angle: `${seed.organisation_name} already promotes travel or volunteer experiences, so a Perhentian conservation collaboration is a direct audience fit.`,
      priority: "Priority B - 80/100",
      next_action: "Review, verify contact route, then send tailored cold email",
      source: uniqueStrings([
        seed.source,
        ...emailCandidates.map((item) => item.sourceUrl),
      ]).join(" | "),
      confidence: firstEmail ? 0.82 : 0.68,
      run_date: runDate,
    });
  }

  return fallbackRows;
}

function fallbackMarketingResearchRows(runDate) {
  return [
    {
      research_type: "Competitor Analysis",
      organisation: "Mowgli Venture",
      offer: "Adventure, school, CSR and retreat packaging",
      visible_price: "Pricing not public",
      country: "Malaysia",
      location: "Malaysia",
      target_market: "Schools, corporates, adventure travellers",
      category: "Adventure and eco-tourism operators",
      source_url: "https://mowgliventure.com/",
      source: "https://mowgliventure.com/ | benchmark website",
      strength: "Clear audience segmentation for group experiences",
      risk: "Broader packaging for school and corporate buyers",
      fe_response: "Sharpen FE landing pages for schools, CSR and volunteer pathways",
      current_score: 82,
      rating_band: "Strong competitor",
      trend: "Benchmark leader",
      active_marketing_score: 34,
      momentum_score: 14,
      threat_level: "High",
      website_score: 12,
      social_score: 11,
      seo_aeo_score: 15,
      youtube_score: 4,
      cost_value_score: 6,
      logistics_score: 7,
      trust_score: 6,
      strategic_learning_score: 5,
      most_active_channel: "Website / Instagram",
      main_campaign_theme: "Adventure, schools, retreats",
      keyword_notes: "Targets adventure, camp, retreat and experiential group intent",
      aeo_notes: "Needs stronger direct answers but segmentation is clear",
      backlink_notes: "Benchmark backlink review still needed",
      social_notes: "Useful benchmark for audience-fit positioning",
      website_change_notes: "Treat as named benchmark for weekly watch",
      evidence_links: "https://mowgliventure.com/",
      what_we_can_learn: "Audience-specific landing pages outperform one generic offer page",
      how_we_are_better: "FE can lead on conservation authenticity if proof is shown clearly",
      recommended_action: "Build separate FE pages for schools, CSR, and volunteer audiences",
      confidence: 0.72,
    },
    {
      research_type: "Competitor Analysis",
      organisation: "TRACC",
      offer: "Marine conservation diving programmes",
      visible_price: "Pricing not public",
      country: "Malaysia",
      location: "Borneo / Malaysia",
      target_market: "Divers and marine conservation volunteers",
      category: "Scuba diving volunteering projects",
      source_url: "https://tracc.org/",
      source: "https://tracc.org/ | benchmark website",
      strength: "Strong niche fit around diving conservation",
      risk: "Can win specialist marine volunteer search intent",
      fe_response: "Clarify FE marine conservation pathways and dive-related logistics",
      current_score: 78,
      rating_band: "Strong competitor",
      trend: "Stable",
      active_marketing_score: 27,
      momentum_score: 11,
      threat_level: "High",
      website_score: 11,
      social_score: 9,
      seo_aeo_score: 14,
      youtube_score: 4,
      cost_value_score: 6,
      logistics_score: 6,
      trust_score: 7,
      strategic_learning_score: 4,
      most_active_channel: "Website",
      main_campaign_theme: "Marine conservation volunteering",
      keyword_notes: "marine conservation diving, scuba volunteer Malaysia",
      aeo_notes: "Needs direct answers on costs, certification and logistics",
      backlink_notes: "Marine niche links likely matter more than raw volume",
      social_notes: "Proof-led marine content likely converts better than generic eco copy",
      website_change_notes: "Monitor for changes to diving and reef pages",
      evidence_links: "https://tracc.org/",
      what_we_can_learn: "Specialist niche pages can dominate search intent even with smaller brands",
      how_we_are_better: "FE can package Perhentian-specific conservation story more clearly",
      recommended_action: "Build FE pages around Perhentian turtle, reef and volunteer outcomes",
      confidence: 0.68,
    },
    {
      research_type: "Competitor Analysis",
      organisation: "SEATRU",
      offer: "Sea turtle volunteering",
      visible_price: "Pricing not public",
      country: "Malaysia",
      location: "Malaysia",
      target_market: "Turtle volunteers and conservation supporters",
      category: "Turtle volunteering projects",
      source_url: "https://seatru.umt.edu.my/volunteer-registration-2/",
      source: "https://seatru.umt.edu.my/volunteer-registration-2/ | benchmark website",
      strength: "Clear turtle-conservation relevance and university affiliation",
      risk: "University credibility can improve trust for turtle-focused volunteers",
      fe_response: "Show stronger turtle project proof, impact and seasonal join details",
      current_score: 74,
      rating_band: "Moderate competitor",
      trend: "Stable",
      active_marketing_score: 19,
      momentum_score: 7,
      threat_level: "Medium",
      website_score: 10,
      social_score: 7,
      seo_aeo_score: 13,
      youtube_score: 2,
      cost_value_score: 5,
      logistics_score: 5,
      trust_score: 7,
      strategic_learning_score: 4,
      most_active_channel: "Website",
      main_campaign_theme: "Sea turtle volunteering",
      keyword_notes: "sea turtle volunteering Malaysia, turtle conservation volunteer",
      aeo_notes: "Add direct answers for season, location, price and volunteer tasks",
      backlink_notes: "University-linked authority may support trust",
      social_notes: "Lower activity but credibility still matters",
      website_change_notes: "Track volunteer-registration page changes each week",
      evidence_links: "https://seatru.umt.edu.my/volunteer-registration-2/",
      what_we_can_learn: "Academic credibility and turtle specificity strengthen trust quickly",
      how_we_are_better: "FE can show richer local logistics and volunteer storytelling",
      recommended_action: "Create stronger turtle FAQ and seasonal landing page",
      confidence: 0.66,
    },
    {
      research_type: "Competitor Analysis",
      organisation: "Biji-Biji Initiative",
      offer: "CSR and impact activities",
      visible_price: "Pricing not public",
      country: "Malaysia",
      location: "Kuala Lumpur",
      target_market: "Corporates and CSR buyers",
      category: "Corporate CSR activities in Malaysia",
      source_url: "https://www.biji-biji.com/",
      source: "https://www.biji-biji.com/ | benchmark website",
      strength: "Easy CSR positioning and corporate-friendly language",
      risk: "Can win CSR leads if FE business case is unclear",
      fe_response: "Build FE corporate page with outcomes, safety, logistics and reporting",
      current_score: 76,
      rating_band: "Strong competitor",
      trend: "Emerging threat",
      active_marketing_score: 29,
      momentum_score: 12,
      threat_level: "High",
      website_score: 11,
      social_score: 9,
      seo_aeo_score: 12,
      youtube_score: 3,
      cost_value_score: 6,
      logistics_score: 6,
      trust_score: 7,
      strategic_learning_score: 5,
      most_active_channel: "Website / LinkedIn",
      main_campaign_theme: "Corporate impact activities",
      keyword_notes: "CSR Malaysia, impact workshops, sustainability programmes",
      aeo_notes: "Needs strong answer blocks for team outcomes and logistics",
      backlink_notes: "Corporate partner proof matters more than sheer volume",
      social_notes: "LinkedIn-style messaging likely supports B2B credibility",
      website_change_notes: "Watch corporate offer and partnership proof",
      evidence_links: "https://www.biji-biji.com/",
      what_we_can_learn: "Corporate buyers respond to business-case clarity, not just mission",
      how_we_are_better: "FE can differentiate with field-based conservation delivery",
      recommended_action: "Publish FE CSR pages with itinerary, outcomes and proof",
      confidence: 0.7,
    },
    {
      research_type: "Price Comparison",
      organisation: "Market benchmark",
      offer: "Turtle Volunteer project",
      visible_price: "Research needed",
      country: "Malaysia / Southeast Asia",
      target_market: "Volunteer travellers",
      category: "Turtle Volunteer project",
      source: "Search phrases: sea turtle volunteering Malaysia, turtle conservation volunteer Southeast Asia",
      strength: "High-interest conservation niche",
      risk: "Competitors with clearer pricing and logistics can convert faster",
      fe_response: "Add exact inclusions, timing and proof to FE turtle pages",
      current_score: 64,
      rating_band: "Moderate competitor",
      trend: "Opportunity to beat",
      active_marketing_score: 20,
      momentum_score: 7,
      threat_level: "Medium",
      keyword_notes: "turtle volunteering Malaysia, turtle conservation volunteer Asia",
      aeo_notes: "Answer season, tasks, accommodation, food, transfers and cost",
      recommended_action: "Create FE turtle pricing comparison block and FAQ",
      confidence: 0.52,
    },
    {
      research_type: "Price Comparison",
      organisation: "Market benchmark",
      offer: "Diving volunteer project",
      visible_price: "Research needed",
      country: "Malaysia / Southeast Asia",
      target_market: "Divers and marine conservation volunteers",
      category: "Diving volunteer project",
      source: "Search phrases: scuba diving volunteer Malaysia, marine conservation diving volunteer Southeast Asia",
      strength: "Highly specific search intent with strong visual appeal",
      risk: "Dive-certification and cost questions can block enquiries if unclear",
      fe_response: "Clarify FE dive requirements, conservation tasks and logistics",
      current_score: 66,
      rating_band: "Moderate competitor",
      trend: "Opportunity to beat",
      active_marketing_score: 21,
      momentum_score: 8,
      threat_level: "Medium",
      keyword_notes: "scuba diving volunteer Malaysia, coral reef volunteer",
      aeo_notes: "Answer certification, safety, accommodation, meals, impact and price",
      recommended_action: "Publish a dive-specific FE landing page with clear answers",
      confidence: 0.52,
    },
    {
      research_type: "Price Comparison",
      organisation: "Market benchmark",
      offer: "3d2n eco package",
      visible_price: "Research needed",
      country: "Malaysia",
      target_market: "Short-break eco travellers",
      category: "3d2n eco package",
      source: "Search phrases: eco package Malaysia, conservation weekend Malaysia",
      strength: "Easier entry-point product for broader demand",
      risk: "Looks generic if conservation angle and itinerary are vague",
      fe_response: "Show exact itinerary, impact and inclusions",
      current_score: 58,
      rating_band: "Weak online presence",
      trend: "Opportunity to beat",
      active_marketing_score: 16,
      momentum_score: 5,
      threat_level: "Low",
      keyword_notes: "eco package Malaysia, responsible travel Malaysia",
      aeo_notes: "Answer inclusions, itinerary, transfer, meals and conservation value",
      recommended_action: "Create a sharper 3d2n FE package page with clear CTA",
      confidence: 0.48,
    },
    {
      research_type: "Price Comparison",
      organisation: "Market benchmark",
      offer: "Turtle necklace",
      visible_price: "Research needed",
      country: "Malaysia / online",
      target_market: "Supporters and gift buyers",
      category: "Turtle necklace",
      source: "Search phrases: turtle necklace conservation, wildlife gift conservation Malaysia",
      strength: "Good low-ticket supporter product if story is strong",
      risk: "Can feel generic without impact proof and design story",
      fe_response: "Tie product page to turtle conservation impact and gifting angle",
      current_score: 54,
      rating_band: "Weak online presence",
      trend: "Opportunity to beat",
      active_marketing_score: 14,
      momentum_score: 4,
      threat_level: "Low",
      keyword_notes: "turtle necklace, conservation gift, wildlife jewellery",
      aeo_notes: "Answer materials, impact, shipping and purpose",
      recommended_action: "Build product page with conservation proof, photos and FAQ",
      confidence: 0.45,
    },
    {
      research_type: "Price Comparison",
      organisation: "Market benchmark",
      offer: "School camp 5d4n",
      visible_price: "Research needed",
      country: "Malaysia / Southeast Asia",
      target_market: "Schools and international schools",
      category: "School camp 5d4n",
      source: "Search phrases: school camp Malaysia, outdoor education Malaysia, school service learning trips Asia",
      strength: "Schools need clear itinerary, safety, learning outcomes and supervision",
      risk: "Competitors can win if FE school pages are not ready",
      fe_response: "Build a 5d4n school camp page before heavy outreach",
      current_score: 62,
      rating_band: "Moderate competitor",
      trend: "Opportunity to beat",
      active_marketing_score: 18,
      momentum_score: 6,
      threat_level: "Medium",
      keyword_notes: "school camps Malaysia, outdoor education Malaysia, service learning trips Asia",
      aeo_notes: "Answer itinerary, age range, safeguarding, outcomes, accommodation, meals and price",
      recommended_action: "Create a complete school camp offer page and then feed it into the CRM outreach bot",
      confidence: 0.5,
    },
    {
      research_type: "Price Comparison",
      organisation: "Market benchmark",
      offer: "ESG/CSR related corporate programme",
      visible_price: "Research needed",
      country: "Malaysia",
      target_market: "Corporate HR, CSR and ESG teams",
      category: "ESG/CSR related corporate programme",
      source: "Search phrases: corporate volunteering Malaysia, CSR activities Malaysia, ESG team building Malaysia",
      strength: "Corporate buyers need business case, risk control, outcomes and reporting",
      risk: "Biji-Biji and CSR activity providers can take corporate leads",
      fe_response: "Create a corporate CSR landing page and LinkedIn content stream",
      current_score: 60,
      rating_band: "Moderate competitor",
      trend: "Emerging threat",
      active_marketing_score: 24,
      momentum_score: 9,
      threat_level: "High",
      keyword_notes: "corporate volunteering Malaysia, CSR activities Malaysia, ESG team building Malaysia",
      aeo_notes: "Answer team size, outcomes, reporting, safety, logistics, cost and impact",
      recommended_action: "Prioritise CSR offer page and weekly corporate prospect research",
      confidence: 0.5,
    },
  ].map((row) => ({ ...row, run_date: runDate }));
}

function normalizeMarketingResearch(row, runDate) {
  const researchType = cleanText(row.research_type || row.type);
  const currentScore = cleanScore(row.current_score || row.total_score);
  const activeMarketingScore = cleanScore(row.active_marketing_score, 50);
  const momentumScore = cleanScore(row.momentum_score, 20);
  const ratingBand = cleanText(row.rating_band);
  const trend = cleanText(row.trend || row.status_label);
  const threatLevel = cleanText(row.threat_level);
  const whatWeCanLearn = cleanText(row.what_we_can_learn || row.learning);
  const howWeAreBetter = cleanText(row.how_we_are_better || row.fe_advantage);
  const recommendedAction = cleanText(row.recommended_action || row.action || row.fe_response);
  const evidenceLinks = Array.isArray(row.evidence_links) ? row.evidence_links.join(" | ") : cleanText(row.evidence_links);
  const enrichment = compactDetails({
    current_score: currentScore,
    rating_band: ratingBand,
    trend,
    active_marketing_score: activeMarketingScore,
    momentum_score: momentumScore,
    threat_level: threatLevel,
    most_active_channel: cleanText(row.most_active_channel),
    main_campaign_theme: cleanText(row.main_campaign_theme),
    what_we_can_learn: whatWeCanLearn,
    how_we_are_better: howWeAreBetter,
    recommended_action: recommendedAction,
  });
  return {
    research_type: researchType === "Competitor Analysis" ? "Competitor Analysis" : "Price Comparison",
    organisation: cleanText(row.organisation || row.organisation_name || row.company || row.name),
    offer: cleanText(row.offer || row.programme || row.product),
    visible_price: cleanText(row.visible_price || row.price || row.pricing) || null,
    strength: cleanText(row.strength || row.main_strength) || null,
    risk: cleanText(row.risk || row.main_weakness || row.competitive_threat) || null,
    fe_response: [cleanText(row.fe_response || row.recommended_response), recommendedAction, enrichment].filter(Boolean).join(" | ") || null,
    target_market: cleanText(row.target_market || row.market) || null,
    category: cleanText(row.category || row.sub_category) || null,
    source_url: cleanText(row.source_url || row.website_url || row.url || row.link) || null,
    source: [cleanText(row.source || row.source_url || row.website_url || row.url || row.link), evidenceLinks].filter(Boolean).join(" | ") || null,
    confidence: cleanConfidence(row.confidence),
    country: cleanText(row.country) || null,
    location: cleanText(row.location || row.specific_location) || null,
    primary_audience: cleanText(row.primary_audience || row.target_audience) || null,
    cost_from: cleanText(row.cost_from || row.visible_price || row.price) || null,
    currency: cleanText(row.currency) || null,
    current_score: currentScore,
    rating_band: ratingBand || null,
    trend: trend || null,
    active_marketing_score: activeMarketingScore,
    momentum_score: momentumScore,
    threat_level: threatLevel || null,
    website_score: cleanScore(row.website_score, 15),
    social_score: cleanScore(row.social_score, 15),
    seo_aeo_score: cleanScore(row.seo_aeo_score, 20),
    youtube_score: cleanScore(row.youtube_score, 10),
    cost_value_score: cleanScore(row.cost_value_score, 10),
    logistics_score: cleanScore(row.logistics_score, 8),
    trust_score: cleanScore(row.trust_score, 7),
    strategic_learning_score: cleanScore(row.strategic_learning_score, 5),
    most_active_channel: cleanText(row.most_active_channel) || null,
    main_campaign_theme: cleanText(row.main_campaign_theme) || null,
    keyword_notes: cleanText(row.keyword_notes || row.keyword_analysis) || null,
    aeo_notes: cleanText(row.aeo_notes || row.aeo_analysis) || null,
    backlink_notes: cleanText(row.backlink_notes || row.backlink_analysis) || null,
    social_notes: cleanText(row.social_notes || row.social_media_notes) || null,
    website_change_notes: cleanText(row.website_change_notes || row.website_updates) || null,
    evidence_links: evidenceLinks || null,
    what_we_can_learn: whatWeCanLearn || null,
    how_we_are_better: howWeAreBetter || null,
    recommended_action: recommendedAction || null,
    run_date: runDate || null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function coreMarketingResearchRow(row) {
  return {
    research_type: row.research_type,
    organisation: row.organisation,
    offer: row.offer,
    visible_price: row.visible_price,
    strength: row.strength,
    risk: row.risk,
    fe_response: row.fe_response,
    target_market: row.target_market,
    category: row.category,
    source_url: row.source_url,
    source: row.source,
    confidence: row.confidence,
    run_date: row.run_date,
    last_seen_at: row.last_seen_at,
    updated_at: row.updated_at,
  };
}

function marketingSnapshotRow(row, runDate) {
  return {
    week_commencing: runDate || null,
    date_checked: runDate || null,
    organisation: row.organisation,
    research_type: row.research_type,
    category: row.category,
    website_score: row.website_score,
    social_score: row.social_score,
    seo_aeo_score: row.seo_aeo_score,
    youtube_score: row.youtube_score,
    cost_value_score: row.cost_value_score,
    logistics_score: row.logistics_score,
    trust_score: row.trust_score,
    active_marketing_score: row.active_marketing_score,
    strategic_learning_score: row.strategic_learning_score,
    total_score: row.current_score,
    momentum_score: row.momentum_score,
    status_label: row.trend,
    main_reason_for_movement: row.website_change_notes || row.recommended_action,
    evidence_links: row.evidence_links || row.source,
    analyst_comments: [row.what_we_can_learn, row.how_we_are_better, row.recommended_action].filter(Boolean).join(" | ") || null,
  };
}

function evidenceRowsFromResearch(rows, runDate) {
  return rows
    .filter((row) => row.evidence_links || row.source_url || row.source)
    .map((row) => ({
      evidence_date: runDate || null,
      organisation: row.organisation,
      evidence_type: row.research_type,
      url: row.source_url || row.source,
      observation: row.website_change_notes || row.social_notes || row.keyword_notes || row.strength || row.risk,
      why_it_matters: row.what_we_can_learn || row.how_we_are_better,
      action_for_us: row.recommended_action || row.fe_response,
    }));
}

async function upsertMarketingResearchRows(rows) {
  try {
    return await upsertRows("marketing_research_rows", rows, "research_type,organisation,offer");
  } catch (error) {
    if (!/column|schema cache|Could not find/i.test(error.message)) throw error;
    console.warn(`Rich marketing research upsert failed, retrying core fields only: ${error.message}`);
    return upsertRows("marketing_research_rows", rows.map(coreMarketingResearchRow), "research_type,organisation,offer");
  }
}

async function insertOptional(table, rows) {
  try {
    return await insertRows(table, rows);
  } catch (error) {
    if (!/not find|schema cache|does not exist|relation/i.test(error.message)) throw error;
    console.warn(`Optional table ${table} not available yet: ${error.message}`);
    return [];
  }
}

function normalizeColdEmailLead(row, runDate) {
  const rawSegment = cleanText(row.lead_segment || row.segment || row.type);
  const lowerSegment = rawSegment.toLowerCase();
  const segmentHintTravelTerms = [
    "network",
    "referral",
    "partner",
    "chamber",
    "association",
    ...TRAVEL_REFERRAL_TERMS,
  ];
  const segment = lowerSegment.includes("corporate") || lowerSegment.includes("csr") || lowerSegment.includes("esg")
    ? "Corporate HR / CSR"
    : lowerSegment.includes("university") || lowerSegment.includes("college") || lowerSegment.includes("faculty")
      ? "University"
      : segmentHintTravelTerms.some((term) => lowerSegment.includes(term))
        ? "Network / Referral Partner"
        : lowerSegment.includes("day") || lowerSegment.includes("tadika") || lowerSegment.includes("taska") || lowerSegment.includes("preschool") || lowerSegment.includes("kindergarten")
          ? "Tadika / Preschool"
          : "School";

  const cleanedEmail = cleanText(row.email).toLowerCase();
  const evidenceText = [
    cleanText(row.research_notes || row.notes || row.background),
    cleanText(row.source || row.website || row.url || row.link),
    cleanText(row.contact_department || row.department),
    cleanText(row.contact_name || row.contact),
  ].join(" ").toLowerCase();
  const websiteHost = cleanText(row.website || row.url || row.link)
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase()
    .replace(/^www\./, "");
  const emailDomain = cleanedEmail.includes("@") ? cleanedEmail.split("@")[1] : "";
  const looksGenericRole = /^(info|hello|contact|enquiry|inquiry|admissions|admission|hr|careers|jobs|corporate|csr|esg|team|office|admin|partnerships?|media|marketing|sales|support|reservations?)@/i.test(cleanedEmail);
  const websiteMatchesEmailDomain = websiteHost && emailDomain && (emailDomain === websiteHost || emailDomain.endsWith(`.${websiteHost}`) || websiteHost.endsWith(`.${emailDomain}`));
  const emailHasEvidence = cleanedEmail && evidenceText.includes(cleanedEmail);
  const safeEmail = isValidEmail(cleanedEmail) && (emailHasEvidence || (websiteMatchesEmailDomain && looksGenericRole))
    ? cleanedEmail
    : null;
  const sourceValues = uniqueStrings([
    cleanText(row.source || row.website || row.url || row.link) || null,
    safeEmail ? `public email verified: ${safeEmail}` : null,
  ]);

  if (segment === "Network / Referral Partner" && !isTravelReferralLead({
    ...row,
    lead_segment: segment,
    email: safeEmail,
    source: sourceValues.join(" | ") || cleanText(row.source || row.website || row.url || row.link),
  })) {
    return null;
  }

  if (segment === "Corporate HR / CSR" && !isCorporateLead({ ...row, lead_segment: segment })) {
    return null;
  }

  if (segment === "University" && !isUniversityLead({ ...row, lead_segment: segment })) {
    return null;
  }

  if (segment === "Tadika / Preschool" && !isPreschoolLead({ ...row, lead_segment: segment })) {
    return null;
  }

  if (segment === "School" && !isSchoolLead({ ...row, lead_segment: segment })) {
    return null;
  }

  return {
    lead_segment: segment,
    organisation_name: cleanText(row.organisation_name || row.organisation || row.company || row.school || row.name),
    country: cleanText(row.country),
    city: cleanText(row.city || row.location) || null,
    website: cleanText(row.website || row.url || row.link) || null,
    contact_department: cleanText(row.contact_department || row.department) || null,
    contact_name: cleanText(row.contact_name || row.contact) || null,
    email: safeEmail,
    linkedin_url: cleanText(row.linkedin_url || row.linkedin) || null,
    research_notes: cleanText(row.research_notes || row.notes || row.background) || null,
    likely_need: cleanText(row.likely_need || row.need) || null,
    recommended_offer: cleanText(row.recommended_offer || row.offer) || null,
    personalization_angle: cleanText(row.personalization_angle || row.angle) || null,
    priority: cleanText(row.priority) || "medium",
    status: "new",
    next_action: cleanText(row.next_action) || "Review, verify contact route, then prepare cold email",
    source: sourceValues.join(" | ") || null,
    confidence: cleanConfidence(row.confidence),
    run_date: runDate || null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function updateMarketingResearchDatabase({ runDate, limit = 40, dryRun = false } = {}) {
  const brief = readAutomationBrief("competitor-analysis");
  let warning = "";
  let rows;
  try {
    rows = await generateJsonRows({
      label: "marketing research",
      maxOutputTokens: 8000,
      system: "Return only valid JSON. Use public information only. Do not invent private contacts, private analytics, or unverifiable figures. If live evidence is uncertain, use source/search phrases and lower confidence.",
      prompt: [
        `Run date: ${runDate}.`,
        `Create up to ${Math.min(limit, 8)} compact competitive intelligence rows for Fuze Ecoteer.`,
        brief ? `Use this brief excerpt:\n${brief.slice(0, 6500)}` : "Use the current Fuze Ecoteer competitor intelligence brief.",
        "Return a balanced mix of Price Comparison and Competitor Analysis rows.",
        "Priority benchmarks: Mowgli Venture, Malaysia Wildlife, TRACC, SEATRU, PULIHARA, Bubbles Turtle Project, Juara Turtle Project, Nomad Adventure, World Volunteer, Radiant Retreats, OrcaNation, Biji-Biji Initiative.",
        "Project categories: Turtle Volunteer project, Diving volunteer project, 3d2n eco package, Turtle necklace, School camp 5d4n, ESG/CSR related corporate programme.",
        "Score each organisation out of 100, active marketing out of 50, and momentum out of 20. Keep every text field under 160 characters so the JSON is complete.",
        "Return a JSON array. Each item must use these keys:",
        "research_type, organisation, offer, visible_price, country, location, target_market, category, source_url, source, strength, risk, fe_response, current_score, rating_band, trend, active_marketing_score, momentum_score, threat_level, website_score, social_score, seo_aeo_score, youtube_score, cost_value_score, logistics_score, trust_score, strategic_learning_score, most_active_channel, main_campaign_theme, keyword_notes, aeo_notes, backlink_notes, social_notes, website_change_notes, evidence_links, what_we_can_learn, how_we_are_better, recommended_action, confidence.",
        "research_type must be exactly Price Comparison or Competitor Analysis. confidence must be 0 to 1.",
      ].join("\n"),
    });
  } catch (error) {
    warning = `OpenAI generation failed (${error.message}); saved fallback competitor tracker rows instead.`;
    console.warn(warning);
    rows = fallbackMarketingResearchRows(runDate);
  }

  const normalized = rows.map((row) => normalizeMarketingResearch(row, runDate)).filter((row) => row.organisation);
  if (dryRun) return { rows: normalized, saved: [], warning };
  const saved = await upsertMarketingResearchRows(normalized);
  const snapshots = await insertOptional("marketing_competitor_weekly_snapshots", normalized.map((row) => marketingSnapshotRow(row, runDate)));
  const evidence = await insertOptional("marketing_competitor_evidence_log", evidenceRowsFromResearch(normalized, runDate));
  return { rows: normalized, saved, snapshots, evidence, warning };
}

async function updateColdEmailCrmDatabase({ runDate, limit = 2500, dryRun = false } = {}) {
  const brief = readAutomationBrief("cold-email-crm");
  const briefPrompt = normalizeBriefPrompt(brief, { runDate, limit });
  const existingSnapshot = await fetchExistingColdEmailLeadsSnapshot();
  const targets = crmSegmentTargets();
  const plan = buildColdEmailSegmentPlan({
    existingCounts: existingSnapshot.counts,
    maxNewRows: limit,
  });
  const rows = [];
  const warnings = [];

  if (!plan.length) {
    return {
      rows: [],
      saved: [],
      warning: "CRM segment targets already met; no new rows were generated.",
      existingCounts: existingSnapshot.counts,
      targets,
    };
  }

  for (const item of plan) {
    let remainingForSegment = item.count;
    let batchNumber = 0;
    while (remainingForSegment > 0) {
      const batchSize = Math.min(CRM_BATCH_SIZE, remainingForSegment);
      batchNumber += 1;
      try {
        const segmentRows = await generateJsonRows({
          label: `cold email CRM ${item.segment} batch ${batchNumber}`,
          maxOutputTokens: 5000,
          jsonSchema: crmLeadArraySchema(),
          system: "Return only valid JSON. Use public information only. Do not write outreach emails. Do not invent private contacts, private personal data, evidence, intent, LinkedIn details, social activity, emails, or unverifiable figures. If evidence is uncertain, say so in research_notes and lower confidence.",
          prompt: [
            briefPrompt || [
              `Run date: ${runDate}.`,
              "Create CRM prospect rows for Fuze Ecoteer.",
              "Do not invent emails. Keep email null unless it is a public email you actually found and cited.",
            ].join("\n"),
            "",
            `For this pass, return exactly ${batchSize} rows for lead_segment: ${item.segment}.`,
            `This is batch ${batchNumber} for ${item.segment}. Segment target: ${targets[item.segment] || 0}. Existing CRM count in this segment: ${existingSnapshot.counts[item.segment] || 0}. Planned new rows for this run in this segment: ${item.count}.`,
            `Every returned row must have lead_segment exactly set to: ${item.segment}.`,
            segmentSpecificPrompt(item.segment),
            existingOrgPrompt(existingSnapshot.existingNames[item.segment]),
            "Return one object per real organisation.",
            "Return a JSON array only. Do not include markdown, code fences, comments, or commentary.",
            "Keep string fields short and stable. Avoid long paragraphs and keep each string field under 120 characters where possible.",
            "If you cannot verify a public email, set email to null. Never invent or guess an email address.",
            "Do not put commas, URLs, organisation names, or notes into lead_segment. lead_segment must exactly equal the requested segment string and nothing else.",
            "Do not return duplicate organisations within this batch.",
          ].filter(Boolean).join("\n"),
        });
        rows.push(...segmentRows);
      } catch (error) {
        warnings.push(`Segment ${item.segment} batch ${batchNumber} failed: ${error.message}`);
      }
      remainingForSegment -= batchSize;
    }
  }

  const normalized = dedupeRowsByKey(rows
    .map((row) => normalizeColdEmailLead(row, runDate))
    .filter((row) => row && row.organisation_name));

  const currentTravelCount = normalized.filter((row) => row.lead_segment === "Network / Referral Partner").length;
  const travelPlan = plan.find((item) => item.segment === "Network / Referral Partner");
  const neededTravelCount = travelPlan ? travelPlan.count : 0;
  if (currentTravelCount < neededTravelCount) {
    const fallbackRows = await buildTravelReferralFallbackRows(runDate, neededTravelCount - currentTravelCount);
    const normalizedFallback = fallbackRows
      .map((row) => normalizeColdEmailLead(row, runDate))
      .filter((row) => row && row.organisation_name);
    normalized.push(...normalizedFallback);
    warnings.push(`Travel fallback added ${normalizedFallback.length} seeded referral lead(s) because only ${currentTravelCount} travel rows were generated.`);
  }

  if (dryRun) {
    return {
      rows: normalized,
      saved: [],
      warning: warnings.join(" | ") || null,
      existingCounts: existingSnapshot.counts,
      targets,
      plan,
    };
  }
  const saved = await upsertRows("marketing_cold_email_leads", normalized, "lead_segment,organisation_name,country");
  return {
    rows: normalized,
    saved,
    warning: warnings.join(" | ") || null,
    existingCounts: existingSnapshot.counts,
    targets,
    plan,
  };
}

module.exports = {
  updateColdEmailCrmDatabase,
  updateMarketingResearchDatabase,
};