-- Obsidian OS — Phase 10: hard overlap protection for mission_batch_runs.
--
-- Nothing before this migration ever prevented two "running" batch rows
-- from existing at once for the same organization (docs/
-- PHASE_10_IMPLEMENTATION_PLAN.md §4) — safe so far only because every
-- batch has been founder-triggered by hand. A scheduled, unattended trigger
-- removes that human safety net, and the resource-contention reasoning
-- that already justified concurrency=1 inside a single batch
-- (lib/services/mission-batch-service.ts's own module comment: real
-- headless-Chromium and LLM rate-limit pressure) applies just as much
-- across two concurrent batches for the same organization, even targeting
-- different locations.
--
-- This partial unique index is the real, final authority: Postgres itself
-- rejects a second concurrent insert of a "running" row for an
-- organization that already has one, with no check-then-insert race
-- window. The application-level guard added alongside this migration
-- (lib/services/mission-batch-service.ts::runMissionBatch) is a courtesy
-- layer on top — it produces an honest, legible outcome instead of a raw
-- constraint-violation error, and it recovers a genuinely abandoned run
-- (§5) — but this index is what actually guarantees the invariant, and it
-- holds even if the application-level guard is ever bypassed, has a bug,
-- or is called by code that doesn't know about it yet.

create unique index if not exists mission_batch_runs_one_running_per_org
  on public.mission_batch_runs (organization_id)
  where status = 'running';
