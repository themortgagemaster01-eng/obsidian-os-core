-- Obsidian OS — overlap protection for website_analyses, same pattern as
-- 0026_mission_batch_overlap_guard.sql / 0028_lead_scan_runs_overlap_guard.sql,
-- scoped per-mission rather than per-organization: two different missions
-- in the same org running analysis concurrently is normal, expected usage
-- (a founder can work two leads at once) — the real bug is two analyses
-- racing for the SAME mission (a double-click, or a retry firing before
-- the original background job finished).
--
-- 'pending' is included alongside 'running': createAnalysisRun() inserts
-- at 'pending' synchronously in the route, and runAnalysis() only flips it
-- to 'running' later in the background job it's not awaited by — a
-- running-only index would leave a real race window open between those
-- two states.
--
-- Confirmed no existing data would violate this before creating it: zero
-- missions currently have more than one pending/running website_analyses
-- row.

create unique index if not exists website_analyses_one_inflight_per_mission
  on public.website_analyses (mission_id)
  where status in ('pending', 'running');
