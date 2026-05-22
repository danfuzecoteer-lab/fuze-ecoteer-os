const fs = require("fs");
const path = require("path");
const { insertRows, upsertRows } = require("./supabase-admin");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
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

function cleanScore(value, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(max, Math.round(number)));
}

function readAutomationBrief(name) {
  try {
    return fs.readFileSync(path.join(process.cwd(), "automation-briefs", `${name}.md`), "utf8").trim();
  } catch (_error) {
    return "";
  }
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
        { role: "system", content: system || "Return only valid JSON. Do not include markdown, comments, or prose." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI ${label} generation failed: ${await response.text()}`);

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

function compactDetails(row) {
  return [
    row.current_score != null ? `Score: ${row.current_score}/100` : "",
    row.rating_band ? `Band: ${row.rating_band}` : "",
    row.trend ? `Trend: ${row.trend}` : "",
    row.active_marketing_score != null ? `Active marketing: ${row.active_marketing_score}/50` : "",
    row.momentum_score != null ? `Momentum: ${row.momentum_score}/20` : "",
    row.threat_level ? `Threat: ${row.threat_level}` : "",
    row.most_active_channel ? `Channel: ${row.most_active_channel}` : "",
    row.main_campaign_theme ? `Campaign: ${row.main_campaign_theme}` : "",
    row.what_we_can_learn ? `Learn: ${row.what_we_can_learn}` : "",
    row.how_we_are_better ? `FE better: ${row.how_we_are_better}` : "",
    row.recommended_action ? `Action: ${row.recommended_action}` : "",
  ].filter(Boolean).join(" | ");
}

function normalizeMarketingResearch(row, runDate) {
  const researchType = cleanText(row.research_type || row.type);
  const currentScore = cleanScore(row.current_score || row.total_score);
  const activeMarketingScore = cleanScore(row.active_marketing_score, 50);
  const momentumScore = cleanScore(row.momentum_score, 20);
  const evidenceLinks = Array.isArray(row.evidence_links) ? row.evidence_links.join(" | ") : cleanText(row.evidence_links);
  const normalized = {
    research_type: researchType === "Competitor Analysis" ? "Competitor Analysis" : "Price Comparison",
    organisation: cleanText(row.organisation || row.organisation_name || row.company || row.name),
    offer: cleanText(row.offer || row.programme || row.product),
    visible_price: cleanText(row.visible_price || row.price || row.pricing) || null,
    strength: cleanText(row.strength || row.main_strength) || null,
    risk: cleanText(row.risk || row.main_weakness || row.competitive_threat) || null,
    target_market: cleanText(row.target_market || row.market) || null,
    category: cleanText(row.category || row.sub_category) || null,
    country: cleanText(row.country) || null,
    location: cleanText(row.location || row.specific_location) || null,
    primary_audience: cleanText(row.primary_audience || row.target_audience) || null,
    cost_from: cleanText(row.cost_from || row.visible_price || row.price) || null,
    currency: cleanText(row.currency) || null,
    current_score: currentScore,
    rating_band: cleanText(row.rating_band) || null,
    trend: cleanText(row.trend || row.status_label) || null,
    active_marketing_score: activeMarketingScore,
    momentum_score: momentumScore,
    threat_level: cleanText(row.threat_level) || null,
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
    what_we_can_learn: cleanText(row.what_we_can_learn || row.learning) || null,
    how_we_are_better: cleanText(row.how_we_are_better || row.fe_advantage) || null,
    recommended_action: cleanText(row.recommended_action || row.action || row.fe_response) || null,
    source_url: cleanText(row.source_url || row.website_url || row.url || row.link) || null,
    source: [cleanText(row.source || row.source_url || row.website_url || row.url || row.link), evidenceLinks].filter(Boolean).join(" | ") || null,
    confidence: cleanConfidence(row.confidence),
    run_date: runDate || null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  normalized.fe_response = [cleanText(row.fe_response || row.recommended_response), normalized.recommended_action, compactDetails(normalized)].filter(Boolean).join(" | ") || null;
  return normalized;
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
  return rows.filter((row) => row.evidence_links || row.source_url || row.source).map((row) => ({
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
  const brief = readAutomationBrief("competitor-analysis");
  const rows = await generateJsonRows({
    label: "marketing research",
    system: "Return only valid JSON. Use public information only. Do not invent private analytics, exact paid-ad spend, private contacts, or unverifiable figures. If live evidence is uncertain, use source/search phrases and lower confidence.",
    prompt: [
      `Run date: ${runDate}.`,
      `Create up to ${limit} competitive intelligence rows for Fuze Ecoteer.`,
      brief ? `Use this automation brief:\n${brief}` : "Use the current Fuze Ecoteer competitor intelligence brief.",
      "Return a mix of Price Comparison and Competitor Analysis rows.",
      "Priority benchmarks: Mowgli Venture, Malaysia Wildlife, TRACC, SEATRU, PULIHARA, Bubbles Turtle Project, Juara Turtle Project, Nomad Adventure, World Volunteer, Radiant Retreats, OrcaNation, Biji-Biji Initiative.",
      "Project categories: Turtle Volunteer project, Diving volunteer project, 3d2n eco package, Turtle necklace, School camp 5d4n, ESG/CSR related corporate programme.",
      "Score each organisation out of 100, active marketing out of 50, and momentum out of 20. Include evidence links or clear source search phrases.",
      "Return a JSON array. Each item must use these keys:",
      "research_type, organisation, offer, visible_price, country, location, target_market, category, source_url, source, strength, risk, fe_response, current_score, rating_band, trend, active_marketing_score, momentum_score, threat_level, website_score, social_score, seo_aeo_score, youtube_score, cost_value_score, logistics_score, trust_score, strategic_learning_score, most_active_channel, main_campaign_theme, keyword_notes, aeo_notes, backlink_notes, social_notes, website_change_notes, evidence_links, what_we_can_learn, how_we_are_better, recommended_action, confidence.",
      "research_type must be exactly Price Comparison or Competitor Analysis.",
      "trend must be one of Improving, Stable, Declining, Dormant, Emerging threat, Benchmark leader, Opportunity to beat, Needs review.",
      "confidence must be 0 to 1.",
    ].join("\n"),
  });

  const normalized = rows.map((row) => normalizeMarketingResearch(row, runDate)).filter((row) => row.organisation);
  if (dryRun) return { rows: normalized, saved: [] };
  const saved = await upsertMarketingResearchRows(normalized);
  const snapshots = await insertOptional("marketing_competitor_weekly_snapshots", normalized.map((row) => marketingSnapshotRow(row, runDate)));
  const evidence = await insertOptional("marketing_competitor_evidence_log", evidenceRowsFromResearch(normalized, runDate));
  return { rows: normalized, saved, snapshots, evidence };
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
