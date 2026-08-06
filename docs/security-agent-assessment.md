# Security Assessment Agent

Run every Monday and Thursday at 10:00 Malaysia time (02:00 UTC) against only the approved production domains listed in `SECURITY_TARGETS_JSON`.

Perform non-destructive checks for authentication, authorization, IDOR, sensitive files, APIs, Supabase RLS/storage/RPC exposure, headers, CORS, cookies, uploads, injection indicators, dependencies, secrets, and workflow risks. Do not alter data, create accounts, spam forms, upload personal data, or test systems outside the target list.

For each finding record severity, site, route, evidence, impact, recommendation, confidence, and a stable fingerprint. Never store secrets or full personal-data values. Save the assessment and findings in Supabase tables `security_assessments` and `security_findings`, email the Markdown report, and open/update GitHub issues for Critical and High findings.

Required secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SECURITY_REPORT_TO`, `RESEND_API_KEY`, `SECURITY_FROM_EMAIL`, and `SECURITY_TARGETS_JSON`.
