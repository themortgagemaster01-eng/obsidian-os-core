-- Obsidian OS — Founder Architecture Spec v1.0, item 1: Design Intelligence
-- becomes LLM-powered. Its output is three artifacts per mission
-- (docs/ARCHITECTURE_SPECIFICATION_V1.md §3): the Design Brief (already
-- persisted in design_briefs.brief since 0010_design_engine.sql), Design
-- Memory (the persistent source of truth downstream engines read from —
-- new here), and the model's reasoning for its choices (new here, kept
-- alongside the brief so a founder reviewing it at the `reviewing` gate can
-- see why the model chose what it chose, not just what it chose).

alter table public.design_briefs
  add column if not exists design_memory jsonb,
  add column if not exists reasoning text;
