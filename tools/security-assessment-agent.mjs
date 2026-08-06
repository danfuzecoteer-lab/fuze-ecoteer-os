const rawTargets = String(process.env.SECURITY_TARGETS_JSON || "").trim();
let targets;
try { targets = JSON.parse(rawTargets); } catch { targets = rawTargets.split(/[\n,]+/).map(value => value.trim()).filter(Boolean); }
const supabase = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = `assessment-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const paths = ["/.env","/.git/config","/01_financial_ledger.csv","/02_staff_details.csv","/data-embedded.js","/api/auth-session?data=1"];
const findings = [];
const results = [];
if (!Array.isArray(targets) || !targets.length) throw new Error("SECURITY_TARGETS_JSON must be a JSON array or newline/comma-separated URLs.");
for (const raw of targets) {
  const site = String(raw).replace(/\/$/, "");
  for (const path of paths) {
    try {
      const response = await fetch(site + path, { method: "GET", redirect: "manual" });
      const exposed = response.status >= 200 && response.status < 300 && path !== "/api/auth-session?data=1";
      results.push({ site, path, status: response.status, exposed });
      if (exposed) findings.push({ fingerprint: `public:${site}:${path}`, site, severity: "high", title: "Potentially exposed sensitive route or file", route: path, evidence: { status: response.status }, impact: "Unauthenticated users may access sensitive application data.", recommendation: "Require authentication and verify deployment exclusions." });
    } catch (error) { results.push({ site, path, error: error.message }); }
  }
  try {
    const response = await fetch(site);
    for (const header of ["content-security-policy","strict-transport-security","x-content-type-options","x-frame-options","referrer-policy"]) {
      if (!response.headers.get(header)) findings.push({ fingerprint: `header:${site}:${header}`, site, severity: "medium", title: `Missing security header: ${header}`, route: "/", evidence: {}, impact: "Browser protections are weaker than expected.", recommendation: `Configure the ${header} response header.` });
    }
  } catch {}
}
if (!supabase || !serviceKey) throw new Error("Supabase secrets are missing.");
const auth = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
const assessment = { run_id: runId, triggered_by: "github-actions", status: "completed", completed_at: new Date().toISOString(), sites: targets, summary: { finding_count: findings.length, results }, report_markdown: `# Security assessment\\n\\nFindings: ${findings.length}\\n\\n${findings.map(f => `- [${f.severity}] ${f.title} — ${f.site}${f.route}`).join("\\n")}` };
const created = await fetch(`${supabase}/rest/v1/security_assessments`, { method: "POST", headers: { ...auth, Prefer: "return=representation" }, body: JSON.stringify(assessment) });
if (!created.ok) throw new Error(`Supabase assessment insert failed: ${created.status}`);
const row = (await created.json())[0];
for (const finding of findings) {
  const saved = await fetch(`${supabase}/rest/v1/security_findings`, { method: "POST", headers: { ...auth, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ ...finding, assessment_id: row.id }) });
  if (!saved.ok) throw new Error(`Supabase finding insert failed: ${saved.status}`);
}
await sendReport(assessment.report_markdown);
console.log(JSON.stringify({ runId, findings: findings.length, sites: targets.length }));

async function sendReport(markdown) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const from = process.env.GMAIL_FROM;
  const to = process.env.SECURITY_REPORT_TO;
  if (!clientId || !clientSecret || !refreshToken || !from || !to) {
    console.log("Email skipped: Gmail OAuth secrets or SECURITY_REPORT_TO are not configured.");
    return;
  }
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) throw new Error("Gmail OAuth token request failed.");
  const subject = `Security assessment ${new Date().toISOString().slice(0, 10)}`;
  const raw = [`From: ${from}`, `To: ${to}`, "Content-Type: text/plain; charset=utf-8", `Subject: ${subject}`, "", markdown].join("\\r\\n");
  const encoded = Buffer.from(raw).toString("base64url");
  const sent = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: encoded }) });
  if (!sent.ok) throw new Error(`Gmail send failed: ${sent.status}`);
  console.log("Security report email sent.");
}
