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

async function generateGrantRows(runDate, limit = 100) {
  const model = process.env.OPENAI_MODEL || "gpt-5.4";
  const brief = compactBriefForPrompt(readAutomationBrief("grant-deep-research"));
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
          content: "Return only valid JSON. Do not include markdown, comments, or prose.",
        },
        {
          role: "user",
          content: [
            `Run date: ${runDate}.`,
            brief ? `Use this automation brief as the research and scoring standard:\n\n${brief}` : "",
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
    }),
  });

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

async function updateGrantDatabase({ runDate, limit = 100, dryRun = false } = {}) {
  const rows = await generateGrantRows(runDate, limit);
  if (dryRun) {
    return { rows, saved: [] };
  }
  const saved = await upsertRows("grant_opportunities", rows, "organisation_name,grant_name");
  return { rows, saved };
}

module.exports = {
  updateGrantDatabase,
};
