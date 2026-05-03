# Fuze Ecoteer Impact Dashboard

A simple local dashboard for weekly project impact updates, social media evidence, website proof blocks, and report-ready impact stats.

## Open the dashboard

The easiest version does not need a server. Open:

`open_dashboard.bat`

This opens the dashboard as a normal page and saves entries in the browser on this computer.

## Team update form

Open this form link for project leaders to submit daily or weekly updates on this computer:

`public/form.html`

The dashboard also has a `Team update form` button in the top-right corner.

## Supabase setup

The app is now configured for Supabase using:

`https://duzudeowllmfaugrbave.supabase.co`

To activate online saving:

1. Open Supabase.
2. Go to SQL Editor.
3. Paste and run `supabase_schema.sql`.
4. Refresh the dashboard/form.

After the tables are created, form submissions should save online. If Supabase is not ready or rejects a save, the app falls back to local browser storage.

Important: the starter SQL includes temporary public insert/read policies so the public form can work before login exists. Replace these with proper login and role-based permissions before adding finance, CRM, accounting, staff data, or private documents.

## Vercel deployment

This project includes `vercel.json`, which tells Vercel to publish the `public` folder.

Suggested public links after deployment:

- Dashboard: `/`
- Team update form: `/form`
- Friendly team form link: `/team-update`

Before adding finance, CRM, accounting, or private documents, add login and role-based permissions.

## Start the database-backed version

Open `run_dashboard.bat`, then visit:

http://127.0.0.1:8000

## What it stores

- PTP: turtles sighted in water, turtles nested, number of nests
- PMRS: beach clean-up data and coral survey data
- PEEP: students reached, subjects taught, classes or sessions
- Volunteers: project, name, contact, dates, hours, notes
- Story evidence: location, story highlight, impact message, photo/video link, partner or stakeholder, follow-up needs
- Content flags: mark entries as useful for social media, website updates, or both

The database is saved at:

`data/impact_dashboard.sqlite3`

## Weekly email reminders

The dashboard includes the project leaders from the company knowledge document:

- PTP: Shafiqah
- PMRS: Carmen
- PEEP: Balqis

Add their email addresses in the Weekly reminders panel. The email template can be copied from the dashboard. To actually send weekly reminder emails from Gmail, the leader email addresses are needed first.

## Content queue

When a project leader ticks `Good for social media` or `Good for website/report`, the entry appears in the content queue. The dashboard drafts:

- a social media caption
- a website impact block

These are starting points for editing before posting.
