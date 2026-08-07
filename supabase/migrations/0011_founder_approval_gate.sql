-- Obsidian OS — Founder Architecture Spec v1.0, item 2: the Founder
-- Approval Gate between the Design Brief and Generation Engine steps.
--
-- docs/ARCHITECTURE_SPECIFICATION_V1.md's pipeline is explicit that
-- Analysis -> Design Brief -> founder reviews -> approve/edit -> Generation
-- -> QA is a real, manual checkpoint — not an automatic pass-through. Sprint
-- 4 Phase 2 shipped design-brief-service.ts auto-advancing
-- researching -> designing with no gate, which the spec calls out as
-- needing fixing. This migration adds the state the mission now waits in
-- between those two steps.

-- =========================================================================
-- missions.state: insert "reviewing" between "researching" and "designing"
-- =========================================================================
-- New primary sequence: discovered -> analyzing -> researching -> reviewing
-- -> designing -> qa -> proposal -> email -> approval -> sent -> archived.
-- "reviewing" is distinct from the existing "approval" state further down
-- the pipeline — "approval" gates the founder's review of the finished
-- proposal/email before sending; "reviewing" gates the founder's review of
-- the Design Brief before any generation cost is spent, the cheapest,
-- highest-leverage review point in the whole pipeline per
-- docs/SPRINT_4_DESIGN_REVIEW.md §11.

alter table public.missions
  drop constraint if exists missions_state_check;
alter table public.missions
  add constraint missions_state_check check (state in (
    'discovered',
    'analyzing',
    'researching',
    'reviewing',
    'designing',
    'qa',
    'proposal',
    'email',
    'approval',
    'sent',
    'archived',
    'rejected'
  ));

-- =========================================================================
-- design_briefs: record who approved (and optionally edited) a brief
-- =========================================================================

alter table public.design_briefs
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

-- =========================================================================
-- mission_events.event_type: add DesignBriefApproved
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
    'WebsiteDesignFailed'
  ));
