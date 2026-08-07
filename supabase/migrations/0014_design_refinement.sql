-- Obsidian OS — Sprint 4 Phase 3: persist deterministic Design Refinement
-- output alongside the existing wireframe and component assembly. This does
-- not introduce a QA service or a mission-state transition.

alter table public.website_designs
  add column if not exists refined_design jsonb;
