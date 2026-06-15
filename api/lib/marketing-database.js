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

const CRM_BATCH_SIZE = Math.max(10, Math.min(60, Number(process.env.CRM_BATCH_SIZE || 30) || 30));

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
    cleanText(row.likely_need || row.need),
    cleanText(row.recommended_offer || row.offer),
    cleanText(row.personalization_angle || row.angle),
    cleanText(row.source),
  ].join(" ").toLowerCase();
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(String(term).toLowerCase()));
}

function isTravelReferralLead(row) {
  const text = combinedLeadText(row);
  return includesAny(text, TRAVEL_REFERRAL_TERMS) && !includesAny(text, EDUCATION_TERMS) && !includesAny(text, CORPORATE_TERMS);
}

function isCorporateLead(row) {
  const text = combinedLeadText(row);
  return includesAny(text, CORPORATE_TERMS) && !includesAny(text, EDUCATION_TERMS);
}

function isUniversityLead(row) {
  const text = combinedLeadText(row);
  return includesAny(text, UNIVERSITY_TERMS) && !includesAny(text, PRESCHOOL_TERMS) && !includesAny(text, CORPORATE_TERMS);
}

function isPreschoolLead(row) {
  const text = combinedLeadText(row);
  return includesAny(text, PRESCHOOL_TERMS) && !includesAny(text, UNIVERSITY_TERMS) && !includesAny(text, CORPORATE_TERMS);
}

function isSchoolLead(row) {
  const text = combinedLeadText(row);
  return includesAny(text, SCHOOL_TERMS) && !includesAny(text, UNIVERSITY_TERMS) && !includesAny(text, PRESCHOOL_TERMS) && !includesAny(text, CORPORATE_TERMS);
}

async function fetchTravelSeedEvidence(seed) {
  const checkedUrls = [];
  const emails = new Set();
  const seen = new Set();
  const base = cleanText(seed.website).replace(/\/+$/, "");
  const candidates = [
    base,
    `${base}/contact`,
    `${base}/contact-us`,
    `${base}/about`,
    `${base}/about-us`,
  ];

  for (const url of candidates) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 Codex" },
      });
      if (!response.ok) continue;
      checkedUrls.push(url);
      const text = await response.text();
      const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
      for (const match of matches) {
        const email = cleanText(match).toLowerCase();
        if (isValidEmail(email)) {
          emails.add(email);
        }
      }
    } catch (_error) {
      // Ignore fetch failures for seed enrichment.
    }
  }

  return {
    emails: [...emails],
    checkedUrls,
  };
}

async function buildTravelReferralFallbackRows(runDate, neededCount) {
  const rows = [];
  for (const seed of TRAVEL_REFERRAL_SEEDS.slice(0, neededCount)) {
    const evidence = await fetchTravelSeedEvidence(seed);
    const email = evidence.emails[0] || null;
    const emailEvidence = email ? `Public email found: ${email}` : "No public email found during fallback site scan.";
    const checkedSource = evidence.checkedUrls.length ? evidence.checkedUrls.join(", ") : seed.website;
    rows.push({
      lead_segment: "Network / Referral Partner",
      organisation_name: seed.organisation_name,
      country: seed.country,
      city: seed.city,
      website: seed.website,
      contact_department: "Partnerships / Enquiries",
      contact_name: null,
      email,
      linkedin_url: null,
      research_notes: [
        `${seed.organisation_name} is a travel / volunteer travel / responsible tourism platform relevant to referral partnerships for PTP, PMRS and PEEP.`,
        emailEvidence,
        `Fallback source URLs checked: ${checkedSource}`,
      ].join(" "),
      likely_need: "Fresh responsible travel or conservation programme partners for its audience.",
      recommended_offer: seed.recommended_offer,
      personalization_angle: `${seed.organisation_name} already promotes travel or volunteer experiences, so a Perhentian conservation collaboration is a direct audience fit.`,
      priority: email ? "Priority B - 80/100" : "Nurture - 55/100",
      next_action: email ? "send tailored cold email" : "verify public contact email",
      source: `${seed.source} | ${checkedSource}${email ? ` | public email verified: ${email}` : ""}`,
      confidence: email ? 0.82 : 0.58,
    });
  }
  return rows;
}

function cleanConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

function cleanNumber(value, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number;
}

function cleanScore(value, max = 100) {
  const number = cleanNumber(value);
  if (number === null) return null;
  return Math.max(0, Math.min(max, Math.round(number)));
}

function readAutomationBrief(name) {
  const briefPath = path.join(process.cwd(), "automation-briefs", `${name}.md`);
  try {
    return fs.readFileSync(briefPath, "utf8").trim();
  } catch (error) {
    return "";
  }
}

function compactDetails(row) {
  const parts = [
    row.current_score !== null && row.current_score !== undefined ? `Score: ${row.current_score}/100` : "",
    row.rating_band ? `Band: ${row.rating_band}` : "",
    row.trend ? `Trend: ${row.trend}` : "",
    row.active_marketing_score !== null && row.active_marketing_score !== undefined ? `Active marketing: ${row.active_marketing_score}/50` : "",
    row.momentum_score !== null && row.momentum_score !== undefined ? `Momentum: ${row.momentum_score}/20` : "",
    row.threat_level ? `Threat: ${row.threat_level}` : "",
    row.most_active_channel ? `Channel: ${row.most_active_channel}` : "",
    row.main_campaign_theme ? `Campaign: ${row.main_campaign_theme}` : "",
    row.what_we_can_learn ? `Learn: ${row.what_we_can_learn}` : "",
    row.how_we_are_better ? `FE better: ${row.how_we_are_better}` : "",
    row.recommended_action ? `Action: ${row.recommended_action}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

async function generateJsonRows({ system, prompt, label, maxOutputTokens = 4000 }) {
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150000);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: system || "Return only valid JSON. Do not include markdown, comments, or prose.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_output_tokens: maxOutputTokens,
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`OpenAI ${label} generation failed: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.output_text || (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");

  return parseJsonRows(text, label);
}

function fallbackMarketingResearchRows(runDate) {
  return [
    {
      research_type: "Competitor Analysis",
      organisation: "Mowgli Venture",
      offer: "Adventure, school, corporate and outdoor experience packaging",
      visible_price: "Research needed",
      country: "Malaysia",
      location: "Malaysia",
      target_market: "Schools, corporates, adventure groups",
      category: "ESG/CSR related corporate programme",
      source_url: "https://mowgliventure.com/",
      source: "https://mowgliventure.com/",
      strength: "Broad packaging across adventure, groups and corporate positioning",
      risk: "Can compete for school and corporate group attention if FE pages stay unclear",
      fe_response: "Build separate school, CSR and conservation landing pages with clearer proof, pricing and enquiry CTAs",
      current_score: 78,
      rating_band: "Strong competitor",
      trend: "Benchmark leader",
      active_marketing_score: 34,
      momentum_score: 12,
      threat_level: "High",
      website_score: 12,
      social_score: 10,
      seo_aeo_score: 14,
      youtube_score: 5,
      cost_value_score: 7,
      logistics_score: 6,
      trust_score: 6,
      strategic_learning_score: 4,
      most_active_channel: "Website / social",
      main_campaign_theme: "Adventure and group experiences",
      keyword_notes: "Track adventure Malaysia, corporate retreat Malaysia, outdoor education Malaysia, school camp Malaysia",
      aeo_notes: "Compare whether their pages answer who it is for, location, itinerary, price and enquiry steps",
      backlink_notes: "Check school, corporate, media and partner links weekly",
      social_notes: "Review public Instagram, Facebook, LinkedIn and YouTube activity weekly",
      website_change_notes: "Fallback row created because OpenAI generation did not complete on the cloud runner",
      evidence_links: "https://mowgliventure.com/",
      what_we_can_learn: "Audience-specific pages make mixed offers easier to understand",
      how_we_are_better: "FE can be stronger on conservation authenticity if impact proof is shown clearly",
      recommended_action: "Create stronger school and CSR landing pages with proof, FAQs, pricing and clear enquiry buttons",
      confidence: 0.55,
    },
    {
      research_type: "Competitor Analysis",
      organisation: "TRACC",
      offer: "Marine conservation and diving volunteer programme",
      visible_price: "Research needed",
      country: "Malaysia",
      location: "Sabah",
      target_market: "Divers, marine volunteers, gap year travellers",
      category: "Diving volunteer project",
      source_url: "https://tracc.org/",
      source: "https://tracc.org/",
      strength: "Clear dive-based conservation niche",
      risk: "Strong fit for divers comparing marine conservation options",
      fe_response: "Make FE diving and marine conservation value clearer with certification requirements and included activities",
      current_score: 72,
      rating_band: "Moderate competitor",
      trend: "Needs review",
      active_marketing_score: 25,
      momentum_score: 8,
      threat_level: "Medium",
      website_score: 10,
      social_score: 8,
      seo_aeo_score: 13,
      youtube_score: 6,
      cost_value_score: 7,
      logistics_score: 6,
      trust_score: 6,
      strategic_learning_score: 4,
      most_active_channel: "Website",
      main_campaign_theme: "Marine conservation diving",
      keyword_notes: "Track scuba diving volunteer Malaysia, coral reef conservation volunteer, marine conservation diving",
      aeo_notes: "Compare answers on dive requirements, safety, accommodation, food and conservation activities",
      backlink_notes: "Review conservation and diving backlinks",
      social_notes: "Check public social/video activity weekly",
      website_change_notes: "Fallback row created because OpenAI generation did not complete on the cloud runner",
      evidence_links: "https://tracc.org/",
      what_we_can_learn: "A specialist diving niche is easy to position and search for",
      how_we_are_better: "FE can combine turtle, island, education and community impact in one stronger pathway",
      recommended_action: "Split FE marine volunteering and diving-related offers into clearer comparison rows",
      confidence: 0.55,
    },
    {
      research_type: "Competitor Analysis",
      organisation: "SEATRU",
      offer: "Sea turtle conservation volunteering",
      visible_price: "Research needed",
      country: "Malaysia",
      location: "Terengganu",
      target_market: "Turtle volunteers, students, conservation supporters",
      category: "Turtle Volunteer project",
      source_url: "https://seatru.umt.edu.my/volunteer-registration-2/",
      source: "https://seatru.umt.edu.my/volunteer-registration-2/",
      strength: "University-linked turtle conservation credibility",
      risk: "Strong trust signal for turtle-specific volunteer searches",
      fe_response: "Show FE turtle impact, safety, seasonality and team credibility more clearly",
      current_score: 76,
      rating_band: "Strong competitor",
      trend: "Benchmark leader",
      active_marketing_score: 22,
      momentum_score: 7,
      threat_level: "High",
      website_score: 11,
      social_score: 6,
      seo_aeo_score: 15,
      youtube_score: 4,
      cost_value_score: 7,
      logistics_score: 6,
      trust_score: 7,
      strategic_learning_score: 4,
      most_active_channel: "Website",
      main_campaign_theme: "Turtle conservation volunteering",
      keyword_notes: "Track turtle volunteering Malaysia, sea turtle conservation volunteer, turtle hatchery volunteer Malaysia",
      aeo_notes: "Compare direct answers on turtle season, volunteer duties, cost, dates and how to apply",
      backlink_notes: "University authority is a strong trust signal",
      social_notes: "Check public social activity weekly",
      website_change_notes: "Fallback row created because OpenAI generation did not complete on the cloud runner",
      evidence_links: "https://seatru.umt.edu.my/volunteer-registration-2/",
      what_we_can_learn: "Academic and conservation credibility reduces buyer anxiety",
      how_we_are_better: "FE can package conservation with broader island experience and school/corporate pathways",
      recommended_action: "Add stronger turtle volunteering FAQs and evidence of impact on the FE app/site",
      confidence: 0.55,
    },
    {
      research_type: "Price Comparison",
      organisation: "Fuze Ecoteer",
      offer: "Turtle Volunteer project",
      visible_price: "Use current FE fees",
      country: "Malaysia",
      location: "Perhentian / Malaysia",
      target_market: "Volunteers, schools, corporates",
      category: "Turtle Volunteer project",
      source: "Internal FE pricing and website review",
      strength: "Authentic conservation and local delivery",
      risk: "Value is harder to compare if price, inclusions and proof are unclear",
      fe_response: "Make pricing, inclusions, impact and next step clearer",
      current_score: 68,
      rating_band: "Moderate competitor",
      trend: "Opportunity to beat",
      active_marketing_score: 22,
      momentum_score: 8,
      threat_level: "Internal opportunity",
      what_we_can_learn: "Price rows need exact inclusions and proof, not just a number",
      how_we_are_better: "FE has direct project credibility and can show real outcomes",
      recommended_action: "Create one price comparison block per FE product type",
      confidence: 0.5,
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
          maxOutputTokens: 7000,
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
            "Return a JSON array only. Do not include markdown, code fences, comments, or commentary.",
            "Keep string fields short and stable. Avoid long paragraphs and keep each string field under 120 characters where possible.",
            "If you cannot verify a public email, set email to null. Never invent or guess an email address.",
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
    const fallbackRows = await buildTravelReferralFallbackRows(runDate, neededCount - currentTravelCount);
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