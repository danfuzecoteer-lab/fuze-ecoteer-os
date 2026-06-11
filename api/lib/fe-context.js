const { selectRows } = require("./supabase-admin");

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatImpactEntry(entry) {
  const parts = [
    entry.entry_date,
    entry.project,
    entry.activity_type,
    entry.location ? `at ${entry.location}` : "",
  ].filter(Boolean);
  const summary = text(entry.impact_message || entry.story_highlight || entry.notes || entry.follow_up_needed);
  const metrics = entry.metrics_json && typeof entry.metrics_json === "object"
    ? Object.entries(entry.metrics_json)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ")
    : "";

  return `- ${parts.join(" | ")}${summary ? `: ${summary}` : ""}${metrics ? ` (${metrics})` : ""}`;
}

function groupVolunteerRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.project || "Unknown"} | ${row.start_date || "unknown start"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, groupRows]) => {
    const [project, startDate] = key.split(" | ");
    const names = groupRows.map((row) => text(row.volunteer_name)).filter(Boolean).slice(0, 8);
    const extra = groupRows.length > names.length ? ` and ${groupRows.length - names.length} more` : "";
    const endDates = [...new Set(groupRows.map((row) => row.end_date).filter(Boolean))];
    const agents = [...new Set(groupRows.map((row) => text(row.agent)).filter(Boolean))].slice(0, 3);
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
  const candidates = [row.date_of_birth, row.age].map(text).filter(Boolean);
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
  if (!row.start_date || !row.end_date) return true;
  return row.start_date <= isoDate && isoDate <= row.end_date;
}

function birthdayRows(rows, runDate, maxDaysAhead) {
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
    .filter(({ daysAhead }) => daysAhead >= 0 && daysAhead <= maxDaysAhead)
    .filter(({ row, birthdayDate }) => isDateInStay(birthdayDate, row))
    .sort((a, b) => a.daysAhead - b.daysAhead || text(a.row.volunteer_name).localeCompare(text(b.row.volunteer_name)));
}

function formatBirthday(rowInfo) {
  const name = text(rowInfo.row.volunteer_name);
  const project = text(rowInfo.row.project);
  const timing = rowInfo.daysAhead === 0 ? "today" : `in ${rowInfo.daysAhead} day${rowInfo.daysAhead === 1 ? "" : "s"}`;
  return `- ${name}${project ? ` (${project})` : ""}: birthday ${timing}`;
}

async function buildDailyEcoFeContext(runDate) {
  const twoWeeksAgo = addDays(runDate, -14);
  const twoWeeksAhead = addDays(runDate, 14);
  const [projectUpdates, volunteersAtSite, volunteersComingUp, birthdaySource, newVendors] = await Promise.all([
    selectRows("impact_entries", [
      ["select", "project,activity_type,entry_date,leader,location,metrics_json,story_highlight,impact_message,follow_up_needed,notes"],
      ["order", "entry_date.desc"],
      ["limit", "8"],
    ]),
    selectRows("volunteers", [
      ["select", "project,volunteer_name,nationality,agent,start_date,end_date,dive_course,room_upgrade,notes"],
      ["start_date", `lte.${runDate}`],
      ["end_date", `gte.${runDate}`],
      ["order", "project.asc,start_date.asc"],
      ["limit", "40"],
    ]),
    selectRows("volunteers", [
      ["select", "project,volunteer_name,nationality,agent,start_date,end_date,dive_course,room_upgrade,notes"],
      ["start_date", `gt.${runDate}`],
      ["start_date", `lte.${twoWeeksAhead}`],
      ["order", "start_date.asc,project.asc"],
      ["limit", "40"],
    ]),
    selectRows("volunteers", [
      ["select", "project,volunteer_name,start_date,end_date,date_of_birth,age"],
      ["order", "project.asc,volunteer_name.asc"],
      ["limit", "500"],
    ]),
    selectRows("organisations", [
      ["select", "name,organisation_type,country,website,notes,created_at"],
      ["created_at", `gte.${twoWeeksAgo}`],
      ["or", "(organisation_type.ilike.*vendor*,organisation_type.ilike.*supplier*,name.ilike.*vendor*,name.ilike.*supplier*,notes.ilike.*vendor*,notes.ilike.*supplier*)"],
      ["order", "created_at.desc"],
      ["limit", "12"],
    ]),
  ]);
  const birthdays = birthdayRows(birthdaySource, runDate, 7);
  const birthdaysToday = birthdays.filter((rowInfo) => rowInfo.daysAhead === 0);
  const upcomingBirthdays = birthdays.filter((rowInfo) => rowInfo.daysAhead > 0);

  return [
    "FE internal context for the Fuze Ecoteer updates section only.",
    "Use the following as practical update material. Do not include private contact details, passport details, emergency contact details, medical/diet details, exact birth years, ages, payment details, or balances.",
    "",
    "Project updates:",
    ...(projectUpdates.length ? projectUpdates.map(formatImpactEntry) : ["- No recent project updates found in Supabase."]),
    "",
    `Volunteers at site on ${runDate}:`,
    ...(volunteersAtSite.length ? groupVolunteerRows(volunteersAtSite) : ["- No current volunteers found in Supabase for this date."]),
    "",
    `Volunteers coming up from ${addDays(runDate, 1)} to ${twoWeeksAhead}:`,
    ...(volunteersComingUp.length ? groupVolunteerRows(volunteersComingUp) : ["- No upcoming volunteers found in Supabase for the next 14 days."]),
    "",
    `Birthdays today on ${runDate}:`,
    ...(birthdaysToday.length ? birthdaysToday.map(formatBirthday) : ["- No volunteer birthdays found for today."]),
    "",
    "Upcoming birthdays in the next 7 days:",
    ...(upcomingBirthdays.length ? upcomingBirthdays.map(formatBirthday) : ["- No upcoming volunteer birthdays found in the next 7 days."]),
    "",
    `New vendors from ${twoWeeksAgo} to ${runDate}:`,
    ...(newVendors.length ? newVendors.map(formatVendor) : ["- No new vendor or supplier organisations found in Supabase for the last 14 days."]),
  ].join("\n");
}

module.exports = {
  buildDailyEcoFeContext,
};
