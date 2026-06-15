const fs = require("fs");
const path = require("path");
const { insertRows, upsertRows } = require("./supabase-admin");

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

  const parsed = JSON.parse(extractJson(text, label));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  throw new Error(`${label} JSON was not an array`);
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
  const travelReferralTerms = [
    "network",
    "referral",
    "partner",
    "chamber",
    "association",
    "travel",
    "tour",
    "tourism",
    "agent",
    "gap",
    "volunteer abroad",
    "career break",
    "influencer",
    "media",
    "blog",
    "publisher",
    "magazine",
    "adventure",
    "ecotourism",
    "eco tourism",
    "responsible tourism",
    "collaboration",
  ];
  const segment = lowerSegment.includes("corporate") || lowerSegment.includes("csr") || lowerSegment.includes("esg")
    ? "Corporate HR / CSR"
    : lowerSegment.includes("university") || lowerSegment.includes("college") || lowerSegment.includes("faculty")
      ? "University"
      : travelReferralTerms.some((term) => lowerSegment.includes(term))
        ? "Network / Referral Partner"
        : lowerSegment.includes("day") || lowerSegment.includes("tadika") || lowerSegment.includes("taska") || lowerSegment.includes("preschool") || lowerSegment.includes("kindergarten")
          ? "Tadika / Preschool"
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

async function updateColdEmailCrmDatabase({ runDate, limit = 50, dryRun = false } = {}) {
  const brief = readAutomationBrief("cold-email-crm");
  const rows = await generateJsonRows({
    label: "cold email CRM",
    maxOutputTokens: 12000,
    system: "Return only valid JSON. Use public information only. Do not write outreach emails. Do not invent private contacts, private personal data, evidence, intent, LinkedIn details, social activity, emails, or unverifiable figures. If evidence is uncertain, say so in research_notes and lower confidence.",
    prompt: [
      `Run date: ${runDate}.`,
      `Create up to ${limit} cold-email CRM prospect rows for Fuze Ecoteer.`,
      brief ? `Use this CRM research brief:\n${brief.slice(0, 12000)}` : "Use the current Fuze Ecoteer cold-email CRM research brief.",
      "Return a balanced weekly set across five lead groups: School, Tadika / Preschool, University, Corporate HR / CSR, and Network / Referral Partner.",
      "If the requested limit is 100 or more, return 20 leads per group. If the requested limit is lower, keep the mix balanced across the five groups.",
      "For Network / Referral Partner, prioritize travel websites, travel agents, volunteer travel platforms, gap-year companies, responsible tourism sites, travel media, career-break partners, influencers, travel bloggers, eco-tourism directories, responsible travel publishers and collaboration/referral partners for PTP, PMRS and PEEP.",
      "At least half of Network / Referral Partner leads must be travel/referral outlets, not schools, universities, taska, tadika, day-care, preschool or general education providers.",
      "Use lead_segment exactly Network / Referral Partner for travel websites, travel agents, tourism platforms, volunteer travel sites, travel media, influencers, publishers and referral partners.",
      "Do deep enough research notes that a later email-writing bot can write a specific personalised cold email, but do not write the outreach email.",
      "Return a JSON array. Each item must use these keys:",
      "lead_segment, organisation_name, country, city, website, contact_department, contact_name, email, linkedin_url, research_notes, likely_need, recommended_offer, personalization_angle, priority, next_action, source, confidence.",
      "lead_segment must be exactly one of: School, Tadika / Preschool, University, Corporate HR / CSR, Network / Referral Partner.",
      "priority must include a score and band, for example Priority A - 92/100, Priority B - 81/100, Priority C - 67/100, Nurture - 54/100, or Low priority - 35/100.",
      "research_notes must include evidence of fit, recent activity, LinkedIn/social summary, likely decision-maker, buyer motivation, pain point, timing, caution/uncertainty and source URLs.",
      "personalization_angle must be a concise hook for the future email-writing agent, not outreach copy.",
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
