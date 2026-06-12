const FE_INTERNAL_DATA_URL = "https://hello-i-want-to-make-a.vercel.app/data-embedded.js";

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberValue(value) {
  const parsed = Number(String(value || "").replace(/[% ,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(values) {
  const numbers = values.map(numberValue).filter((value) => Number.isFinite(value) && value > 0);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function formatNumber(value, decimals = 0) {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-MY", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = (rows.shift() || []).map((header) => text(header).replace(/^\uFEFF/, ""));
  return rows
    .filter((values) => values.some((value) => text(value)))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function parseAnyDate(value) {
  const raw = text(value);
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const slashed = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashed) {
    const year = slashed[3].length === 2 ? `20${slashed[3]}` : slashed[3];
    return `${year}-${slashed[2].padStart(2, "0")}-${slashed[1].padStart(2, "0")}`;
  }
  return null;
}

function latestDate(rows, field) {
  return rows
    .map((row) => parseAnyDate(row[field]))
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function dateRangeLabel(rows, field, runDate) {
  const dates = rows
    .map((row) => parseAnyDate(row[field]))
    .filter(Boolean)
    .sort();
  if (!dates.length) return "date range not recorded";
  const first = dates[0];
  const last = dates.at(-1);
  if (first.slice(0, 4) === runDate.slice(0, 4) && last <= runDate) {
    return `${runDate.slice(0, 4)} to date`;
  }
  if (first === last) return first;
  return `${first} to ${last}`;
}

function uniqueCount(rows, field) {
  return new Set(rows.map((row) => text(row[field])).filter(Boolean)).size;
}

function countMatching(rows, field, pattern) {
  return rows.filter((row) => pattern.test(text(row[field]))).length;
}

function sumField(rows, field) {
  return rows.reduce((sum, row) => sum + numberValue(row[field]), 0);
}

function rowsUpToRunDate(rows, dateField, runDate) {
  const year = runDate.slice(0, 4);
  const datedRows = rows
    .map((row) => ({ row, date: parseAnyDate(row[dateField]) }))
    .filter(({ date }) => date && date <= runDate);
  const currentYearRows = datedRows
    .filter(({ date }) => date.startsWith(`${year}-`))
    .map(({ row }) => row);
  if (currentYearRows.length) return currentYearRows;
  const historicalRows = datedRows.map(({ row }) => row);
  return historicalRows.length ? historicalRows : rows;
}

async function loadEmbeddedPerhentianData() {
  const response = await fetch(FE_INTERNAL_DATA_URL, {
    headers: { "User-Agent": "Fuze-Ecoteer-Cloud-Automation" },
  });
  if (!response.ok) {
    throw new Error(`FE internal data fetch failed: ${response.status}`);
  }

  const script = await response.text();
  const start = script.indexOf("{");
  const end = script.lastIndexOf("};");
  if (start === -1 || end === -1) {
    throw new Error("FE internal data script did not contain embedded CSV data.");
  }
  return JSON.parse(script.slice(start, end + 1));
}

async function perhentianDataHighlights(runDate) {
  try {
    const data = await loadEmbeddedPerhentianData();
    const bcu = parseCsv(data.pmrsBcu || "");
    const hatchery = parseCsv(data.ptpHatchery || "");
    const nesting = parseCsv(data.ptpNesting || "");
    const patrol = parseCsv(data.ptpPatrolLog || "");
    const stranded = parseCsv(data.ptpStrandedTurtles || "");
    const underwater = parseCsv(data.ptpUnderwaterTurtleSightings || "");
    const underwaterLog = parseCsv(data.ptpUnderwaterTurtleLogbook || "");
    const anemone = parseCsv(data.anemoneSurveys || "");
    const seagrass = parseCsv(data.seagrassSurveys || "");
    const rollSurveys = [...parseCsv(data.roll1Surveys || ""), ...parseCsv(data.roll2Surveys || "")];

    const currentBcu = rowsUpToRunDate(bcu, "date", runDate);
    const currentHatchery = rowsUpToRunDate(hatchery, "date_laid_dd_mm_yyyy", runDate);
    const currentNesting = rowsUpToRunDate(nesting, "date_discovered", runDate);
    const currentPatrol = rowsUpToRunDate(patrol, "date", runDate);
    const currentStranded = rowsUpToRunDate(stranded, "date_discovered", runDate);
    const currentUnderwater = rowsUpToRunDate(underwater, "date", runDate);
    const currentUnderwaterLog = rowsUpToRunDate(underwaterLog, "date", runDate);
    const currentSeagrass = rowsUpToRunDate(seagrass, "date", runDate);
    const currentRollSurveys = rowsUpToRunDate(rollSurveys, "date", runDate);

    const hatcherySuccess = average(currentHatchery.map((row) => row.success_rate));
    const liveCoralRows = currentRollSurveys.filter((row) => /live coral|karang hidup/i.test(text(row.metric)));
    const liveCoralAverage = average(liveCoralRows.map((row) => row.value));
    const seagrassCoverage = average(currentSeagrass.map((row) => row.seagrass_coverage_percent));
    const hostedAnemones = countMatching(anemone, "hosting_status", /^(1|yes|y|true|host)/i);

    return [
      `- Beach clean-up data (${dateRangeLabel(currentBcu, "date", runDate)}): ${formatNumber(currentBcu.length)} records; ${formatNumber(sumField(currentBcu, "total_trash_count"))} trash items and ${formatNumber(sumField(currentBcu, "trash_weight_kg"), 1)} kg recorded${latestDate(currentBcu, "date") ? `; latest record ${latestDate(currentBcu, "date")}` : ""}.`,
      `- Hatchery data (${dateRangeLabel(currentHatchery, "date_laid_dd_mm_yyyy", runDate)}): ${formatNumber(currentHatchery.length)} records; ${formatNumber(sumField(currentHatchery, "eggs"))} eggs logged${hatcherySuccess === null ? "" : `; average recorded success ${formatNumber(hatcherySuccess, 1)}%`}.`,
      `- Nesting data (${dateRangeLabel(currentNesting, "date_discovered", runDate)}): ${formatNumber(currentNesting.length)} activity records; ${formatNumber(countMatching(currentNesting, "activity", /\bN\b|nest/i))} nest-related records and ${formatNumber(sumField(currentNesting, "eggs"))} eggs noted.`,
      `- Patrol log (${dateRangeLabel(currentPatrol, "date", runDate)}): ${formatNumber(currentPatrol.length)} patrol records across ${formatNumber(uniqueCount(currentPatrol, "nesting_location"))} locations; ${formatNumber(countMatching(currentPatrol, "poachers", /poach|boat|net/i))} poacher/boat/net watch notes.`,
      `- Stranded turtles (${dateRangeLabel(currentStranded, "date_discovered", runDate)}): ${formatNumber(currentStranded.length)} records; ${formatNumber(uniqueCount(currentStranded, "species"))} species/categories recorded; latest record ${latestDate(currentStranded, "date_discovered") || "not dated"}.`,
      `- Underwater turtles (${dateRangeLabel(currentUnderwater, "date", runDate)}): ${formatNumber(currentUnderwater.length)} sighting records and ${formatNumber(uniqueCount(currentUnderwater, "turtle_id"))} turtle IDs; ${formatNumber(currentUnderwaterLog.length)} survey log entries.`,
      `- Anemone data: ${formatNumber(anemone.length)} survey records; ${formatNumber(hostedAnemones)} records show hosting status; ${formatNumber(uniqueCount(anemone, "fish_species"))} fish-species codes recorded.`,
      `- Habitat survey data (${dateRangeLabel(currentSeagrass, "date", runDate)}): ${formatNumber(currentSeagrass.length)} seagrass records${seagrassCoverage === null ? "" : ` averaging ${formatNumber(seagrassCoverage, 1)}% cover`}; ROLL surveys cover ${formatNumber(uniqueCount(currentRollSurveys, "site_name"))} sites${liveCoralAverage === null ? "" : ` with average live-coral metric ${formatNumber(liveCoralAverage, 1)}%`}.`,
    ];
  } catch (error) {
    return [`- Perhentian embedded project data could not be loaded today: ${error.message}`];
  }
}

module.exports = {
  perhentianDataHighlights,
};
