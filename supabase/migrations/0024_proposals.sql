-- Obsidian OS — Phase 8: Prospect-to-Approval Workflow.
--
-- proposals: one row per mission, created once a mission's Design QA has
-- completed (missions.state = 'qa'). Holds the deterministic proposal
-- content assembled from already-authoritative data (OpportunityReport,
-- DesignBrief, DesignQaReport, and — when this mission originated from a
-- promoted lead — that lead's own captured qualification evidence), plus
-- the deterministic, founder-editable email draft generated from it.
--
-- Mirrors design_briefs' own "one current row per mission, updated in
-- place" precedent (0010_design_engine.sql) rather than
-- experience_refinements' insert-only history shape (0023): a proposal/
-- email draft is a live, editable-until-approved value, not permanent
-- decision history — that history is what the existing `decisions` table
-- (0004_decision_intelligence.sql-era) already exists to record, via
-- lib/services/decision-service.ts's own logDecision, the first real
-- caller of which this phase provides.

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),

  status text not null default 'draft' check (status in (
    'draft',
    'approved',
    'rejected'
  )),

  -- The structured ProposalContent object (lib/services/proposal-service.ts)
  -- — business identity, current-website observations, why this business
  -- qualified, key opportunities, value proposition, demo link, proposed
  -- next step, plus a QA summary. Null until proposal assembly completes.
  content jsonb,

  -- The deterministic email draft (lib/services/email-draft-service.ts) —
  -- kept as plain columns, not nested inside content, because this is the
  -- one part of this row a founder directly edits before approval
  -- (decision_type 'edit_email' on the existing `decisions` table). Null
  -- until email-draft generation completes.
  email_subject text,
  email_body text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One current proposal per mission — a re-run overwrites the same row
-- (application-level upsert), never accumulates duplicates.
create unique index if not exists proposals_mission_id_idx on public.proposals(mission_id);
create index if not exists proposals_organization_id_idx on public.proposals(organization_id);
create index if not exists proposals_status_idx on public.proposals(status);

drop trigger if exists set_proposals_updated_at on public.proposals;
create trigger set_proposals_updated_at
  before update on public.proposals
  for each row execute procedure public.set_updated_at();

alter table public.proposals enable row level security;

create policy "Org members can select proposals"
  on public.proposals for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert proposals"
  on public.proposals for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update proposals"
  on public.proposals for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete proposals"
  on public.proposals for delete
  using (public.is_org_member(organization_id));

-- RLS policies alone don't grant table-level access — Postgres checks the
-- coarser GRANT first (0009/0013/0019's own documented failure mode).
grant select, insert, update, delete on
  public.proposals
to authenticated, service_role;
