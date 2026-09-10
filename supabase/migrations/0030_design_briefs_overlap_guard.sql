-- Obsidian OS — overlap protection for design_briefs, same pattern as
-- 0029_website_analyses_overlap_guard.sql, scoped per-mission: two
-- different missions running Design Brief generation concurrently is
-- normal, expected usage — the bug is two runs racing for the SAME
-- mission (a double-click, or a retry firing before the original
-- background job finished).
--
-- 'pending' is included alongside 'running': createDesignBriefRun()
-- inserts at 'pending' synchronously in the route, and runDesignBrief()
-- only flips it to 'running' later in the background job it's not
-- awaited by — a running-only index would leave a real race window open
-- between those two states.
--
-- Confirmed no existing data would violate this before creating it: zero
-- missions currently have more than one pending/running design_briefs row.

create unique index if not exists design_briefs_one_inflight_per_mission
  on public.design_briefs (mission_id)
  where status in ('pending', 'running');
