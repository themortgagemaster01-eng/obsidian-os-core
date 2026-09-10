-- Obsidian OS — overlap protection for lead_scan_runs, mirroring
-- 0026_mission_batch_overlap_guard.sql exactly: nothing before this
-- migration prevented two "running" scans from existing at once for the
-- same organization — a real gap given runLeadHunterScan does the same
-- "don't hammer real, rate-limited/resource-heavy work" (Overpass,
-- Nominatim, sequential per-candidate crawls) that justified this same
-- guard for mission_batch_runs.
--
-- Confirmed no existing data would violate this before creating it: zero
-- organizations currently have more than one 'running' lead_scan_runs row.
--
-- This partial unique index is the real, final authority — the
-- application-level guard added alongside this migration
-- (lib/services/lead-hunter-service.ts::checkScanOverlap) is a courtesy
-- layer on top that produces an honest, legible 409 instead of a raw
-- constraint-violation error, and recovers a genuinely abandoned run; this
-- index is what actually guarantees the invariant.

create unique index if not exists lead_scan_runs_one_running_per_org
  on public.lead_scan_runs (organization_id)
  where status = 'running';
