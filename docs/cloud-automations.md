# Cloud Automations

This project runs the Codex-style automation schedule from GitHub Actions so the jobs do not depend on Daniel's laptop being open.

## GitHub Actions

The primary cloud scheduler is `.github/workflows/cloud-automations.yml`.

It has scheduled triggers:

- `7 23 * * *`: 7:07 AM Asia/Kuala_Lumpur.
- `7 14 * * 0`: Sunday 10:07 PM Asia/Kuala_Lumpur.
- `7 15 * * 0`: Sunday 11:07 PM Asia/Kuala_Lumpur.

It can also be run manually from GitHub Actions with `workflow_dispatch`. Manual runs default to `dry_run=true`, which lists the automations without sending emails.

Test locally:

```powershell
node scripts/run-cloud-automations.js --group daily-7am --dry-run
```

## Vercel API Endpoints

The `api/cron/*` endpoints are kept for manual HTTP testing or a future Vercel Cron setup, but `vercel.json` does not currently schedule them.

If Vercel Cron is enabled later, schedules should use UTC. Kuala Lumpur is UTC+8.

## Required GitHub Secrets

- `OPENAI_API_KEY`: used to generate the report/email body.
- `OPENAI_MODEL`: optional; defaults to `gpt-5.4`.
- `GMAIL_CLIENT_ID`: Google OAuth client id.
- `GMAIL_CLIENT_SECRET`: Google OAuth client secret.
- `GMAIL_REFRESH_TOKEN`: refresh token for the Gmail account that sends the emails.
- `GMAIL_FROM`: optional; defaults to `dan.fuzecoteer@gmail.com`.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: service role key used by GitHub Actions only. Never expose this in browser code.

For Vercel endpoint testing only, also set `CRON_SECRET`.

## Current Cloud Jobs

- 7:07am daily: daily eco fun facts, world of research, green tech watchlist, FE portal suggestions report, and head of marketing.
- 7:07am Tuesday: competition analysis.
- 10pm Sunday: chief of staff.
- 11pm Sunday: cold email CRM research. The job writes to `public.marketing_cold_email_leads` in Supabase.

## Daily Eco FE Context

The Daily Eco email adds internal FE context from Supabase before generation:

- birthday greeting first when a volunteer has a birthday today; otherwise no birthday section is printed
- then a short eco dad joke
- global eco news with a marine focus, preferring Malaysia or Southeast Asia where possible
- newest `impact_entries` / Fun Impact item prioritized as the Project update
- one or two actual Perhentian project data highlights from embedded FE data sheets, not a long data dump
- current `volunteers` as Volunteers at site
- volunteers starting in the next 14 days as Volunteers coming up
- school/corporate groups currently with FE or arriving in the next 7 days
- volunteer birth dates as Birthdays today only
- anonymized `volunteer_feedback` summaries, rating themes, and low-rating watch points
- recent vendor/supplier `organisations` as New vendors
- HTML email rendering with markdown bold converted to real bold text, so raw `**` markers should not show in Gmail

The context intentionally excludes contact, passport, emergency, medical, diet, exact birth year, age, payment, balance details, and verbatim feedback that could identify someone.

## Notes

The first cloud version sends email reports and writes grants into Supabase. Jobs that previously depended on Codex Desktop access, Chrome sessions, Gmail connectors, or local files need explicit cloud credentials or APIs before they can fully match the local workflow.

The wider online database setup is documented in `docs/supabase-online-system.md`.
