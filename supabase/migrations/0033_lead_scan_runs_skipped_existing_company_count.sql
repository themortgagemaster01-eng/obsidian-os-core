-- Lead Hunter false-alarm fix (2026-09-13): runLeadHunterScan
-- (lib/services/lead-hunter-service.ts) has always computed
-- skippedExistingCompanyCount in memory — a candidate whose website_url
-- already matches a real, tracked company in this org is deliberately
-- skipped, never re-discovered as a "new" lead (a business already in the
-- real pipeline isn't a Lead Hunter candidate anymore). But this count was
-- never persisted anywhere, and the API route that fires runLeadHunterScan
-- as fire-and-forget background work never read the function's return value
-- either — so discovered_count could legitimately be far larger than
-- qualified_count + rejected_count with no visible explanation anywhere,
-- looking exactly like silently dropped leads. Two real production scans on
-- 2026-09-13 (mahopac, ny) showed discovered_count: 5 with qualified_count:
-- 0 and rejected_count: 1 and 2 respectively — the other 3-4 candidates per
-- run were real, correct existing-company skips (6 Mahopac businesses were
-- already tracked companies from earlier missions), not a bug, but
-- completely invisible without this column.
alter table public.lead_scan_runs
  add column if not exists skipped_existing_company_count integer;

comment on column public.lead_scan_runs.skipped_existing_company_count is
  'Discovered candidates whose website_url already matched a tracked company in this org — deliberately skipped, never a lead row. Nullable like every other funnel count: a still-running or failed row has no real final count yet.';
