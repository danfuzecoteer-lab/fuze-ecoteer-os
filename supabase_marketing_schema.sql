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
  country text,
  location text,
  primary_audience text,
  cost_from text,
  currency text,
  current_score integer check (current_score is null or (current_score >= 0 and current_score <= 100)),
  rating_band text,
  trend text,
  active_marketing_score integer check (active_marketing_score is null or (active_marketing_score >= 0 and active_marketing_score <= 50)),
  momentum_score integer check (momentum_score is null or (momentum_score >= 0 and momentum_score <= 20)),
  threat_level text,
  website_score integer check (website_score is null or (website_score >= 0 and website_score <= 15)),
  social_score integer check (social_score is null or (social_score >= 0 and social_score <= 15)),
  seo_aeo_score integer check (seo_aeo_score is null or (seo_aeo_score >= 0 and seo_aeo_score <= 20)),
  youtube_score integer check (youtube_score is null or (youtube_score >= 0 and youtube_score <= 10)),
  cost_value_score integer check (cost_value_score is null or (cost_value_score >= 0 and cost_value_score <= 10)),
  logistics_score integer check (logistics_score is null or (logistics_score >= 0 and logistics_score <= 8)),
  trust_score integer check (trust_score is null or (trust_score >= 0 and trust_score <= 7)),
  strategic_learning_score integer check (strategic_learning_score is null or (strategic_learning_score >= 0 and strategic_learning_score <= 5)),
  most_active_channel text,
  main_campaign_theme text,
  keyword_notes text,
  aeo_notes text,
  backlink_notes text,
  social_notes text,
  website_change_notes text,
  evidence_links text,
  what_we_can_learn text,
  how_we_are_better text,
  recommended_action text,
  source_url text,
  source text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  run_date date,
  last_seen_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (research_type, organisation, offer)
);

alter table public.marketing_research_rows
  add column if not exists country text,
  add column if not exists location text,
  add column if not exists primary_audience text,
  add column if not exists cost_from text,
  add column if not exists currency text,
  add column if not exists current_score integer check (current_score is null or (current_score >= 0 and current_score <= 100)),
  add column if not exists rating_band text,
  add column if not exists trend text,
  add column if not exists active_marketing_score integer check (active_marketing_score is null or (active_marketing_score >= 0 and active_marketing_score <= 50)),
  add column if not exists momentum_score integer check (momentum_score is null or (momentum_score >= 0 and momentum_score <= 20)),
  add column if not exists threat_level text,
  add column if not exists website_score integer check (website_score is null or (website_score >= 0 and website_score <= 15)),
  add column if not exists social_score integer check (social_score is null or (social_score >= 0 and social_score <= 15)),
  add column if not exists seo_aeo_score integer check (seo_aeo_score is null or (seo_aeo_score >= 0 and seo_aeo_score <= 20)),
  add column if not exists youtube_score integer check (youtube_score is null or (youtube_score >= 0 and youtube_score <= 10)),
  add column if not exists cost_value_score integer check (cost_value_score is null or (cost_value_score >= 0 and cost_value_score <= 10)),
  add column if not exists logistics_score integer check (logistics_score is null or (logistics_score >= 0 and logistics_score <= 8)),
  add column if not exists trust_score integer check (trust_score is null or (trust_score >= 0 and trust_score <= 7)),
  add column if not exists strategic_learning_score integer check (strategic_learning_score is null or (strategic_learning_score >= 0 and strategic_learning_score <= 5)),
  add column if not exists most_active_channel text,
  add column if not exists main_campaign_theme text,
  add column if not exists keyword_notes text,
  add column if not exists aeo_notes text,
  add column if not exists backlink_notes text,
  add column if not exists social_notes text,
  add column if not exists website_change_notes text,
  add column if not exists evidence_links text,
  add column if not exists what_we_can_learn text,
  add column if not exists how_we_are_better text,
  add column if not exists recommended_action text;

create table if not exists public.marketing_competitor_weekly_snapshots (
  id bigserial primary key,
  week_commencing date,
  date_checked date,
  organisation text not null,
  research_type text,
  category text,
  website_score integer,
  social_score integer,
  seo_aeo_score integer,
  youtube_score integer,
  cost_value_score integer,
  logistics_score integer,
  trust_score integer,
  active_marketing_score integer,
  strategic_learning_score integer,
  total_score integer,
  momentum_score integer,
  previous_score integer,
  score_change integer,
  status_label text,
  main_reason_for_movement text,
  evidence_links text,
  analyst_comments text,
  created_at timestamptz default now()
);

create table if not exists public.marketing_competitor_evidence_log (
  id bigserial primary key,
  evidence_date date,
  organisation text not null,
  evidence_type text,
  url text,
  observation text,
  why_it_matters text,
  action_for_us text,
  created_at timestamptz default now()
);

create table if not exists public.marketing_cold_email_leads (
  id bigserial primary key,
  lead_segment text not null check (lead_segment in ('School', 'Day care / Tadika / Taska', 'Tadika / Preschool', 'University', 'Corporate HR / CSR', 'Network / Referral Partner')),
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
  last_drafted_at timestamptz,
  last_drafted_by_agent text,
  last_draft_id text,
  last_draft_message_id text,
  draft_count integer not null default 0,
  source text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  run_date date,
  last_seen_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (lead_segment, organisation_name, country)
);

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.marketing_cold_email_leads'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%lead_segment%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.marketing_cold_email_leads drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.marketing_cold_email_leads
  add constraint marketing_cold_email_leads_lead_segment_check
  check (lead_segment in ('School', 'Day care / Tadika / Taska', 'Tadika / Preschool', 'University', 'Corporate HR / CSR', 'Network / Referral Partner'));

alter table public.marketing_cold_email_leads
  add column if not exists last_drafted_at timestamptz,
  add column if not exists last_drafted_by_agent text,
  add column if not exists last_draft_id text,
  add column if not exists last_draft_message_id text,
  add column if not exists draft_count integer not null default 0;

alter table public.marketing_research_rows enable row level security;
alter table public.marketing_competitor_weekly_snapshots enable row level security;
alter table public.marketing_competitor_evidence_log enable row level security;
alter table public.marketing_cold_email_leads enable row level security;

drop policy if exists "Marketing research rows are publicly readable" on public.marketing_research_rows;
create policy "Marketing research rows are publicly readable"
  on public.marketing_research_rows
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Marketing competitor snapshots are publicly readable" on public.marketing_competitor_weekly_snapshots;
create policy "Marketing competitor snapshots are publicly readable"
  on public.marketing_competitor_weekly_snapshots
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Marketing competitor evidence is publicly readable" on public.marketing_competitor_evidence_log;
create policy "Marketing competitor evidence is publicly readable"
  on public.marketing_competitor_evidence_log
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
grant select on public.marketing_competitor_weekly_snapshots to anon, authenticated;
grant select on public.marketing_competitor_evidence_log to anon, authenticated;
grant select on public.marketing_cold_email_leads to anon, authenticated;
