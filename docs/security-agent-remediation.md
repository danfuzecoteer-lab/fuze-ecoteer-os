# Security Remediation Agent

Run every Tuesday and Friday at 10:00 Malaysia time (02:00 UTC), after the preceding assessment. Read open findings from `security_findings`, reproduce them locally, and make the smallest safe fix.

Create a branch and pull request for each logical fix. Add regression tests and run syntax, build, dependency, and safe endpoint checks. Update `security_remediation_runs` and the related finding with the PR URL and evidence.

Never deploy directly to production, change production data, rotate credentials, weaken controls, or modify Auth/RLS/storage/retention without human approval. Block the PR when the issue affects personal data, authentication, payments, database permissions, or production infrastructure until an owner approves it.

Required secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN`, `SECURITY_TARGETS_JSON`, and `SECURITY_REMEDIATION_COMMAND`.
