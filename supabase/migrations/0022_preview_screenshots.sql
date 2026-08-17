-- Obsidian OS — Phase 4: real screenshot capture of the LIVE, authenticated
-- Design Preview route (app/missions/[id]/preview/page.tsx), extending the
-- same website_designs row Generation/Refinement/QA already write to
-- (mirrors 0014_design_refinement.sql / 0015_design_qa.sql's own precedent:
-- one artifact, one row extended, not a new table per pipeline sub-stage).
--
-- lib/adapters/rendered-preview-adapter.ts already captures real screenshots
-- of this exact route for Design QA, but discards the bytes (only
-- byteLength is kept, as evidence-of-rendering) — this migration is what
-- makes a real capture durable and displayable instead. Uploaded to the
-- same private "website-screenshots" bucket (0007/0008) the ORIGINAL
-- business's own site screenshot already uses, under a `design/` path
-- segment, so no new bucket or RLS policy is needed.
--
-- No new mission state, deliberately: lib/workflow/mission-state.ts's own
-- documented decision is that "publishing a preview build is a sub-activity
-- of QA/design review, tracked via events... rather than a pipeline gate" —
-- this follows that exactly, the same way qa_result does not get its own
-- status column either (its own presence/absence on the row is the signal).
alter table public.website_designs
  add column if not exists preview_screenshot_desktop_path text,
  add column if not exists preview_screenshot_mobile_path text,
  add column if not exists preview_screenshot_captured_at timestamptz,
  add column if not exists preview_screenshot_error text;

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
    'PreviewScreenshotFailed'
  ));
