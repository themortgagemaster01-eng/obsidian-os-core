-- Obsidian OS — AI Lead Hunter (Discovery Engine + Opportunity Scoring Agent,
-- per docs/MASTER_BLUEPRINT.md's §1/§4 pipeline naming: "Discovery Engine
-- (finds businesses with poor websites — real scraping/search logic, not a
-- stub)" and "the Opportunity Scoring Agent = Qualification"). First real
-- implementation of the Discovery Engine this codebase has named as a
-- future subsystem since Sprint 2 but never built.
--
-- `leads`: a candidate business Discovery found, scored, and ranked —
-- deliberately a SEPARATE entity from `companies` (docs/MASTER_BLUEPRINT.md-
-- style entity separation, restated in the CTO's Lead Hunter directive §13:
-- "keep these entities separated, not one giant object"). A lead is
-- unvalidated, pre-mission candidate data; `companies`/`missions` stay the
-- record of businesses actually taken into the makeover pipeline. Only a
-- `promoted` lead ever produces a `companies`/`missions` row (via the
-- existing findOrCreateCompany/createMission path, unchanged) — most leads
-- a scan finds are expected to stay `candidate` or `rejected` and never
-- become a company record at all, which is the whole point of qualifying
-- and ranking before committing pipeline resources to one.
--
-- Distinct score columns, never conflated (directive §2): website_score is
-- how good the CURRENT site already is (Lead Hunter's own cheap, crawl-only
-- proxy — see lib/services/lead-scoring-service.ts's own doc comment on why
-- this is intentionally NOT the same value as the existing, more expensive
-- website_analyses.opportunity_score, which requires a full Lighthouse/
-- accessibility run this scan-of-50-100 stage deliberately avoids paying
-- for on every candidate). opportunity_score is how worthwhile this
-- business is as a MAKEOVER PROSPECT (website_score plus business-
-- legitimacy/evidence-richness signals). confidence_score is how much real
-- data Discovery+qualification actually managed to capture for this
-- candidate — a thin real profile scores low confidence, never a
-- confident-sounding number standing in for data that was never captured
-- (the same "Unavailable, not a guessed score" discipline opportunity-
-- report-service.ts already holds itself to).
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),

  -- ---------------------------------------------------------------------
  -- Candidate identity — this lead's OWN copy of discovered facts, not a
  -- foreign key into companies (which this lead may never become a row in).
  -- ---------------------------------------------------------------------
  business_name text not null,
  -- Nullable: Discovery can find a real business with no website at all
  -- (a real, if less useful, candidate — never fabricated into having one).
  website_url text,
  industry text,
  business_category text,
  -- Free-text location (city/region) rather than a normalized address
  -- table — Discovery's own geocoding precision (lib/adapters/discovery-
  -- adapter.ts) doesn't warrant a stricter schema yet.
  location text,
  latitude numeric,
  longitude numeric,

  -- Which BusinessDiscoveryProvider found this candidate, and that
  -- provider's own id for it — the real dedupe key so a re-scan of the same
  -- area doesn't re-insert a lead already discovered (see the unique index
  -- below), and so a provider swap (e.g. a future paid Places API
  -- alongside the OSM/Overpass one) is traceable per-row.
  discovery_source text not null,
  discovery_external_id text not null,

  -- pending: inserted by a scan, not yet qualified. candidate: qualified
  -- and scored, awaiting founder review. rejected: qualification found no
  -- real operating business/website worth pursuing (explicit, never just
  -- silently dropped — a rejected row is itself evidence the scan worked).
  -- promoted: founder launched a makeover; company_id/mission_id are set.
  status text not null default 'pending' check (status in (
    'pending',
    'candidate',
    'rejected',
    'promoted'
  )),
  rejection_reason text,

  -- ---------------------------------------------------------------------
  -- Scores — see the module-level comment above for why these three are
  -- never the same number. All nullable: a `pending` lead has none of them
  -- yet (qualification/scoring hasn't run), which is honestly different
  -- from a `candidate` lead that scored a real, low number.
  -- ---------------------------------------------------------------------
  website_score numeric,
  opportunity_score numeric,
  confidence_score numeric,
  main_weaknesses jsonb not null default '[]'::jsonb,
  main_opportunity text,
  recommended_hero_pattern text,
  recommended_design_strategy text,

  -- ---------------------------------------------------------------------
  -- Real, qualification-captured evidence — same normalized contact shape
  -- lib/adapters/types.ts's ContactInfo already uses elsewhere in this
  -- codebase (phones/phoneEvidence/emails/address/hours), not a new,
  -- divergent shape. Raw crawl result kept too (mirrors website_analyses'
  -- own raw-plus-normalized precedent) so a promoted lead's already-
  -- gathered evidence can seed its Design Brief without re-crawling.
  -- ---------------------------------------------------------------------
  contact_evidence jsonb,
  social_links jsonb,
  crawl_result jsonb,

  -- Set only once this lead is promoted into the real pipeline — never
  -- populated speculatively.
  company_id uuid references public.companies(id) on delete set null,
  mission_id uuid references public.missions(id) on delete set null,

  error_message text,

  discovered_at timestamptz not null default now(),
  qualified_at timestamptz,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The real dedupe boundary: the same organization re-scanning the same area
-- should update/skip a candidate it already found, never insert a
-- duplicate row for it.
create unique index if not exists leads_org_source_external_id_idx
  on public.leads(organization_id, discovery_source, discovery_external_id);

create index if not exists leads_organization_id_idx on public.leads(organization_id);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_opportunity_score_idx on public.leads(opportunity_score desc);
create index if not exists leads_company_id_idx on public.leads(company_id);
create index if not exists leads_mission_id_idx on public.leads(mission_id);

alter table public.leads enable row level security;

create policy "Org members can select leads"
  on public.leads for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert leads"
  on public.leads for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update leads"
  on public.leads for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete leads"
  on public.leads for delete
  using (public.is_org_member(organization_id));
