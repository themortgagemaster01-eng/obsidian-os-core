-- Obsidian OS — Customer Website Design Intelligence enhancement (CTO
-- directive: Evidence -> Business Identity -> Design Direction -> Website).
-- design-intelligence-service.ts now runs a second, independent LLM pass
-- (Pass 2 Self-Critique) evaluating Pass 1's Design Direction against the
-- directive's ten self-critique questions before Generation ever reads the
-- brief. Persisted alongside design_memory/reasoning (0012_design_memory.sql)
-- so a founder reviewing the brief at the `reviewing` gate can see whether
-- the direction was flagged generic and revised, not just the final output.

alter table public.design_briefs
  add column if not exists self_critique jsonb;
