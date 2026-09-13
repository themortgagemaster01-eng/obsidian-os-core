-- Qualification overhaul (2026-09-14), three real production bugs found
-- from Robert's own live use of the pool-widened Lead Hunter scan:
--
-- 1. `status` never respected makeover_potential's own "reject" verdict —
--    Pulse-MD Urgent Care and Stop & Shop both scored opportunity_score: 0
--    and makeover_potential: 'reject' (both correctly computed) yet still
--    landed as status: 'candidate' with boilerplate "real upside for a
--    redesign" text. Fixed in lib/services/lead-hunter-service.ts and
--    manual-lead-service.ts — no schema change needed for that part.
--
-- 2. No-website businesses (Balsamo-Codovano Funeral Home, confirmed live)
--    were unconditionally auto-rejected. Robert's own business builds new
--    sites for businesses that don't have one — that's the single best
--    lead category, not a rejection. This migration adds the real,
--    filterable 'new_build' makeover_potential value these leads now get
--    instead: website_score/opportunity_score/confidence_score stay null
--    (honestly un-scoreable — there is no site to score), and
--    main_opportunity/recommended_design_strategy get framed as new-build
--    pitch language rather than redesign language.
--
-- 3. Chain/franchise candidates (Stop & Shop, Dollar Tree, Pulse-MD — a
--    multi-location urgent care franchise) were never filtered — Robert
--    cold-pitches independent local businesses only; a chain with in-house
--    marketing and a corporate site is never a realistic target regardless
--    of its score. skipped_chain_count mirrors skipped_existing_company_
--    count's own transparency fix: a candidate OSM tags with brand/
--    brand:wikidata/brand:wikipedia is now skipped for free (never
--    consumes the real crawl budget), and this count makes that visible
--    in the funnel instead of silently shrinking discovered_count.
--
-- new_build_count is the funnel's own visibility fix for item 2 — without
-- it, discovered_count would stop reconciling to
-- skipped_existing_company_count + skipped_chain_count + qualified_count +
-- rejected_count now that a fourth real outcome exists, reintroducing the
-- exact "the numbers don't add up" confusion the skipped_existing_company_
-- count fix (migration 0033) already closed once.
alter table public.leads drop constraint leads_makeover_potential_check;
alter table public.leads add constraint leads_makeover_potential_check
  check (makeover_potential in (
    'very_high',
    'high',
    'medium',
    'low',
    'reject',
    'new_build'
  ));

alter table public.lead_scan_runs
  add column if not exists skipped_chain_count integer,
  add column if not exists new_build_count integer;
