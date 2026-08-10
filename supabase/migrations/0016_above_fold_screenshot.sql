-- Persists the above-fold screenshot the screenshot adapter already
-- captures (lib/adapters/screenshot-adapter.ts's `aboveFoldUrl`) but never
-- saved anywhere — only `fullPageUrl` was written to `screenshot_url`.
-- Found during the Design Generation Richness Pass: using the full-page
-- screenshot as the customer preview's hero background image caused a
-- real, measured Lighthouse performance regression (a real full-page
-- capture is ~5x the byte size of a single-viewport one, confirmed via a
-- real Design QA run). The above-fold capture is the correct, already-
-- existing asset for a hero-sized image; it was simply never persisted.
alter table public.website_analyses
  add column above_fold_screenshot_url text;
