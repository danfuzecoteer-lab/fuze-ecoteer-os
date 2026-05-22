const fs = require("fs");
const path = require("path");
const { upsertRows } = require("./supabase-admin");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function extractJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) return match[1].trim();
  const first = trimmed.indexOf("[");
  const last = trimmed.lastIndexOf("]");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error("No JSON array found in grant research response");
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanDate(value) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

function readAutomationBrief(name) {
  const briefPath = path.join(process.cwd(), "automation-briefs", `${name}.md`);
  try {
    return fs.readFileSync(briefPath, "utf8").trim();
  } catch {
    return "";
  }
}

function compactBriefForPrompt(brief) {
  if (!brief) return "";
  const usefulLines = brief
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      return (
        line.startsWith("#") ||
        line.startsWith("- ") ||
        /^(Track|Suitable project examples|Search|Capture|Score|Use|Prioritise|Separate|Target|Focus|For each|Every week|Produce|Flag)\b/.test(line)
      );
    });
  return usefulLines.join("\n").slice(0, 12000);
}

function normalizeGrant(row) {
  return {
    grant_name: cleanText(row.grant_name || row.name_of_grant || row.grant || row.name),
    organisation_name: cleanText(row.organisation_name || row.name_of_org || row.organisation || row.org),
    grant_url: cleanText(row.grant_url || row.link || row.url) || null,
    deadline: cleanDate(row.deadline),
    description: cleanText(row.description),
    suitable_project: cleanText(row.suitable_project || row.project),
    email: cleanText(row.email) || null,
    contact_details: cleanText(row.contact_details || row.contact) || null,
    country: cleanText(row.country) || null,
    funding_amount: cleanText(row.funding_amount || row.amount) || null,
    eligibility_notes: cleanText(row.eligibility_notes || row.eligibility) || null,
    status: "new",
    source: cleanText(row.source || row.grant_url || row.link) || null,
    confidence: cleanConfidence(row.confidence),
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function validGrant(row) {
  return row.grant_name && row.organisation_name;
}

async function generateGrantRowsBatch({ runDate, limit, focus }) {
  const model = process.env.OPENAI_MODEL || "gpt-5.4";
  const brief = compactBriefForPrompt(readAutomationBrief("grant-deep-research"));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
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
          content: "Return only valid JSON. Do not include markdown, comments, or prose.",
        },
        {
          role: "user",
          content: [
            `Run date: ${runDate}.`,
            brief ? `Use this automation brief as the research and scoring standard:\n\n${brief}` : "",
            `Batch focus: ${focus}.`,
            `Find up to ${limit} grant opportunities Fuze Ecoteer could apply for.`,
            "Target projects: PTP, PMRS, PEEP, Upcycled, Business Development.",
            "Also look for CSR partnership and sponsorship opportunities from Malaysian and Singaporean companies, especially companies with ESG, sustainability, ocean, education, tourism, community, biodiversity, waste, or youth programmes.",
            "Include both formal grant programmes and relevant CSR/company foundation opportunities where Fuze Ecoteer could approach the company.",
            "Prioritise open, opening-soon, annual-tracking and rolling opportunities. Include closed opportunities only when they are strategically worth tracking annually.",
            "Use the brief's scoring logic internally. Put opportunity score, chance rating, effort rating, recommended action, deadline status, best project match, readiness notes and key evidence into description, suitable_project, eligibility_notes, source and confidence as appropriate.",
            "Return a JSON array. Each item must use these keys:",
            "organisation_name, grant_name, grant_url, deadline, description, suitable_project, email, contact_details, country, funding_amount, eligibility_notes, source, confidence.",
            "Use ISO date YYYY-MM-DD for deadline where known; otherwise null.",
            "confidence must be 0 to 1.",
            "Prefer real, currently relevant grant programmes and include a source URL or source search phrase.",
          ].join("\n"),
        },
      ],
      max_output_tokens: 6000,
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`OpenAI grant research failed: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.output_text || (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");

  const parsed = JSON.parse(extractJson(text));
  const rows = Array.isArray(parsed) ? parsed : parsed.grants;
  if (!Array.isArray(rows)) {
    throw new Error("Grant research JSON was not an array");
  }

  return rows.map(normalizeGrant).filter(validGrant);
}

async function generateGrantRows(runDate, limit = 70) {
  const target = Math.max(1, Number(limit) || 70);
  const batches = [
    {
      focus: "Malaysia and Singapore corporate CSR, corporate foundations, sponsorships, ESG funds and employee volunteering funds",
      limit: 12,
    },
    {
      focus: "Malaysian government, GLC, state, ministry, tourism, education, youth, green technology, social enterprise and community funding",
      limit: 10,
    },
    {
      focus: "Singapore government, Singapore-linked, ASEAN-facing, sustainability, circular economy, youth, education and regional collaboration funds",
      limit: 10,
    },
    {
      focus: "International marine conservation, sea turtle, biodiversity, climate, blue economy, circular economy and plastic waste grants",
      limit: 12,
    },
    {
      focus: "Embassy, high commission, foundation, university-linked, family foundation and regional small-grant opportunities",
      limit: 8,
    },
    {
      focus: "Upcoming, rolling, invite-only, relationship-based, closed-but-annual and worth-tracking opportunities",
      limit: 8,
    },
  ];

  const rows = [];
  const warnings = [];
  for (const batch of batches) {
    if (rows.length >= target) break;
    try {
      const batchRows = await generateGrantRowsBatch({
        runDate,
        limit: Math.min(batch.limit, target - rows.length),
        focus: batch.focus,
      });
      rows.push(...batchRows);
    } catch (error) {
      warnings.push(`${batch.focus}: ${error.message}`);
    }
  }

  const seen = new Set();
  const uniqueRows = rows.filter((row) => {
    const key = `${row.organisation_name.toLowerCase()}::${row.grant_name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { rows: uniqueRows, warning: warnings.length ? `Some grant batches failed: ${warnings.join(" | ")}` : "" };
}

function fallbackGrantRows() {
  return [
    {
      organisation_name: "Rufford Foundation",
      grant_name: "Rufford Small Grants",
      grant_url: "https://www.rufford.org/grants/",
      deadline: null,
      description: "Small grants for nature conservation projects. Track for PTP, PMRS and PEEP conservation work.",
      suitable_project: "PTP, PMRS, PEEP",
      email: null,
      contact_details: "Use official application portal",
      country: "International",
      funding_amount: "Research current round",
      eligibility_notes: "Check eligibility, conservation evidence, project lead readiness and current application round.",
      source: "https://www.rufford.org/grants/",
      confidence: 0.7,
    },
    {
      organisation_name: "National Geographic Society",
      grant_name: "Level I and Level II Grants",
      grant_url: "https://www.nationalgeographic.org/society/grants-and-investments/",
      deadline: null,
      description: "Conservation, education, storytelling and science funding. Track for marine and community impact evidence.",
      suitable_project: "PTP, PMRS, PEEP",
      email: null,
      contact_details: "Use official application portal",
      country: "International",
      funding_amount: "Research current round",
      eligibility_notes: "Best fit if FE has strong evidence, local partners, story, science or education angle.",
      source: "https://www.nationalgeographic.org/society/grants-and-investments/",
      confidence: 0.65,
    },
    {
      organisation_name: "Biji-Biji Initiative",
      grant_name: "CSR / ESG partnership benchmark",
      grant_url: "https://www.biji-biji.com/",
      deadline: null,
      description: "CSR and sustainability activity benchmark in Malaysia. Track for corporate partnership positioning.",
      suitable_project: "Business Development, Upcycled, PEEP",
      email: null,
      contact_details: "Research current public partnership route",
      country: "Malaysia",
      funding_amount: "CSR partnership potential",
      eligibility_notes: "Useful as a CSR benchmark and possible partnership/comparison lead, not necessarily a grant.",
      source: "https://www.biji-biji.com/",
      confidence: 0.55,
    },
    {
      organisation_name: "UNDP GEF Small Grants Programme",
      grant_name: "GEF Small Grants Programme",
      grant_url: "https://sgp.undp.org/",
      deadline: null,
      description: "Small grants for civil society and community environmental projects. Track Malaysia availability and cycles.",
      suitable_project: "PTP, PMRS, PEEP, Upcycled",
      email: null,
      contact_details: "Check country programme contacts",
      country: "Malaysia / International",
      funding_amount: "Research current country call",
      eligibility_notes: "Potential fit for biodiversity, waste, community and conservation outcomes if country call is open.",
      source: "https://sgp.undp.org/",
      confidence: 0.65,
    },
    {
      organisation_name: "Critical Ecosystem Partnership Fund",
      grant_name: "CEPF Grants",
      grant_url: "https://www.cepf.net/grants",
      deadline: null,
      description: "Biodiversity hotspot funding. Track if Malaysia/Southeast Asia calls align with FE conservation work.",
      suitable_project: "PTP, PMRS, PEEP",
      email: null,
      contact_details: "Use official grant portal",
      country: "International",
      funding_amount: "Research current call",
      eligibility_notes: "Good fit only when Malaysia or relevant biodiversity hotspot call is open.",
      source: "https://www.cepf.net/grants",
      confidence: 0.6,
    },
  ].map(normalizeGrant).filter(validGrant);
}

async function updateGrantDatabase({ runDate, limit = 100, dryRun = false } = {}) {
  let warning = "";
  let rows;
  try {
    const result = await generateGrantRows(runDate, Math.min(limit, 60));
    rows = result.rows;
    warning = result.warning;
    if (!rows.length) {
      throw new Error("No grant rows returned from batched research");
    }
  } catch (error) {
    warning = `OpenAI grant research failed (${error.message}); saved fallback grant tracker rows instead.`;
    console.warn(warning);
    rows = fallbackGrantRows();
  }
  if (dryRun) {
    return { rows, saved: [], warning };
  }
  const saved = await upsertRows("grant_opportunities", rows, "organisation_name,grant_name");
  return { rows, saved, warning };
}

module.exports = {
  updateGrantDatabase,
};
