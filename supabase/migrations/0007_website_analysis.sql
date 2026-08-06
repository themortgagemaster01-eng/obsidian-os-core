-- Obsidian OS — Sprint 3 / Decision 6.
-- website_analyses: the Analysis Engine's persistence layer, per
-- docs/SPRINT_3_DESIGN_REVIEW.md §4. One row per analysis run — versioned,
-- never overwritten in place (a re-run inserts a new row rather than
-- mutating an existing one), so Raw Analysis and Normalized Analysis for a
-- given run stay a single immutable, queryable snapshot. Which row is
-- "current" for a mission with multiple runs is Open Question 4 in the
-- design doc — not resolved here, deliberately.
--
-- Carries the Raw Analysis and Normalized Analysis layers from §3. Insights
-- and the assembled OpportunityReport (§7) are NOT persisted in v1 — both
-- are computed on read from a website_analyses row, per §4's rationale
-- (deterministic functions of Normalized Analysis, no external randomness,
-- same reasoning that already justified not persisting the report object).
-- opportunity_score is the one exception: persisted directly since it's
-- needed by Mission Control's list/report header without recomputing the
-- full pipeline.

create table if not exists public.website_analyses (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  -- Denormalized, same rationale as mission_events.organization_id and
  -- decisions.organization_id: avoids a join to missions in every RLS
  -- check and every analytics query.
  organization_id uuid not null references public.organizations(id),
  -- For future cross-mission history at the company level.
  company_id uuid references public.companies(id),

  -- Job-execution state for the §2 async flow: POST /api/missions/:id/analyze
  -- creates the row at 'pending' and returns immediately; the background
  -- worker flips it to 'running', then 'complete' or 'failed'.
  status text not null default 'pending' check (status in (
    'pending',
    'running',
    'complete',
    'failed'
  )),

  -- ---------------------------------------------------------------------
  -- Raw Analysis layer (§3.1) — exactly what each adapter returns,
  -- unmodified. Vendor-shaped, not guaranteed stable across adapter/library
  -- upgrades. Owned by lib/services/analysis-service.ts; nothing outside it
  -- should read these columns directly.
  -- ---------------------------------------------------------------------
  crawl_result jsonb,
  mobile_result jsonb,
  seo_result jsonb,
  accessibility_result jsonb,
  lighthouse_result jsonb,
  tech_detection_result jsonb,

  -- ---------------------------------------------------------------------
  -- Normalized Analysis layer (§3.2) — analysis-service's output: a
  -- consistent 0-100 score + short structured findings list per dimension,
  -- no longer varying by which vendor/library produced it. This is the
  -- contract the rest of the pipeline (Insights, Opportunity Score) reads
  -- from — if a future sprint swaps the Lighthouse adapter for a different
  -- tool, this shape shouldn't need to change.
  -- ---------------------------------------------------------------------
  mobile_score numeric,
  mobile_findings jsonb,
  seo_score numeric,
  seo_findings jsonb,
  accessibility_score numeric,
  accessibility_findings jsonb,
  lighthouse_performance numeric,
  lighthouse_accessibility numeric,
  lighthouse_best_practices numeric,
  lighthouse_seo numeric,
  technology_stack jsonb,

  -- Opportunity Score (§8, computed by opportunity-scoring-service.ts from
  -- the five normalized categories above) — the one downstream-pipeline
  -- value persisted directly rather than recomputed on every read, since
  -- Mission Control's list/report header needs it without running the full
  -- pipeline. Distinct from decisions.opportunity_score (the human decision
  -- record, ADR-008) — this is the computed value.
  opportunity_score numeric,

  screenshot_url text,
  error_message text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists website_analyses_mission_id_idx on public.website_analyses(mission_id);
create index if not exists website_analyses_organization_id_idx on public.website_analyses(organization_id);
create index if not exists website_analyses_company_id_idx on public.website_analyses(company_id);
create index if not exists website_analyses_status_idx on public.website_analyses(status);

alter table public.website_analyses enable row level security;

create policy "Org members can select website analyses"
  on public.website_analyses for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert website analyses"
  on public.website_analyses for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update website analyses"
  on public.website_analyses for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete website analyses"
  on public.website_analyses for delete
  using (public.is_org_member(organization_id));

-- =========================================================================
-- mission_events.event_type: add AnalysisFailed
-- =========================================================================
-- The one genuinely new event type this sprint introduces (§11) — every
-- other analysis-related event reuses/expands the existing WebsiteScanned
-- and SEOComplete payloads rather than adding new types, per ADR-010's
-- precedent of reconciling with existing vocabulary before adding new
-- concepts. AnalysisFailed has no existing analog, so it's additive.

alter table public.mission_events
  drop constraint if exists mission_events_event_type_check;
alter table public.mission_events
  add constraint mission_events_event_type_check check (event_type in (
    'MissionStarted',
    'WebsiteScanned',
    'SEOComplete',
    'ProposalReady',
    'EmailDraftReady',
    'MissionApproved',
    'MissionRejected',
    'MissionArchived',
    'StateChanged',
    'DecisionLogged',
    'AnalysisFailed'
  ));

-- =========================================================================
-- Storage: website-screenshots bucket
-- =========================================================================
-- First real consumer of Supabase Storage (docs/08-Integrations.md).
-- Created private by default (public = false) — bucket-level access-policy
-- details (public read vs. signed URLs, retention, size limits) are Open
-- Question 6 in the design doc, not resolved here. Screenshot access goes
-- through the app's own auth/RLS-aware code path, not a public bucket URL,
-- until that question is answered.

insert into storage.buckets (id, name, public)
values ('website-screenshots', 'website-screenshots', false)
on conflict (id) do nothing;
