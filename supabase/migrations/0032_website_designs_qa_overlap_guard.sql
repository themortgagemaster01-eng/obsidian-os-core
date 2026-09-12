-- Obsidian OS — overlap protection for Design QA (pipeline audit finding
-- #7, 2026-09-11), mirroring 0031_website_designs_overlap_guard.sql's own
-- pattern. Design QA doesn't insert a new row per run (0015_design_qa.sql's
-- own precedent: "one artifact, one row extended, not a new table per
-- pipeline sub-stage") — it writes qa_result onto the SAME website_designs
-- row Generation already produced. That row's existing `status` column
-- tracks Generation's own lifecycle (pending/running/complete/failed) and
-- can't be repurposed for QA's separate lifecycle without breaking every
-- existing consumer that already reads status = 'complete' to mean
-- "Generation finished" (capture-preview's and qa's own precondition
-- checks). qa_status is therefore a second, independent in-flight marker
-- on the same row: 'running' while QA is in flight, cleared (null) once it
-- settles either way (success or failure).

alter table public.website_designs
  add column if not exists qa_status text,
  add column if not exists qa_started_at timestamptz;

alter table public.website_designs
  drop constraint if exists website_designs_qa_status_check;
alter table public.website_designs
  add constraint website_designs_qa_status_check check (qa_status is null or qa_status = 'running');

-- Confirmed no existing data would violate this before creating it: the
-- column is brand new, so no row has qa_status set yet.
create unique index if not exists website_designs_one_qa_inflight_per_mission
  on public.website_designs (mission_id)
  where qa_status = 'running';
