-- Obsidian OS — Phase 9: Controlled Batch Preparation.
--
-- mission_batch_runs: the exact same shape and discipline as
-- lead_scan_runs (0021_lead_scan_runs.sql) — one row per run, real counts,
-- always reaching a real terminal status, never a fabricated number
-- standing in for "not computed yet". Deliberately a SEPARATE table from
-- lead_scan_runs (same "keep entities separated" precedent 0018/0021's own
-- header comments already document): a scan run is about discovering and
-- qualifying candidates; a mission batch run is about driving
-- ALREADY-qualified candidates through the existing mission pipeline
-- (Phase 4/8's own generation/refinement/QA/proposal/email-draft chain,
-- entirely unmodified) to a founder-review-ready package. Conflating the
-- two funnels would be exactly the mistake those two migrations' own
-- comments already warn against.
--
-- Per-mission progress is deliberately NOT duplicated here — it is already
-- fully, durably tracked by missions.state and mission_events. This table
-- only records the run's own intent (target/cap/location) and its own
-- terminal outcome (attempted/succeeded/failed counts, a small per-attempt
-- results log for real, useful error visibility, and a real terminal
-- status) — never a parallel pipeline, never a second source of truth for
-- what any one mission's own state already says.

create table if not exists public.mission_batch_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),

  -- The free-text target area, identical in kind to lead_scan_runs.location
  -- — matched against leads.location (itself populated from the same real
  -- GeocodedArea.displayName every Lead Hunter scan already writes). No new
  -- geographic system: this table only ever filters on data Lead Hunter
  -- already produced.
  location text not null,

  -- "Process 5" — the founder's own requested number of successful,
  -- approval-ready packages. A mission only counts once it reaches
  -- missions.state = 'approval' with a real, persisted proposal AND a real
  -- email draft (lib/services/proposal-service.ts /
  -- lib/services/email-draft-service.ts, both unmodified) — never merely
  -- "a mission was created" or "a mission was attempted".
  requested_count integer not null,

  -- The safety cap (Model C, docs/PHASE_9_CONTROLLED_BATCH_AUDIT.md §C):
  -- the run stops once requested_count successes exist, OR the eligible
  -- candidate pool for this location is exhausted, OR this many real
  -- attempts have been made — whichever comes first. Mirrors
  -- discoverBusinesses' own existing "clamped to a hard cap so a
  -- misconfigured run can't run away" discipline.
  max_attempts integer not null,

  -- running: the batch has started, counts below are not final yet.
  -- complete: the run reached one of its real stop conditions honestly
  -- (target met, pool exhausted, or cap reached — see stop_reason).
  -- failed: the run itself errored before it could process any candidate at
  -- all (e.g. no organization, a real DB error) — counts stay null, never a
  -- fabricated zero standing in for "never actually ran" (same discipline
  -- lead_scan_runs.status = 'failed' already holds itself to).
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),

  -- Populated only once status = 'complete' — which real stop condition
  -- this run actually hit, so a founder reading this row later knows WHY it
  -- stopped, not just that it did.
  stop_reason text check (stop_reason in ('target_reached', 'pool_exhausted', 'max_attempts_reached')),

  attempted_count integer not null default 0,
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,

  -- Per-attempt outcome log — real, useful error visibility per Robert's
  -- own explicit request ("record... useful errors"), never a duplicate of
  -- what missions.state/mission_events already track: {leadId, missionId,
  -- businessName, outcome: "succeeded" | "failed", failedStage?,
  -- errorMessage?}[]. Append-only within a run, from the application layer.
  results jsonb not null default '[]'::jsonb,

  error_message text,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mission_batch_runs_organization_id_idx on public.mission_batch_runs(organization_id);
create index if not exists mission_batch_runs_org_started_at_idx on public.mission_batch_runs(organization_id, started_at desc);

alter table public.mission_batch_runs enable row level security;

create policy "Org members can select mission batch runs"
  on public.mission_batch_runs for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert mission batch runs"
  on public.mission_batch_runs for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update mission batch runs"
  on public.mission_batch_runs for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete mission batch runs"
  on public.mission_batch_runs for delete
  using (public.is_org_member(organization_id));

-- RLS policies alone don't grant table-level access — Postgres checks the
-- coarser GRANT first (0009/0013/0019's own documented failure mode).
grant select, insert, update, delete on
  public.mission_batch_runs
to authenticated, service_role;

-- =========================================================================
-- missions.batch_run_id: which run (if any) created this mission. Nullable
-- — a mission created the normal, one-at-a-time way (the plain "new
-- mission" dialog, or Lead Hunter promotion outside a batch) has none. Lets
-- a batch run find "which missions am I responsible for" without
-- duplicating any mission's own state — the mission's own `state` column
-- stays the one source of truth for its progress.
-- =========================================================================

alter table public.missions
  add column if not exists batch_run_id uuid references public.mission_batch_runs(id) on delete set null;

create index if not exists missions_batch_run_id_idx on public.missions(batch_run_id);
