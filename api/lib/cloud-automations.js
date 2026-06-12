const TEAM_RECIPIENTS = [
  "Dan.fuzecoteer@gmail.com",
  "aneeta.fuzeecoteer@gmail.com",
  "azee.ecoteer@gmail.com",
  "amelia.fuze.ecoteer@gmail.com",
  "suhailin.fuzeecoteer@gmail.com",
  "naquiah@fuze-ecoteer.com",
  "shafiqah@fuze-ecoteer.com",
  "balqis@fuze-ecoteer.com",
  "Carmen.fuzeecoteer@gmail.com",
];

const DAN_RECIPIENT = ["dan.fuzecoteer@gmail.com"];

const AUTOMATIONS = [
  {
    id: "daily-eco-fun-facts",
    name: "Daily Eco Fun Facts",
    group: "daily-8am",
    to: TEAM_RECIPIENTS,
    subjectPrefix: "Daily Eco Fun Fact",
    prompt: [
      "Write today's Daily Eco update for the Fuze Ecoteer team.",
      "Audience: busy FE staff who need a quick, cheerful morning update they can read in under two minutes.",
      "Style: warm, funny, practical, and human. Use plain English. Keep it short, punchy, and easy to skim.",
      "Length: 180 to 350 words unless there is a birthday or major project update worth a little extra space.",
      "Formatting: use short headings and short bullets. No tables. No long paragraphs. No raw markdown markers should be visible in the email.",
      "Birthday rule: if Birthdays today lists any people, start with a big happy-birthday message by name before anything else. Make it celebratory. If there are no birthdays today, omit birthdays completely and never write 'No birthdays'.",
      "Opening: after any birthday message, write one short eco dad joke. Keep it friendly, not cringe-heavy.",
      "Section order after the opening: Global eco news; Perhentian project updates; Volunteers on site; Volunteers coming up; School/corporate groups; Volunteer feedback; New vendors.",
      "Only include a section if the supplied context contains something useful for that section. Skip empty sections silently.",
      "Global eco news: one short item only. Prefer current marine, turtle, reef, seagrass, fisheries, plastic pollution, biodiversity, or Southeast Asia/Malaysia news. If the provided context is uncertain, say it needs verification in one short phrase, not a long disclaimer.",
      "Perhentian project updates: this is the most important FE section. If a Priority Project/Fun Impact update is provided, include it. Use the headline/story in a lively way. Mention only one or two Perhentian data highlights at most.",
      "Volunteers on site: mention names and projects only. Keep it to one compact line or bullet group. Never include payments, emergency contacts, medical, diet, passport, phone, email, age, or balance details.",
      "Volunteers coming up: mention arrivals within 14 days, names/projects/start dates where available, and keep it brief.",
      "School/corporate groups: mention only groups with FE now or arriving within 7 days.",
      "Volunteer feedback: anonymize. Summarize as one useful theme or action point. Do not quote comments verbatim.",
      "New vendors: include only genuinely new/useful vendor notes. Skip if not useful.",
      "Privacy: never include private volunteer contact, passport, emergency, medical, diet, exact birth year, age, payment, balance, or identifiable feedback details.",
      "Accuracy: use only the provided FE context and credible news context. Do not invent internal updates, volunteer names, birthdays, groups, vendors, or data.",
      "Output only the email body.",
    ].join("\n"),
  },
  {
    id: "world-of-research",
    name: "World of Research",
    group: "daily-8am",
    to: DAN_RECIPIENT,
    subjectPrefix: "World of Research",
    prompt: [
      "Send a breakfast-readable list of 5 new research developments.",
      "Focus on biology first, then technology if biology news is weak.",
      "For each item include what happened, why it matters, and one source/search phrase to verify.",
    ].join("\n"),
  },
  {
    id: "green-tech-and-energy-shares-and-chips",
    name: "Green Tech, Energy, AI and Chips Watchlist",
    group: "daily-8am",
    to: DAN_RECIPIENT,
    subjectPrefix: "Green Tech Watchlist",
    prompt: [
      "Prepare a daily investment research watchlist, not financial advice.",
      "Cover listed companies connected to green tech, green energy, AI, chips, and raw materials.",
      "Include price movement context, reasons to research, key risks, and what to watch next.",
      "Avoid telling the reader to buy or sell.",
    ].join("\n"),
  },
  {
    id: "fe-portal-suggestions-actioner",
    name: "FE Portal Suggestions Actioner",
    group: "daily-8am",
    to: DAN_RECIPIENT,
    subjectPrefix: "FE Portal Suggestions",
    prompt: [
      "Review Fuze Ecoteer portal feedback and produce a conservative action report.",
      "Separate low-risk wording/UI improvements from items that need approval.",
      "Do not claim code was changed from this cloud run unless a GitHub/Vercel write integration is configured.",
    ].join("\n"),
  },
  {
    id: "head-of-marketing",
    name: "Head of Marketing",
    group: "daily-9am",
    to: DAN_RECIPIENT,
    subjectPrefix: "Head of Marketing",
    prompt: [
      "Create a daily Fuze Ecoteer marketing action brief.",
      "Use competitor analysis, travel trends, SEO/AEO opportunities, social content ideas, and website improvement ideas.",
      "Prioritize practical workflows and clearly mark any ideas that should become separate automations.",
    ].join("\n"),
  },
  {
    id: "competition-analaysis",
    name: "Competition Analysis",
    group: "tuesday-9am",
    to: DAN_RECIPIENT,
    subjectPrefix: "Competition Analysis",
    prompt: [
      "Create a weekly competitor research brief for PTP, PMRS, Perhentian Eco Education, school camps in Sabah/Malaysia/Bali/Medan, corporate volunteering/CSR, recycled plastic products, and reused wooden furniture.",
      "Include at least 10 comparable products or programmes across the categories with link/search phrase, approximate cost, size/scope, and why it matters.",
      "Format as a table that can be pasted into a Google Sheet.",
    ].join("\n"),
  },
  {
    id: "cold-email-crm",
    name: "Cold Email CRM",
    group: "marketing-crm",
    to: DAN_RECIPIENT,
    subjectPrefix: "Cold Email CRM",
    prompt: [
      "Summarise the weekly cold-email CRM database update for Fuze Ecoteer.",
      "Focus on schools, tadika / preschool leads, universities, corporate HR/CSR leads, and network / referral partners.",
      "Explain which lead segments look strongest, what must be verified before outreach, and what the email-writing bot should do next.",
      "Do not send outreach emails. This is a research and CRM update only.",
    ].join("\n"),
  },
  {
    id: "education-outreach-finder",
    name: "Education Outreach Finder",
    group: "weekday-8am-outreach",
    to: DAN_RECIPIENT,
    subjectPrefix: "Education Outreach Drafts",
    prompt: [
      "Create 10 Gmail drafts for education outreach.",
      "Use the Supabase cold-email CRM, marketing research and automation data.",
      "Focus on schools, taska, tadika, universities and education groups, especially Malaysia, Singapore, Thailand, Hong Kong, Korea and China.",
      "Promote Fuze Ecoteer school camps, conservation expeditions and service-learning trips.",
      "Save drafts only. Do not send outreach emails automatically.",
    ].join("\n"),
  },
  {
    id: "corporate-outreach-finder",
    name: "Corporate Outreach Finder",
    group: "weekday-8am-outreach",
    to: DAN_RECIPIENT,
    subjectPrefix: "Corporate Outreach Drafts",
    prompt: [
      "Create 10 Gmail drafts for corporate outreach.",
      "Use the Supabase cold-email CRM, marketing research and automation data.",
      "Focus on corporate HR, CSR, ESG, sustainability and employee engagement teams in Kuala Lumpur, Selangor, Kelantan, Terengganu and Pahang.",
      "Promote Fuze Ecoteer corporate team building with a cause, CSR impact days and ESG volunteering.",
      "Save drafts only. Do not send outreach emails automatically.",
    ].join("\n"),
  },
  {
    id: "travel-outreach-finder",
    name: "Travel Outreach Finder",
    group: "weekday-8am-outreach",
    to: DAN_RECIPIENT,
    subjectPrefix: "Travel Outreach Drafts",
    prompt: [
      "Create 10 Gmail drafts for travel and partnership outreach.",
      "Use the Supabase cold-email CRM, marketing research and automation data.",
      "Focus on travel websites, travel agents, career services, gap-year partners, influencers and collaboration partners.",
      "Promote Fuze Ecoteer Perhentian volunteer conservation projects: PTP, PMRS and PEEP.",
      "Save drafts only. Do not send outreach emails automatically.",
    ].join("\n"),
  },
  {
    id: "grant-database-list",
    name: "Grant Database List",
    group: "grant-database",
    to: DAN_RECIPIENT,
    subjectPrefix: "Grant Database",
    prompt: [
      "Create a weekly grant prospecting list for Fuze Ecoteer.",
      "Target PTP, PMRS, PEEP, Upcycled, and Business Development.",
      "Include CSR partnership and sponsorship opportunities from Malaysian and Singaporean companies.",
      "Return a table with organisation, grant name, link/search phrase, deadline, description, suitable project, email, and contact details.",
    ].join("\n"),
  },
  {
    id: "chief-of-staff",
    name: "Chief of Staff",
    group: "sunday-10pm",
    to: DAN_RECIPIENT,
    subjectPrefix: "Chief of Staff",
    prompt: [
      "Prepare a weekly chief-of-staff brief for Fuze Ecoteer.",
      "Think ahead, identify future problems, suggest goals, recommend useful AI agents, and identify practical markets or products.",
      "Do not send external emails or make operational commitments.",
    ].join("\n"),
  },
];

function malaysiaDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function automationsForGroup(group, date = new Date()) {
  if (group === "grant-database") {
    return AUTOMATIONS.filter((automation) => automation.id === "grant-database-list");
  }
  if (group === "marketing-crm") {
    return AUTOMATIONS.filter((automation) => automation.id === "cold-email-crm");
  }
  if (group === "competition-analysis") {
    return AUTOMATIONS.filter((automation) => automation.id === "competition-analaysis");
  }
  if (group === "education-outreach") {
    return AUTOMATIONS.filter((automation) => automation.id === "education-outreach-finder");
  }
  if (group === "corporate-outreach") {
    return AUTOMATIONS.filter((automation) => automation.id === "corporate-outreach-finder");
  }
  if (group === "travel-outreach") {
    return AUTOMATIONS.filter((automation) => automation.id === "travel-outreach-finder");
  }

  const { weekday } = malaysiaDateParts(date);
  return AUTOMATIONS.filter((automation) => {
    if (group === "daily-7am") {
      if (automation.group === "daily-8am" || automation.group === "daily-9am") return true;
      if (automation.group === "tuesday-9am") return weekday === "Tue";
      return false;
    }
    if (automation.group === group) return true;
    if (group === "daily-9am" && automation.group === "tuesday-9am") return weekday === "Tue";
    return false;
  });
}

module.exports = {
  AUTOMATIONS,
  automationsForGroup,
  malaysiaDateParts,
};
