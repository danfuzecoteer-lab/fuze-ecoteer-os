const { selectRows } = require("./supabase-admin");
const { perhentianDataHighlights } = require("./perhentian-data-highlights");

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function field(row, aliases) {
  const names = Array.isArray(aliases) ? aliases : [aliases];
  if (!row) return "";
  if (!row.__lookup) {
    Object.defineProperty(row, "__lookup", {
      value: Object.keys(row).reduce((lookup, key) => {
        lookup[normaliseKey(key)] = key;
        return lookup;
      }, {}),
      enumerable: false,
    });
  }

  for (const alias of names) {
    const key = row.__lookup[normaliseKey(alias)];
    if (key !== undefined) return row[key] || "";
  }
  return "";
}

function expandYear(year) {
  const numeric = Number(year);
  if (!Number.isFinite(numeric)) return 2026;
  if (numeric < 100) return numeric >= 50 ? 1900 + numeric : 2000 + numeric;
  return numeric;
}

function monthIndex(month) {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(String(month || "").toLowerCase().slice(0, 3));
}

function parseFlexibleDate(value, defaultYear = "2026") {
  const raw = text(value);
  if (!raw || raw.toLowerCase() === "null") return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) return `${expandYear(slash[3])}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  const dashMonth = raw.match(/^(\d{1,2})-([A-Za-z]{3,9})(?:-(\d{2,4}))?$/);
  if (dashMonth) {
    const month = monthIndex(dashMonth[2]) + 1;
    if (month > 0) return `${expandYear(dashMonth[3] || defaultYear)}-${String(month).padStart(2, "0")}-${dashMonth[1].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

async function safeSelectRows(table, params = []) {
  try {
    return await selectRows(table, params);
  } catch (error) {
    console.warn(`Could not load ${table}: ${error.message}`);
    return [];
  }
}

function decodeXml(value) {
  return text(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function firstXmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")) : "";
}

async function marineEcoNewsContext() {
  const query = encodeURIComponent("(marine conservation OR coral reef OR sea turtle OR seagrass OR plastic pollution) (Malaysia OR Southeast Asia OR ASEAN) when:14d");
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-MY&gl=MY&ceid=MY:en`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Fuze-Ecoteer-Cloud-Automation" },
    });
    if (!response.ok) throw new Error(`news fetch failed: ${response.status}`);
    const xml = await response.text();
    const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/i);
    if (!itemMatch) throw new Error("no current news item found");
    const item = itemMatch[1];
    const title = firstXmlTag(item, "title");
    const link = firstXmlTag(item, "link");
    const source = firstXmlTag(item, "source");
    const published = firstXmlTag(item, "pubDate");
    return [
      "Global eco news source to use:",
      `- Title: ${title || "Marine conservation news search"}`,
      source ? `- Source: ${source}` : "",
      published ? `- Published: ${published}` : "",
      `- Read more link: ${link || url}`,
      "- Use this as the Global eco news item if relevant. Include the Read more link in the email.",
    ].filter(Boolean).join("\n");
  } catch (error) {
    return [
      "Global eco news source to use:",
      "- No specific live article could be loaded.",
      `- Read more link: ${url}`,
      "- Use this search link only if no better current source is available.",
    ].join("\n");
  }
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatImpactEntry(entry) {
  const parts = [
    field(entry, ["entry_date", "date", "created_at"]) ? parseFlexibleDate(field(entry, ["entry_date", "date", "created_at"])) : "",
    field(entry, ["project", "Project"]),
    field(entry, ["activity_type", "activityType", "content_use"]),
    field(entry, ["location", "site_name", "site"]) ? `at ${field(entry, ["location", "site_name", "site"])}` : "",
  ].filter(Boolean);
  const summary = text(field(entry, ["headline"]) || field(entry, ["story"]) || field(entry, ["impact_message"]) || field(entry, ["story_highlight"]) || field(entry, ["funny_story"]) || field(entry, ["notes"]) || field(entry, ["follow_up_needed"]));
  const rawMetrics = field(entry, ["metrics_json", "metrics"]);
  const parsedMetrics = rawMetrics && typeof rawMetrics === "string" ? safeJson(rawMetrics) : rawMetrics;
  const metrics = parsedMetrics && typeof parsedMetrics === "object"
    ? Object.entries(parsedMetrics)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ")
    : "";

  return `- ${parts.join(" | ")}${summary ? `: ${summary}` : ""}${metrics ? ` (${metrics})` : ""}`;
}

function formatPriorityImpactEntry(entry) {
  if (!entry) return "- None found.";
  return formatImpactEntry(entry).replace(/^- /, "- Newest impact update to prioritize: ");
}

function groupVolunteerRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const project = field(row, ["project", "Project"]) || "Unknown";
    const startDate = parseFlexibleDate(field(row, ["start_date", "Vol_Start", "start"]));
    const key = `${project} | ${startDate || "unknown start"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, groupRows]) => {
    const [project, startDate] = key.split(" | ");
    const names = groupRows.map((row) => text(field(row, ["volunteer_name", "vol_name", "name"]))).filter(Boolean).slice(0, 8);
    const extra = groupRows.length > names.length ? ` and ${groupRows.length - names.length} more` : "";
    const endDates = [...new Set(groupRows.map((row) => parseFlexibleDate(field(row, ["end_date", "Vol_End", "end"]))).filter(Boolean))];
    const agents = [...new Set(groupRows.map((row) => text(field(row, ["agent", "Vol_agent"]))).filter(Boolean))].slice(0, 3);
    return `- ${project} from ${startDate}${endDates.length === 1 ? ` to ${endDates[0]}` : ""}: ${names.join(", ")}${extra}${agents.length ? ` (${agents.join(", ")})` : ""}`;
  });
}

function formatVendor(row) {
  const parts = [
    row.created_at ? row.created_at.slice(0, 10) : "",
    text(row.name),
    text(row.organisation_type),
    text(row.country),
  ].filter(Boolean);
  const website = text(row.website);
  const notes = text(row.notes);
  return `- ${parts.join(" | ")}${website ? ` | ${website}` : ""}${notes ? `: ${notes}` : ""}`;
}

function parseBirthdayParts(row) {
  const candidates = [field(row, ["date_of_birth", "dob"]), field(row, ["age"])].map(text).filter(Boolean);
  for (const candidate of candidates) {
    const iso = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return { month: iso[2], day: iso[3] };

    const slashed = candidate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slashed) {
      return {
        month: slashed[2].padStart(2, "0"),
        day: slashed[1].padStart(2, "0"),
      };
    }
  }
  return null;
}

function monthDay(isoDate) {
  return isoDate.slice(5, 10);
}

function birthdayDateForYear(monthDayValue, year) {
  return `${year}-${monthDayValue}`;
}

function daysUntilBirthday(runDate, birthdayMonthDay) {
  const runYear = Number(runDate.slice(0, 4));
  const today = new Date(`${runDate}T00:00:00Z`);
  let birthday = new Date(`${birthdayDateForYear(birthdayMonthDay, runYear)}T00:00:00Z`);
  if (birthday < today) {
    birthday = new Date(`${birthdayDateForYear(birthdayMonthDay, runYear + 1)}T00:00:00Z`);
  }
  return Math.round((birthday - today) / 86400000);
}

function isDateInStay(isoDate, row) {
  const startDate = parseFlexibleDate(field(row, ["start_date", "Vol_Start", "start"]));
  const endDate = parseFlexibleDate(field(row, ["end_date", "Vol_End", "end"]));
  if (!startDate || !endDate) return true;
  return startDate <= isoDate && isoDate <= endDate;
}

function birthdayRows(rows, runDate) {
  const runYear = Number(runDate.slice(0, 4));
  return rows
    .map((row) => ({ row, birthday: parseBirthdayParts(row) }))
    .filter(({ birthday }) => birthday)
    .map(({ row, birthday }) => {
      const birthdayMonthDay = `${birthday.month}-${birthday.day}`;
      const daysAhead = daysUntilBirthday(runDate, birthdayMonthDay);
      const birthdayYear = monthDay(birthdayDateForYear(birthdayMonthDay, runYear)) < monthDay(runDate) ? runYear + 1 : runYear;
      return {
        row,
        daysAhead,
        birthdayDate: birthdayDateForYear(birthdayMonthDay, birthdayYear),
      };
    })
    .filter(({ daysAhead }) => daysAhead === 0)
    .filter(({ row, birthdayDate }) => isDateInStay(birthdayDate, row))
    .sort((a, b) => a.daysAhead - b.daysAhead || text(a.row.volunteer_name).localeCompare(text(b.row.volunteer_name)));
}

function formatBirthday(rowInfo) {
  const name = text(field(rowInfo.row, ["volunteer_name", "vol_name", "name"]));
  const project = text(field(rowInfo.row, ["project", "Project"]));
  return `- ${name}${project ? ` (${project})` : ""}`;
}

function detectGroupType(row) {
  const haystack = [field(row, ["agent", "Vol_agent"]), field(row, ["notes"]), field(row, ["volunteer_name", "vol_name", "name"]), field(row, ["project", "Project"])].map(text).join(" ");
  if (/\b(school|college|university|student|students|tadika|taska|teacher|teachers|class|camp)\b/i.test(haystack)) return "school";
  if (/\b(corporate|company|csr|esg|team building|teambuilding|staff|employee|employees|hr)\b/i.test(haystack)) return "corporate";
  return "";
}

function groupName(row) {
  const agent = text(field(row, ["agent", "Vol_agent"]));
  if (agent && !/^(direct|wetravel|we travel|volunteer world|malaysian wildlife|mw|gvi|the great project)$/i.test(agent)) {
    return agent;
  }
  const notes = text(field(row, ["notes"]));
  const namedMatch = notes.match(/\b(?:school|university|college|company|corporate|csr|group)\b[: -]+([^.;,]+)/i);
  if (namedMatch) return text(namedMatch[1]);
  return detectGroupType(row) === "school" ? "School group" : "Corporate group";
}

function schoolCorporateGroups(rows, runDate, daysAhead) {
  const windowEnd = addDays(runDate, daysAhead);
  const groups = new Map();
  for (const row of rows) {
    const type = detectGroupType(row);
    if (!type) continue;
    const startDate = parseFlexibleDate(field(row, ["start_date", "Vol_Start", "start"])) || runDate;
    const endDate = parseFlexibleDate(field(row, ["end_date", "Vol_End", "end"])) || startDate;
    const overlapsNow = startDate <= runDate && endDate >= runDate;
    const arrivesSoon = startDate > runDate && startDate <= windowEnd;
    if (!overlapsNow && !arrivesSoon) continue;

    const project = field(row, ["project", "Project"]) || "Unknown";
    const key = [type, groupName(row), project, startDate, endDate].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        type,
        name: groupName(row),
        project,
        startDate,
        endDate,
        status: overlapsNow ? "with us now" : "arriving soon",
        count: 0,
      });
    }
    groups.get(key).count += 1;
  }

  return [...groups.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
}

function formatSchoolCorporateGroup(group) {
  const typeLabel = group.type === "school" ? "School" : "Corporate";
  const range = group.startDate === group.endDate ? group.startDate : `${group.startDate} to ${group.endDate}`;
  return `- ${typeLabel}: ${group.name} | ${group.project} | ${range} | ${group.status} | ${group.count} participant${group.count === 1 ? "" : "s"}`;
}

function numberAverage(values) {
  const numbers = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function flattenFeedbackComments(row) {
  const questionComments = Array.isArray(row.question_comments_json) ? row.question_comments_json : [];
  return [
    ...questionComments.map((item) => text(item.comment)),
    text(row.comment),
  ].filter(Boolean);
}

function feedbackThemes(rows) {
  const themePatterns = [
    ["food", /\b(food|meal|meals|vegetarian|vegan|breakfast|lunch|dinner)\b/i],
    ["accommodation", /\b(accommodation|room|bed|sleep|toilet|shower|bathroom|mentari|kiara)\b/i],
    ["staff", /\b(staff|leader|team|guide|coordinator|instructor)\b/i],
    ["booking/support", /\b(booking|support|email|response|responsive|pre[- ]?departure|guide)\b/i],
    ["briefing", /\b(briefing|introduction|orientation|arrival)\b/i],
    ["programme", /\b(programme|program|activity|activities|survey|snorkel|dive|turtle|coral|school)\b/i],
    ["safety/logistics", /\b(safety|transport|boat|ferry|pickup|schedule|equipment)\b/i],
  ];
  const counts = new Map(themePatterns.map(([theme]) => [theme, 0]));

  for (const row of rows) {
    for (const comment of flattenFeedbackComments(row)) {
      for (const [theme, pattern] of themePatterns) {
        if (pattern.test(comment)) {
          counts.set(theme, counts.get(theme) + 1);
        }
      }
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme, count]) => `${theme}: ${count}`);
}

function lowRatingQuestions(rows) {
  const counts = new Map();
  for (const row of rows) {
    const questionComments = Array.isArray(row.question_comments_json) ? row.question_comments_json : [];
    for (const item of questionComments) {
      const rating = Number(item.rating);
      const question = text(item.question);
      if (question && Number.isFinite(rating) && rating > 0 && rating <= 3) {
        counts.set(question, (counts.get(question) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([question, count]) => `${question}: ${count}`);
}

function feedbackProjectAverages(rows) {
  const projects = new Map();
  for (const row of rows) {
    const project = text(row.project) || "Unknown";
    if (!projects.has(project)) projects.set(project, []);
    projects.get(project).push(...(Array.isArray(row.ratings_json) ? row.ratings_json : []));
  }
  return [...projects.entries()]
    .map(([project, ratings]) => [project, numberAverage(ratings)])
    .filter(([, average]) => average !== null)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([project, average]) => `${project}: ${average.toFixed(1)}/5`);
}

function formatFeedbackSummary(rows) {
  if (!rows.length) return ["- No recent volunteer feedback found in Supabase."];
  const allRatings = rows.flatMap((row) => Array.isArray(row.ratings_json) ? row.ratings_json : []);
  const average = numberAverage(allRatings);
  const projectAverages = feedbackProjectAverages(rows);
  const themes = feedbackThemes(rows);
  const lowQuestions = lowRatingQuestions(rows);

  return [
    `- Responses reviewed: ${rows.length}`,
    average === null ? "- Average rating: not enough rating data" : `- Average rating: ${average.toFixed(1)}/5`,
    projectAverages.length ? `- Project averages: ${projectAverages.join("; ")}` : "- Project averages: not enough project rating data",
    themes.length ? `- Common anonymous feedback themes: ${themes.join("; ")}` : "- Common anonymous feedback themes: none detected",
    lowQuestions.length ? `- Low-rating watch points: ${lowQuestions.join("; ")}` : "- Low-rating watch points: none detected",
  ];
}

async function buildDailyEcoFeContext(runDate) {
  const twoWeeksAgo = addDays(runDate, -14);
  const thirtyDaysAgo = addDays(runDate, -30);
  const oneWeekAhead = addDays(runDate, 7);
  const twoWeeksAhead = addDays(runDate, 14);
  const [impactEntries, impactStories, perhentianHighlights, ecoNews, allVolunteerRows, volunteerFeedback, newVendors] = await Promise.all([
    safeSelectRows("impact_entries", [
      ["select", "*"],
      ["order", "entry_date.desc"],
      ["limit", "8"],
    ]),
    safeSelectRows("impact_stories", [
      ["select", "*"],
      ["order", "date.desc"],
      ["limit", "8"],
    ]),
    perhentianDataHighlights(runDate),
    marineEcoNewsContext(),
    safeSelectRows("volunteers", [
      ["select", "*"],
      ["limit", "500"],
    ]),
    safeSelectRows("volunteer_feedback", [
      ["select", "project,ratings_json,question_comments_json,comment,created_at"],
      ["created_at", `gte.${thirtyDaysAgo}`],
      ["order", "created_at.desc"],
      ["limit", "80"],
    ]),
    safeSelectRows("organisations", [
      ["select", "name,organisation_type,country,website,notes,created_at"],
      ["created_at", `gte.${twoWeeksAgo}`],
      ["or", "(organisation_type.ilike.*vendor*,organisation_type.ilike.*supplier*,name.ilike.*vendor*,name.ilike.*supplier*,notes.ilike.*vendor*,notes.ilike.*supplier*)"],
      ["order", "created_at.desc"],
      ["limit", "12"],
    ]),
  ]);
  const projectUpdates = [...impactStories, ...impactEntries]
    .sort((a, b) => {
      const bDate = parseFlexibleDate(field(b, ["date", "entry_date", "created_at"])) || "";
      const aDate = parseFlexibleDate(field(a, ["date", "entry_date", "created_at"])) || "";
      return bDate.localeCompare(aDate);
    })
    .slice(0, 8);
  const volunteersAtSite = allVolunteerRows.filter((row) => {
    const startDate = parseFlexibleDate(field(row, ["start_date", "Vol_Start", "start"]));
    const endDate = parseFlexibleDate(field(row, ["end_date", "Vol_End", "end"])) || startDate;
    return startDate && startDate <= runDate && endDate >= runDate;
  });
  const volunteersComingUp = allVolunteerRows.filter((row) => {
    const startDate = parseFlexibleDate(field(row, ["start_date", "Vol_Start", "start"]));
    return startDate && startDate > runDate && startDate <= twoWeeksAhead;
  });
  const schoolCorporateGroupRows = schoolCorporateGroups(allVolunteerRows, runDate, 7);
  const birthdaysToday = birthdayRows(allVolunteerRows, runDate);
  const [priorityProjectUpdate, ...otherProjectUpdates] = projectUpdates;

  return [
    "FE internal context for the Fuze Ecoteer updates section only.",
    "Use the following as practical update material. Do not include private contact details, passport details, emergency contact details, medical/diet details, exact birth years, ages, payment details, balances, or verbatim feedback that could identify someone.",
    "",
    ecoNews,
    "",
    "Priority Project/Fun Impact update:",
    formatPriorityImpactEntry(priorityProjectUpdate),
    "",
    "Other recent project updates, use only if useful:",
    ...(otherProjectUpdates.length ? otherProjectUpdates.slice(0, 3).map(formatImpactEntry) : ["- None found."]),
    "",
    "Perhentian project data highlights from actual data sheets, choose at most two for the email:",
    ...perhentianHighlights.slice(0, 2),
    "",
    `Volunteers at site on ${runDate}:`,
    ...(volunteersAtSite.length ? groupVolunteerRows(volunteersAtSite) : ["- No current volunteers found in Supabase for this date."]),
    "",
    `Volunteers coming up from ${addDays(runDate, 1)} to ${twoWeeksAhead}:`,
    ...(volunteersComingUp.length ? groupVolunteerRows(volunteersComingUp) : ["- No upcoming volunteers found in Supabase for the next 14 days."]),
    "",
    `School/corporate groups with us now or arriving by ${oneWeekAhead}:`,
    ...(schoolCorporateGroupRows.length ? schoolCorporateGroupRows.map(formatSchoolCorporateGroup) : ["- No school or corporate groups found for this 7-day window."]),
    "",
    `Birthdays today on ${runDate}:`,
    ...(birthdaysToday.length ? birthdaysToday.map(formatBirthday) : ["- None. Omit the birthday section completely."]),
    "",
    `Volunteer feedback summary from ${thirtyDaysAgo} to ${runDate}:`,
    ...formatFeedbackSummary(volunteerFeedback),
    "",
    `New vendors from ${twoWeeksAgo} to ${runDate}:`,
    ...(newVendors.length ? newVendors.map(formatVendor) : ["- No new vendor or supplier organisations found in Supabase for the last 14 days."]),
  ].join("\n");
}

module.exports = {
  buildDailyEcoFeContext,
};
