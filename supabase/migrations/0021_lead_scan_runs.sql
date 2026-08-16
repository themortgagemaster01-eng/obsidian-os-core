-- Phase 3 (Opportunity Intelligence): `lead_scan_runs` — the "future phase"
-- 0018_lead_hunter.sql's own POST /api/leads/scan comment already named:
-- "A future phase could add a `lead_scans` run-status row mirroring
-- website_analyses' own pending/running/complete/failed shape, if a real
-- need for live progress shows up." That need is the CTO Phase 3 directive's
-- scan funnel reporting — one row per real scan run, carrying the real
-- funnel-stage counts (discovered -> qualified/"usable website" ->
-- meaningful opportunity -> high confidence -> queued) so they survive
-- POST /api/leads/scan's fire-and-forget boundary and can be shown on the
-- Lead Hunter dashboard, not just logged and discarded.
--
-- Deliberately a separate table from `leads` (same "keep entities
-- separated" precedent 0018's own header comment documents) — a scan run is
-- a session/event record, not qualification evidence about one business.
--
-- Learned from 0009/0013/0019's own repeated pattern (RLS alone isn't the
-- real access boundary; a base-table GRANT was forgotten three separate
-- times and needed its own follow-up migration each time) — the grant
-- lives in THIS migration, not a follow-up one.
create table if not exists public.lead_scan_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),

  location text not null,
  industry_buckets jsonb not null default '[]'::jsonb,
  scan_size integer,

  -- running: scan started, funnel counts not final yet. complete: the real,
  -- final funnel for this run. failed: the run itself errored before
  -- producing a real funnel (e.g. geocoding failed) — counts stay null,
  -- never a fabricated zero standing in for "never actually ran."
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),

  -- The funnel (CTO Phase 3 directive): discovered_count -> qualified_count
  -- ("usable website" — a real site that actually loaded) ->
  -- meaningful_opportunity_count (qualified AND makeover_potential is not
  -- 'reject' — a real, non-zero upside) -> high_confidence_count (meaningful
  -- opportunity AND confidence_score above the v1 threshold
  -- lib/services/lead-hunter-service.ts documents) -> queued_count (the
  -- final slice presented as today's queue, capped at this run's own
  -- requested queue size). All nullable: a still-`running` or `failed` row
  -- has no real final counts yet — never a fabricated 0 standing in for
  -- "not computed."
  discovered_count integer,
  qualified_count integer,
  rejected_count integer,
  meaningful_opportunity_count integer,
  high_confidence_count integer,
  queued_count integer,

  error_message text,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_scan_runs_organization_id_idx on public.lead_scan_runs(organization_id);
create index if not exists lead_scan_runs_org_started_at_idx on public.lead_scan_runs(organization_id, started_at desc);

alter table public.lead_scan_runs enable row level security;

create policy "Org members can select lead scan runs"
  on public.lead_scan_runs for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert lead scan runs"
  on public.lead_scan_runs for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update lead scan runs"
  on public.lead_scan_runs for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete lead scan runs"
  on public.lead_scan_runs for delete
  using (public.is_org_member(organization_id));

grant select, insert, update, delete on
  public.lead_scan_runs
to authenticated, service_role;
