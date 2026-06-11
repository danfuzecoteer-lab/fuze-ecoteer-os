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
      "Write today's Fuze Ecoteer daily eco email.",
      "Use this structure: a date-specific eco or conservation hook first, current environmental news second, and Fuze Ecoteer updates third.",
      "For the Fuze Ecoteer updates section, use internal Project updates, Volunteers at site, and Volunteers coming up when those sections are provided.",
      "Do not include private volunteer contact, passport, emergency, medical, diet, payment, or balance details.",
      "Keep the hook fun and light. Mention if a fact needs verification.",
      "Use the FE app/public Fuze Ecoteer context where available, but do not invent internal updates.",
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
