const { upsertRows } = require("./supabase-admin");

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

function cleanText(value) {
  return String(value || "").trim();
}

function cleanConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

async function generateJsonRows({ system, prompt, label }) {
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
          content: system || "Return only valid JSON. Do not include markdown, comments, or prose.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${label} generation failed: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.output_text || (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");

  const parsed = JSON.parse(extractJson(text, label));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  throw new Error(`${label} JSON was not an array`);
}

function normalizeMarketingResearch(row, runDate) {
  const researchType = cleanText(row.research_type || row.type);
  return {
    research_type: researchType === "Competitor Analysis" ? "Competitor Analysis" : "Price Comparison",
    organisation: cleanText(row.organisation || row.organisation_name || row.company || row.name),
    offer: cleanText(row.offer || row.programme || row.product),
    visible_price: cleanText(row.visible_price || row.price || row.pricing) || null,
    strength: cleanText(row.strength) || null,
    risk: cleanText(row.risk) || null,
    fe_response: cleanText(row.fe_response || row.action || row.recommended_response) || null,
    target_market: cleanText(row.target_market || row.market) || null,
    category: cleanText(row.category) || null,
    source_url: cleanText(row.source_url || row.url || row.link) || null,
    source: cleanText(row.source || row.source_url || row.url || row.link) || null,
    confidence: cleanConfidence(row.confidence),
    run_date: runDate || null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function normalizeColdEmailLead(row, runDate) {
  const rawSegment = cleanText(row.lead_segment || row.segment || row.type);
  const segment = rawSegment.toLowerCase().includes("corporate")
    ? "Corporate HR / CSR"
    : rawSegment.toLowerCase().includes("day") || rawSegment.toLowerCase().includes("tadika") || rawSegment.toLowerCase().includes("taska")
      ? "Day care / Tadika / Taska"
      : "School";

  return {
    lead_segment: segment,
    organisation_name: cleanText(row.organisation_name || row.organisation || row.company || row.school || row.name),
    country: cleanText(row.country),
    city: cleanText(row.city || row.location) || null,
    website: cleanText(row.website || row.url || row.link) || null,
    contact_department: cleanText(row.contact_department || row.department) || null,
    contact_name: cleanText(row.contact_name || row.contact) || null,
    email: cleanText(row.email) || null,
    linkedin_url: cleanText(row.linkedin_url || row.linkedin) || null,
    research_notes: cleanText(row.research_notes || row.notes || row.background) || null,
    likely_need: cleanText(row.likely_need || row.need) || null,
    recommended_offer: cleanText(row.recommended_offer || row.offer) || null,
    personalization_angle: cleanText(row.personalization_angle || row.angle) || null,
    priority: cleanText(row.priority) || "medium",
    status: "new",
    next_action: cleanText(row.next_action) || "Review, verify contact route, then prepare cold email",
    source: cleanText(row.source || row.website || row.url || row.link) || null,
    confidence: cleanConfidence(row.confidence),
    run_date: runDate || null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function updateMarketingResearchDatabase({ runDate, limit = 40, dryRun = false } = {}) {
  const rows = await generateJsonRows({
    label: "marketing research",
    prompt: [
      `Run date: ${runDate}.`,
      `Create up to ${limit} marketing research rows for Fuze Ecoteer.`,
      "Return both Price Comparison and Competitor Analysis rows.",
      "Markets to cover: PTP, PMRS, PEEP, school service trips in Malaysia/Sabah/Bali/Medan, corporate volunteering/CSR, recycled plastic products, and reused wooden furniture.",
      "For price rows, include organisations/products where visible pricing can be compared or where pricing needs verification.",
      "For competitor rows, include direct/adjacent competitors and why they matter.",
      "Return a JSON array. Each item must use these keys:",
      "research_type, organisation, offer, visible_price, strength, risk, fe_response, target_market, category, source_url, source, confidence.",
      "research_type must be exactly Price Comparison or Competitor Analysis.",
      "confidence must be 0 to 1. Include source_url where known, otherwise source search phrase.",
    ].join("\n"),
  });

  const normalized = rows.map((row) => normalizeMarketingResearch(row, runDate)).filter((row) => row.organisation);
  if (dryRun) return { rows: normalized, saved: [] };
  const saved = await upsertRows("marketing_research_rows", normalized, "research_type,organisation,offer");
  return { rows: normalized, saved };
}

async function updateColdEmailCrmDatabase({ runDate, limit = 50, dryRun = false } = {}) {
  const rows = await generateJsonRows({
    label: "cold email CRM",
    prompt: [
      `Run date: ${runDate}.`,
      `Create up to ${limit} cold-email CRM prospect rows for Fuze Ecoteer.`,
      "Target segments:",
      "1. Schools in Malaysia, Singapore, Indonesia, Thailand, Hong Kong, Middle East, Japan, Korea, China and nearby international-school markets.",
      "2. Day cares / tadika / taska in Selangor, Kuala Lumpur, Cyberjaya and nearby Klang Valley areas.",
      "3. Corporates, especially HR and CSR departments in Malaysia. Focus on companies with ESG, sustainability, education, biodiversity, ocean, community, waste, youth, tourism, or employee volunteering relevance.",
      "Do deep enough research notes that a later email-writing bot can write a specific personalized cold email.",
      "Return a JSON array. Each item must use these keys:",
      "lead_segment, organisation_name, country, city, website, contact_department, contact_name, email, linkedin_url, research_notes, likely_need, recommended_offer, personalization_angle, priority, next_action, source, confidence.",
      "lead_segment must be School, Day care / Tadika / Taska, or Corporate HR / CSR.",
      "confidence must be 0 to 1. Use null when a contact email is not confidently known.",
      "Do not invent private personal emails. Prefer official pages, enquiry emails, department emails, LinkedIn/company pages, or source search phrases.",
    ].join("\n"),
  });

  const normalized = rows.map((row) => normalizeColdEmailLead(row, runDate)).filter((row) => row.organisation_name);
  if (dryRun) return { rows: normalized, saved: [] };
  const saved = await upsertRows("marketing_cold_email_leads", normalized, "lead_segment,organisation_name,country");
  return { rows: normalized, saved };
}

module.exports = {
  updateColdEmailCrmDatabase,
  updateMarketingResearchDatabase,
};
