create table if not exists public.marketing_research_rows (
  id bigserial primary key,
  research_type text not null check (research_type in ('Price Comparison', 'Competitor Analysis')),
  organisation text not null,
  offer text not null default '',
  visible_price text,
  strength text,
  risk text,
  fe_response text,
  target_market text,
  category text,
  source_url text,
  source text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  run_date date,
  last_seen_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (research_type, organisation, offer)
);

create table if not exists public.marketing_cold_email_leads (
  id bigserial primary key,
  lead_segment text not null check (lead_segment in ('School', 'Day care / Tadika / Taska', 'Corporate HR / CSR')),
  organisation_name text not null,
  country text not null default '',
  city text,
  website text,
  contact_department text,
  contact_name text,
  email text,
  linkedin_url text,
  research_notes text,
  likely_need text,
  recommended_offer text,
  personalization_angle text,
  priority text default 'medium',
  status text default 'new',
  next_action text,
  source text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  run_date date,
  last_seen_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (lead_segment, organisation_name, country)
);

alter table public.marketing_research_rows enable row level security;
alter table public.marketing_cold_email_leads enable row level security;

drop policy if exists "Marketing research rows are publicly readable" on public.marketing_research_rows;
create policy "Marketing research rows are publicly readable"
  on public.marketing_research_rows
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Marketing cold email leads are publicly readable" on public.marketing_cold_email_leads;
create policy "Marketing cold email leads are publicly readable"
  on public.marketing_cold_email_leads
  for select
  to anon, authenticated
  using (true);

grant select on public.marketing_research_rows to anon, authenticated;
grant select on public.marketing_cold_email_leads to anon, authenticated;
