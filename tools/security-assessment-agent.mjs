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
console.log(JSON.stringify({ runId, findings: findings.length, sites: targets.length }));
