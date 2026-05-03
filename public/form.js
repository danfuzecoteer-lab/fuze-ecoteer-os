const metricSets = {
  PTP: [
    ["turtles_sighted", "Turtles sighted in water"],
    ["turtles_nested", "Turtles nested"],
    ["nests", "Number of nests"],
  ],
  PMRS: [
    ["cleanup_kg", "Beach clean-up kg"],
    ["cleanup_bags", "Beach clean-up bags"],
    ["coral_surveys", "Coral surveys"],
  ],
  PEEP: [
    ["students", "Students reached"],
    ["subjects_taught", "Subjects taught"],
    ["classes", "Classes or sessions"],
  ],
};

const storeKey = "fuzeImpactDashboard.v1";
const projectSelect = document.querySelector("#projectSelect");
const metricFields = document.querySelector("#metricFields");
const teamUpdateForm = document.querySelector("#teamUpdateForm");
const successPanel = document.querySelector("#successPanel");
const toast = document.querySelector("#toast");
const syncStatus = document.querySelector("#syncStatus");

function defaultStore() {
  return {
    entries: [],
    volunteers: [],
    leaders: [
      { project: "PEEP", leader_name: "Balqis", email: "", reminder_day: "Friday" },
      { project: "PMRS", leader_name: "Carmen", email: "", reminder_day: "Friday" },
      { project: "PTP", leader_name: "Shafiqah", email: "", reminder_day: "Friday" },
    ],
  };
}

function loadStore() {
  try {
    return { ...defaultStore(), ...JSON.parse(localStorage.getItem(storeKey) || "{}") };
  } catch {
    return defaultStore();
  }
}

function saveStore(store) {
  localStorage.setItem(storeKey, JSON.stringify(store));
}

function setSyncStatus(kind, message) {
  if (!syncStatus) return;
  syncStatus.className = `sync-status ${kind}`;
  syncStatus.textContent = message;
}

function supabaseImpactPayload(entry) {
  return {
    project: entry.project,
    activity_type: entry.activity_type,
    entry_date: entry.entry_date,
    leader: entry.leader || null,
    location: entry.location || null,
    metrics_json: entry.metrics,
    story_highlight: entry.story_highlight || null,
    impact_message: entry.impact_message || null,
    photo_video_link: entry.photo_video_link || null,
    partner_stakeholder: entry.partner_stakeholder || null,
    best_for_social: Boolean(entry.best_for_social),
    best_for_website: Boolean(entry.best_for_website),
    follow_up_needed: entry.follow_up_needed || null,
    notes: entry.notes || null,
  };
}

async function saveEntry(entry) {
  if (window.fuzeSupabase?.enabled()) {
    try {
      await window.fuzeSupabase.insert("impact_entries", supabaseImpactPayload(entry));
      setSyncStatus("online", "Connected to Supabase. This update was saved online.");
      return "supabase";
    } catch (error) {
      console.warn("Supabase save failed, using local storage instead", error);
      const detail = window.fuzeSupabaseLastError || error.message || "Supabase rejected the save.";
      setSyncStatus("error", `Saved locally only. Online save failed: ${detail}`);
    }
  }

  const store = loadStore();
  store.entries.push(entry);
  saveStore(store);
  if (!window.fuzeSupabase?.enabled()) {
    setSyncStatus("local", "Using local browser storage. Supabase is not configured.");
  }
  return "local";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function renderMetricFields() {
  metricFields.innerHTML = metricSets[projectSelect.value]
    .map(
      ([name, label]) => `
        <label>
          ${label}
          <input type="number" min="0" step="1" name="${name}" value="0" />
        </label>
      `
    )
    .join("");
}

teamUpdateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(teamUpdateForm);
  const metrics = {};
  for (const [name] of metricSets[projectSelect.value]) {
    metrics[name] = Number(form.get(name) || 0);
  }

  const entry = {
    id: Date.now(),
    project: projectSelect.value,
    activity_type: form.get("activity_type"),
    entry_date: form.get("entry_date"),
    leader: form.get("leader"),
    location: form.get("location"),
    metrics,
    metrics_json: JSON.stringify(metrics),
    story_highlight: form.get("story_highlight"),
    impact_message: form.get("impact_message"),
    photo_video_link: form.get("photo_video_link"),
    partner_stakeholder: form.get("partner_stakeholder"),
    follow_up_needed: form.get("follow_up_needed"),
    best_for_social: form.get("best_for_social") === "on",
    best_for_website: form.get("best_for_website") === "on",
    notes: form.get("notes"),
    created_at: new Date().toISOString(),
  };

  const saveTarget = await saveEntry(entry);

  teamUpdateForm.reset();
  teamUpdateForm.elements.entry_date.value = today();
  renderMetricFields();
  successPanel.hidden = false;
  showToast(saveTarget === "supabase" ? "Update saved online" : "Update saved locally");
});

projectSelect.addEventListener("change", renderMetricFields);
teamUpdateForm.elements.entry_date.value = today();
renderMetricFields();
setSyncStatus(
  "local",
  window.fuzeSupabase?.enabled()
    ? "Ready to save online. Submit one update to test Supabase."
    : "Using local browser storage. Supabase is not configured."
);
