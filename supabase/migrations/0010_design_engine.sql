-- Obsidian OS — Sprint 4 Phase 2: the Design Engine's persistence layer.
-- Two tables, one per service that owns a pipeline stage transition, mirroring
-- website_analyses' own precedent (0007_website_analysis.sql): one row per
-- run, versioned, never overwritten in place — a re-run inserts a new row.
--
-- design_briefs — design-brief-service.ts's output (docs/
-- SPRINT_4_ARCHITECTURE_RECOMMENDATION.md §1, §2). Runs during the
-- `researching` state per that document's resolution of Design Review Open
-- Question 1: the Design Brief step genuinely IS the researching stage's
-- real work, not a state to skip. The full DesignBrief object (citations,
-- direction, references considered) is persisted as JSON rather than
-- normalized into columns — it's read back as a whole object by
-- design-generation-service.ts and any future founder-review UI, the same
-- rationale website_analyses used for its own raw-result columns.
--
-- website_designs — design-generation-service.ts's output. Runs during the
-- `designing` state, one row per (design_brief_id) run. This table does NOT
-- itself transition mission state on completion — per the founder's Phase 2
-- guidance, Generation assembles designs, it doesn't judge them; only a
-- future design-qa-service.ts (Phase 3, not yet built) owns the
-- `designing -> qa` transition, mirroring how analysis-service.ts is the
-- only thing that transitions into `analyzing`.

create table if not exists public.design_briefs (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  company_id uuid references public.companies(id),

  status text not null default 'pending' check (status in (
    'pending',
    'running',
    'complete',
    'failed'
  )),

  -- Denormalized for cheap filtering/analytics without unpacking the JSON
  -- blob below — same rationale as website_analyses.opportunity_score.
  industry_bucket text,

  -- The full DesignBrief object (lib/services/design-brief-service.ts) —
  -- citations, target audience, positioning, direction, references
  -- considered. Not persisted until status = 'complete'.
  brief jsonb,

  error_message text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists design_briefs_mission_id_idx on public.design_briefs(mission_id);
create index if not exists design_briefs_organization_id_idx on public.design_briefs(organization_id);
create index if not exists design_briefs_status_idx on public.design_briefs(status);

alter table public.design_briefs enable row level security;

create policy "Org members can select design briefs"
  on public.design_briefs for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert design briefs"
  on public.design_briefs for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update design briefs"
  on public.design_briefs for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete design briefs"
  on public.design_briefs for delete
  using (public.is_org_member(organization_id));

create table if not exists public.website_designs (
  id uuid primary key default gen_random_uuid(),
  design_brief_id uuid not null references public.design_briefs(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),

  status text not null default 'pending' check (status in (
    'pending',
    'running',
    'complete',
    'failed'
  )),

  -- The Wireframe (section order + rationale) and the assembled component
  -- tree (lib/services/design-generation-service.ts) — Typography/Spacing/
  -- Motion passes are Phase 3 (Design Refinement), not this table's concern
  -- yet; those will extend this row's shape when built, not replace it.
  wireframe jsonb,
  components jsonb,

  error_message text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists website_designs_design_brief_id_idx on public.website_designs(design_brief_id);
create index if not exists website_designs_mission_id_idx on public.website_designs(mission_id);
create index if not exists website_designs_organization_id_idx on public.website_designs(organization_id);
create index if not exists website_designs_status_idx on public.website_designs(status);

alter table public.website_designs enable row level security;

create policy "Org members can select website designs"
  on public.website_designs for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert website designs"
  on public.website_designs for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update website designs"
  on public.website_designs for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete website designs"
  on public.website_designs for delete
  using (public.is_org_member(organization_id));

-- =========================================================================
-- mission_events.event_type: add the Design Engine's four event types
-- =========================================================================
-- One completion + one failure event per pipeline-stage-owning service,
-- mirroring the granularity docs/SPRINT_4_DESIGN_REVIEW.md §4 asked for
-- ("at least one new event type recording design generation completed...
-- and one for failure") applied per-stage, consistent with how
-- analysis-service.ts publishes its own WebsiteScanned/SEOComplete at its
-- own transition point rather than one generic event for the whole engine.

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
    'AnalysisFailed',
    'DesignBriefReady',
    'DesignBriefFailed',
    'WebsiteDesignReady',
    'WebsiteDesignFailed'
  ));
