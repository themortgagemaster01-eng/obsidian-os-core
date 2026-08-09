-- Obsidian OS — Sprint 4 Phase 4: persist Design QA output alongside the
-- existing wireframe/components/refined_design on the same website_designs
-- row it graded, mirroring 0014_design_refinement.sql's own precedent (one
-- artifact, one row extended, not a new table per pipeline sub-stage).

alter table public.website_designs
  add column if not exists qa_result jsonb;

-- =========================================================================
-- mission_events.event_type: add Design QA's two event types
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
    'DesignQaFailed'
  ));
