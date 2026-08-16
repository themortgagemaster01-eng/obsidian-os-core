-- Phase 2 (Lead Hunter -> Makeover Engine integration): adds the fourth
-- lead score, Makeover Potential — kept as its own column, never conflated
-- with website_score/opportunity_score/confidence_score (0018_lead_hunter.sql's
-- own "three distinct scores, never conflated" discipline extended to a
-- fourth). Derived from the other three scores plus real evidence richness
-- (lib/services/lead-scoring-service.ts::computeMakeoverPotential) — never
-- an arbitrary threshold alone, and the `_reasons` column carries the real,
-- evidence-cited explanation for WHY, not just the bare verdict.
--
-- recommended_conversion_goal is the same kind of deterministic,
-- evidence-derived recommendation 0018 already added
-- recommended_hero_pattern/recommended_design_strategy for — the primary
-- real conversion action this business's own captured contact evidence
-- supports (a phone-first CTA when a real phone was captured, a form/email
-- CTA otherwise), computed once at qualification time so the Lead Detail
-- screen and a launched makeover's Design Brief can both read the same
-- real recommendation instead of re-deriving it differently.
alter table public.leads
  add column if not exists makeover_potential text check (makeover_potential in (
    'very_high',
    'high',
    'medium',
    'low',
    'reject'
  )),
  add column if not exists makeover_potential_reasons jsonb not null default '[]'::jsonb,
  add column if not exists recommended_conversion_goal text;

create index if not exists leads_makeover_potential_idx on public.leads(makeover_potential);
