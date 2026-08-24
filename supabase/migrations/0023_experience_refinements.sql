-- Obsidian OS — Phase 6.4: Human-in-the-Loop Experience Refinement.
--
-- experience_refinements — lib/services/experience-refinement-service.ts's
-- output. One row per founder refinement action (including an explicit
-- "Reset to AI Recommendation", which submits the neutral preference as its
-- own real, loggable row rather than deleting history). Insert-only by
-- design, both in application code and structurally at the RLS layer below
-- (select + insert policies only — no update, no delete) — mirrors this
-- codebase's existing "Decision Memory is permanent history... never
-- overwritten" doctrine (CLAUDE.md) and website_designs' own "latest wins via
-- insert" precedent (0010_design_engine.sql), rather than editing a row in
-- place the way design_briefs.brief's "approve with edits" does. The
-- founder's own Phase 6.4 directive is explicit that that mechanism is
-- precedent only, not a shortcut to reuse here.
--
-- Three distinct values are preserved per row (§5): baseline_plan (the AI's
-- own recommendation, computed fresh from current evidence — never the
-- founder's previous refinement's resolved_plan, so no refinement can drift
-- off of what the intelligence layer actually currently recommends),
-- preference (the founder's raw, bounded Experience Tone / Motion Intensity
-- request), and resolved_plan (what the existing mode/evidence/intensity
-- ceiling composition actually allowed once that preference was applied).
-- explanation + was_constrained make the resolution honestly inspectable
-- without recomputing it — was_constrained is true exactly when resolved_plan
-- fell short of what the founder's raw preference direction asked for.

create table if not exists public.experience_refinements (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  website_design_id uuid not null references public.website_designs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),

  -- HumanExperiencePreference (shared/design-intelligence/types.ts) — always
  -- both axes present, "keep"/"recommended" included, since the founder UI is
  -- two required button groups, not optional freeform fields.
  preference jsonb not null,

  -- ExperiencePlan (shared/design-intelligence/types.ts), computed fresh from
  -- the current website_design's evidence at refinement time — never copied
  -- forward from an earlier refinement row (§6's "do not silently carry
  -- preferences/assumptions forward when evidence changes").
  baseline_plan jsonb not null,
  resolved_plan jsonb not null,

  explanation text not null,
  was_constrained boolean not null default false,

  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists experience_refinements_mission_id_idx on public.experience_refinements(mission_id);
create index if not exists experience_refinements_website_design_id_idx on public.experience_refinements(website_design_id);
create index if not exists experience_refinements_organization_id_idx on public.experience_refinements(organization_id);
create index if not exists experience_refinements_created_at_idx on public.experience_refinements(created_at);

alter table public.experience_refinements enable row level security;

-- Deliberately SELECT + INSERT only — no UPDATE, no DELETE policy. A founder
-- action always produces a new row (including Reset to AI Recommendation);
-- nothing in this table is ever meant to change in place. This is the
-- structural enforcement of insert-only, not just an application-code
-- convention that could be bypassed by a future call site.
create policy "Org members can select experience refinements"
  on public.experience_refinements for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert experience refinements"
  on public.experience_refinements for insert
  with check (public.is_org_member(organization_id));

-- RLS policies alone don't grant table-level access — Postgres checks the
-- coarser GRANT first (the exact failure mode 0009/0013/0019 already
-- document: "permission denied for table X" despite correct RLS). Grant only
-- select + insert, matching the insert-only policy set above exactly — a
-- broader grant here would silently reopen the update/delete path RLS was
-- just used to close off.
grant select, insert on
  public.experience_refinements
to authenticated, service_role;

-- =========================================================================
-- mission_events.event_type: add ExperienceRefined
-- =========================================================================

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
    'DesignBriefApproved',
    'WebsiteDesignReady',
    'WebsiteDesignFailed',
    'DesignQaComplete',
    'DesignQaFailed',
    'PreviewScreenshotCaptured',
    'PreviewScreenshotFailed',
    'ExperienceRefined'
  ));
