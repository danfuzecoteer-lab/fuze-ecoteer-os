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

const projectNames = {
  PTP: "Perhentian Turtle Project",
  PMRS: "Perhentian Marine Research Station",
  PEEP: "Perhentian Eco Education Project",
};

const stats = document.querySelector("#stats");
const projectCards = document.querySelector("#projectCards");
const entryRows = document.querySelector("#entryRows");
const metricFields = document.querySelector("#metricFields");
const projectSelect = document.querySelector("#projectSelect");
const impactForm = document.querySelector("#impactForm");
const volunteerForm = document.querySelector("#volunteerForm");
const leaderList = document.querySelector("#leaderList");
const emailTemplate = document.querySelector("#emailTemplate");
const copyEmail = document.querySelector("#copyEmail");
const copyContent = document.querySelector("#copyContent");
const contentQueue = document.querySelector("#contentQueue");
const toast = document.querySelector("#toast");
const syncStatus = document.querySelector("#syncStatus");
const dashboardProjectFilter = document.querySelector("#dashboardProjectFilter");
const periodFilter = document.querySelector("#periodFilter");
const searchFilter = document.querySelector("#searchFilter");
const refreshDashboard = document.querySelector("#refreshDashboard");
const localMode = window.location.protocol === "file:";
const storeKey = "fuzeImpactDashboard.v1";
let dashboardData = null;

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

function normalizeEntry(entry) {
  return {
    ...entry,
    metrics_json:
      typeof entry.metrics_json === "string"
        ? entry.metrics_json
        : JSON.stringify(entry.metrics_json || {}),
  };
}

function normalizeVolunteer(volunteer) {
  return {
    ...volunteer,
    hours: Number(volunteer.hours || 0),
  };
}

function number(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function setSyncStatus(kind, message) {
  if (!syncStatus) return;
  syncStatus.className = `sync-status ${kind}`;
  syncStatus.textContent = message;
}

function supabaseImpactPayload(payload) {
  return {
    project: payload.project,
    activity_type: payload.activity_type,
    entry_date: payload.entry_date,
    leader: payload.leader || null,
    location: payload.location || null,
    metrics_json: payload.metrics,
    story_highlight: payload.story_highlight || null,
    impact_message: payload.impact_message || null,
    photo_video_link: payload.photo_video_link || null,
    partner_stakeholder: payload.partner_stakeholder || null,
    best_for_social: Boolean(payload.best_for_social),
    best_for_website: Boolean(payload.best_for_website),
    follow_up_needed: payload.follow_up_needed || null,
    notes: payload.notes || null,
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function renderMetricFields() {
  const selected = projectSelect.value;
  metricFields.innerHTML = metricSets[selected]
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

function keyMetrics(entry) {
  const metrics = JSON.parse(entry.metrics_json || "{}");
  return Object.entries(metrics)
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${number(value)}`)
    .join(", ") || "No metric values added";
}

function metricLabel(key) {
  return {
    turtles_sighted: "turtles sighted in water",
    turtles_nested: "turtles nested",
    nests: "nests recorded",
    cleanup_kg: "kg of waste removed",
    cleanup_bags: "bags of waste removed",
    coral_surveys: "coral surveys completed",
    students: "students reached",
    subjects_taught: "subjects taught",
    classes: "classes or sessions delivered",
  }[key] || key.replaceAll("_", " ");
}

function entryMetricsText(entry) {
  const metrics = JSON.parse(entry.metrics_json || "{}");
  return Object.entries(metrics)
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${number(value)} ${metricLabel(key)}`)
    .join(", ");
}

function socialCaption(entry) {
  const projectName = projectNames[entry.project] || entry.project;
  const metrics = entryMetricsText(entry);
  const location = entry.location ? ` at ${entry.location}` : "";
  const story = entry.story_highlight || entry.notes || "Another week of practical conservation action.";
  const why = entry.impact_message || "Every field update helps Fuze Ecoteer turn real project work into evidence for conservation, education, and community action.";
  const metricSentence = metrics ? `This update recorded ${metrics}.` : "This update adds to the project's growing evidence base.";
  return `${story}\n\n${metricSentence}\n\n${why}\n\n${projectName}${location}.`;
}

function websiteBlock(entry) {
  const projectName = projectNames[entry.project] || entry.project;
  const metrics = entryMetricsText(entry);
  const location = entry.location || "Perhentian Islands";
  const impact = entry.impact_message || "This work supports Fuze Ecoteer's mission to connect people with nature through conservation, education, research, and community-based action.";
  if (metrics) {
    return `${projectName} recorded ${metrics} on ${entry.entry_date} in ${location}. ${impact}`;
  }
  return `${projectName} added a new impact update on ${entry.entry_date} in ${location}. ${impact}`;
}

function buildLocalSummary() {
  const store = loadStore();
  return buildSummary(store.entries, store.volunteers, store.leaders);
}

function buildSummary(entries, volunteers, leaders) {
  const normalizedEntries = entries.map(normalizeEntry);
  const normalizedVolunteers = volunteers.map(normalizeVolunteer);
  const totals = {
    turtles_sighted: 0,
    turtles_nested: 0,
    nests: 0,
    cleanup_kg: 0,
    cleanup_bags: 0,
    coral_surveys: 0,
    students: 0,
    subjects_taught: 0,
    classes: 0,
    volunteers: normalizedVolunteers.length,
    volunteer_hours: 0,
  };
  const byProject = Object.entries(projectNames).map(([code, name]) => ({
    code,
    name,
    entries: 0,
    volunteers: 0,
    volunteer_hours: 0,
    impact_total: 0,
  }));
  const projectMap = Object.fromEntries(byProject.map((project) => [project.code, project]));

  normalizedEntries.forEach((entry) => {
    const project = projectMap[entry.project];
    if (project) project.entries += 1;
    const metrics = JSON.parse(entry.metrics_json || "{}");
    Object.keys(totals).forEach((key) => {
      if (key === "volunteers" || key === "volunteer_hours") return;
      const value = Number(metrics[key] || 0);
      totals[key] += value;
      if (project) project.impact_total += value;
    });
  });

  normalizedVolunteers.forEach((volunteer) => {
    const project = projectMap[volunteer.project];
    const hours = Number(volunteer.hours || 0);
    totals.volunteer_hours += hours;
    if (project) {
      project.volunteers += 1;
      project.volunteer_hours += hours;
    }
  });

  const sortedEntries = [...normalizedEntries].sort((a, b) =>
    `${b.entry_date}${b.id}`.localeCompare(`${a.entry_date}${a.id}`)
  );

  return {
    projects: projectNames,
    totals,
    by_project: byProject,
    entries: sortedEntries.slice(0, 25),
    all_entries: sortedEntries,
    volunteers: normalizedVolunteers.slice(0, 25),
    all_volunteers: normalizedVolunteers,
    leaders,
    content_queue: sortedEntries
      .filter((entry) => entry.best_for_social || entry.best_for_website)
      .slice(0, 12)
      .map((entry) => ({
        id: entry.id,
        project: entry.project,
        project_name: projectNames[entry.project] || entry.project,
        entry_date: entry.entry_date,
        location: entry.location,
        photo_video_link: entry.photo_video_link,
        partner_stakeholder: entry.partner_stakeholder,
        story_highlight: entry.story_highlight,
        impact_message: entry.impact_message,
        best_for_social: Boolean(entry.best_for_social),
        best_for_website: Boolean(entry.best_for_website),
        social_caption: socialCaption(entry),
        website_block: websiteBlock(entry),
      })),
  };
}

async function apiJson(url, options) {
  if (localMode) throw new Error("Local file mode");
  const response = await fetch(url, options);
  return response.json();
}

function contentUse(entry) {
  const uses = [];
  if (Number(entry.best_for_social)) uses.push("Social");
  if (Number(entry.best_for_website)) uses.push("Website");
  return uses.join(" + ") || "Internal";
}

function entrySearchText(entry) {
  return [
    entry.project,
    entry.activity_type,
    entry.leader,
    entry.location,
    entry.story_highlight,
    entry.impact_message,
    entry.partner_stakeholder,
    entry.follow_up_needed,
    entry.notes,
    entryMetricsText(entry),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function entryStory(entry) {
  return entry.story_highlight || entry.impact_message || entry.notes || "";
}

function isInPeriod(dateValue, period) {
  if (period === "all") return true;
  if (!dateValue) return false;
  const entryDate = new Date(`${dateValue}T00:00:00`);
  const now = new Date();

  if (period === "week") {
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    return entryDate >= weekAgo;
  }

  if (period === "month") {
    return (
      entryDate.getFullYear() === now.getFullYear() &&
      entryDate.getMonth() === now.getMonth()
    );
  }

  if (period === "year") {
    return entryDate.getFullYear() === now.getFullYear();
  }

  return true;
}

function filteredDashboard(data) {
  const selectedProject = dashboardProjectFilter?.value || "all";
  const selectedPeriod = periodFilter?.value || "all";
  const search = (searchFilter?.value || "").trim().toLowerCase();
  const allEntries = data.all_entries || data.entries || [];
  const allVolunteers = data.all_volunteers || data.volunteers || [];

  const entries = allEntries.filter((entry) => {
    const projectMatches = selectedProject === "all" || entry.project === selectedProject;
    const periodMatches = isInPeriod(entry.entry_date, selectedPeriod);
    const searchMatches = !search || entrySearchText(entry).includes(search);
    return projectMatches && periodMatches && searchMatches;
  });

  const volunteers = allVolunteers.filter((volunteer) => {
    return selectedProject === "all" || volunteer.project === selectedProject;
  });

  return buildSummary(entries, volunteers, data.leaders || []);
}

function escapeText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderDashboard(data) {
  const view = filteredDashboard(data);
  const totals = view.totals;
  stats.innerHTML = [
    ["Turtles sighted", totals.turtles_sighted, "sea"],
    ["Turtle nests", totals.nests, "forest"],
    ["Clean-up kg removed", totals.cleanup_kg, "coral"],
    ["Students reached", totals.students, "sun"],
    ["Coral surveys", totals.coral_surveys, "sea"],
    ["Subjects taught", totals.subjects_taught, "sun"],
    ["Volunteers", totals.volunteers, "forest"],
    ["Volunteer hours", totals.volunteer_hours, "coral"],
  ]
    .map(
      ([label, value, tone]) => `
        <article class="stat ${tone}">
          <span>${label}</span>
          <strong>${number(value)}</strong>
        </article>
      `
    )
    .join("");

  projectCards.innerHTML = view.by_project
    .map(
      (project) => `
        <article class="project-card">
          <span>${project.code}</span>
          <strong>${project.name}</strong>
          <div class="mini">
            <span class="pill">${number(project.entries)} impact entries</span>
            <span class="pill">${number(project.volunteers)} volunteers</span>
            <span class="pill">${number(project.volunteer_hours)} hours</span>
            <span class="pill">${number(project.impact_total)} total outputs</span>
          </div>
        </article>
      `
    )
    .join("");

  entryRows.innerHTML = view.entries
    .map(
      (entry) => `
        <tr>
          <td>${entry.entry_date}</td>
          <td>${entry.project}</td>
          <td>${entry.activity_type}</td>
          <td>${keyMetrics(entry)}</td>
          <td>${contentUse(entry)}</td>
          <td>${escapeText(entryStory(entry)).slice(0, 140)}</td>
        </tr>
      `
    )
    .join("");

  if (!view.entries.length) {
    entryRows.innerHTML = `<tr><td colspan="6">No impact entries match the current filters.</td></tr>`;
  }

  contentQueue.innerHTML = view.content_queue
    .map(
      (item) => `
        <article class="content-card">
          <div class="content-meta">
            <strong>${item.project}</strong>
            <span>${item.entry_date}</span>
            <span>${item.location || "No location added"}</span>
          </div>
          <div class="content-flags">
            ${item.best_for_social ? `<span class="pill">Social</span>` : ""}
            ${item.best_for_website ? `<span class="pill">Website</span>` : ""}
            ${item.photo_video_link ? `<a href="${escapeText(item.photo_video_link)}" target="_blank" rel="noreferrer">Media</a>` : ""}
          </div>
          <label>
            Social caption draft
            <textarea rows="6">${escapeText(item.social_caption)}</textarea>
          </label>
          <label>
            Website impact block
            <textarea rows="4">${escapeText(item.website_block)}</textarea>
          </label>
        </article>
      `
    )
    .join("");

  if (!view.content_queue.length) {
    contentQueue.innerHTML = `
      <div class="empty-state">
        Save an impact entry and tick Social or Website to build this queue.
      </div>
    `;
  }

  leaderList.innerHTML = (data.leaders || [])
    .map(
      (leader) => `
        <form class="leader" data-project="${leader.project}">
          <strong>${leader.project}</strong>
          <input name="leader_name" value="${leader.leader_name || ""}" aria-label="${leader.project} leader name" />
          <input name="email" value="${leader.email || ""}" placeholder="leader@email.com" aria-label="${leader.project} email" />
        </form>
      `
    )
    .join("");
}

async function loadDashboard() {
  try {
    if (window.fuzeSupabase?.enabled()) {
      const [entries, volunteers, leaders] = await Promise.all([
        window.fuzeSupabase.list("impact_entries", "entry_date.desc"),
        window.fuzeSupabase.list("volunteers", "created_at.desc"),
        window.fuzeSupabase.list("project_leaders", "project.asc"),
      ]);
      setSyncStatus("online", "Connected to Supabase. Data shown here is from the online database.");
      dashboardData = buildSummary(entries, volunteers, leaders);
      renderDashboard(dashboardData);
    } else {
      const data = await apiJson("/api/summary");
      setSyncStatus("online", "Connected to the local database server.");
      dashboardData = data;
      renderDashboard(dashboardData);
    }
  } catch (error) {
    const detail = window.fuzeSupabaseLastError || error.message || "Supabase is not ready yet.";
    setSyncStatus("local", `Using local browser storage. Online database issue: ${detail}`);
    dashboardData = buildLocalSummary();
    renderDashboard(dashboardData);
  }
}

async function loadEmailTemplate() {
  let data;
  try {
    data = await apiJson(`/api/email-template?project=${projectSelect.value}`);
  } catch {
    data = {
      subject: `Weekly impact update needed: ${projectNames[projectSelect.value]}`,
      body: `Hi team,\n\nPlease update the impact dashboard by the end of this week.\n\nFor PTP, please add turtle sightings in water, turtles nested, and number of nests.\nFor PMRS, please add beach clean-up data and coral survey data.\nFor PEEP, please add number of students, classes, and subjects taught.\nPlease also add volunteer numbers, hours, story highlights, photo or video links, and one short impact message we can use for social media, the website, and reports.\n\nThank you,\nFuze Ecoteer\n`,
    };
  }
  emailTemplate.value = `Subject: ${data.subject}\n\n${data.body}`;
}

impactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(impactForm);
  const metrics = {};
  for (const [name] of metricSets[projectSelect.value]) {
    metrics[name] = Number(form.get(name) || 0);
  }

  const payload = {
    project: projectSelect.value,
    activity_type: form.get("activity_type"),
    entry_date: form.get("entry_date"),
    leader: form.get("leader"),
    location: form.get("location"),
    metrics,
    story_highlight: form.get("story_highlight"),
    impact_message: form.get("impact_message"),
    photo_video_link: form.get("photo_video_link"),
    partner_stakeholder: form.get("partner_stakeholder"),
    follow_up_needed: form.get("follow_up_needed"),
    best_for_social: form.get("best_for_social") === "on",
    best_for_website: form.get("best_for_website") === "on",
    notes: form.get("notes"),
  };

  try {
    if (window.fuzeSupabase?.enabled()) {
      await window.fuzeSupabase.insert("impact_entries", supabaseImpactPayload(payload));
      setSyncStatus("online", "Saved online to Supabase.");
    } else {
      await apiJson("/api/impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSyncStatus("online", "Saved to the local database server.");
    }
  } catch (error) {
    const detail = window.fuzeSupabaseLastError || error.message || "Supabase rejected the save.";
    setSyncStatus("error", `Saved locally only. Online save failed: ${detail}`);
    const store = loadStore();
    store.entries.push({
      ...payload,
      id: Date.now(),
      metrics_json: JSON.stringify(payload.metrics),
      created_at: new Date().toISOString(),
    });
    saveStore(store);
  }

  impactForm.reset();
  impactForm.elements.entry_date.value = today();
  renderMetricFields();
  await loadDashboard();
  showToast("Impact entry saved");
});

volunteerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(volunteerForm);
  const payload = Object.fromEntries(form.entries());
  try {
    if (window.fuzeSupabase?.enabled()) {
      await window.fuzeSupabase.insert("volunteers", payload);
      setSyncStatus("online", "Volunteer saved online to Supabase.");
    } else {
      await apiJson("/api/volunteers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSyncStatus("online", "Volunteer saved to the local database server.");
    }
  } catch (error) {
    const detail = window.fuzeSupabaseLastError || error.message || "Supabase rejected the save.";
    setSyncStatus("error", `Volunteer saved locally only. Online save failed: ${detail}`);
    const store = loadStore();
    store.volunteers.push({ ...payload, id: Date.now(), created_at: new Date().toISOString() });
    saveStore(store);
  }
  volunteerForm.reset();
  await loadDashboard();
  showToast("Volunteer saved");
});

leaderList.addEventListener("change", async (event) => {
  const form = event.target.closest("form");
  const data = new FormData(form);
  const payload = {
    project: form.dataset.project,
    leader_name: data.get("leader_name"),
    email: data.get("email"),
    reminder_day: "Friday",
  };
  try {
    if (window.fuzeSupabase?.enabled()) {
      await window.fuzeSupabase.updateLeader(payload);
    } else {
      await apiJson("/api/leaders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
  } catch {
    const store = loadStore();
    store.leaders = store.leaders.map((leader) =>
      leader.project === payload.project ? payload : leader
    );
    saveStore(store);
  }
  showToast("Leader details updated");
});

copyEmail.addEventListener("click", async () => {
  await navigator.clipboard.writeText(emailTemplate.value);
  showToast("Email copied");
});

copyContent.addEventListener("click", async () => {
  const text = [...contentQueue.querySelectorAll("textarea")]
    .map((field) => field.value.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
  if (!text) {
    showToast("No content to copy yet");
    return;
  }
  await navigator.clipboard.writeText(text);
  showToast("Content copied");
});

projectSelect.addEventListener("change", () => {
  renderMetricFields();
  loadEmailTemplate();
});

[dashboardProjectFilter, periodFilter].forEach((control) => {
  control?.addEventListener("change", () => {
    if (dashboardData) renderDashboard(dashboardData);
  });
});

searchFilter?.addEventListener("input", () => {
  if (dashboardData) renderDashboard(dashboardData);
});

refreshDashboard?.addEventListener("click", loadDashboard);

impactForm.elements.entry_date.value = today();
renderMetricFields();
loadEmailTemplate();
loadDashboard();
