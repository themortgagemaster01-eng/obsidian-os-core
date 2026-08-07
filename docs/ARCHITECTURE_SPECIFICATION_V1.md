# Obsidian OS — Architecture Specification v1.0 (Website Generation Pipeline)

**Provenance note, read this first.** This file was compiled from the founder's architecture-spec directive as relayed in a Claude Code session on 2026-08-07 — it is a faithful transcription and organization of exactly what was communicated in that message, not a copy of a separately-authored source document (none was attached or pasted into that session). If a longer or more detailed original document exists, **replace this file's content with it verbatim** — do not merge or reconcile by hand, since this transcription may be missing detail the original had (most likely in §5's deferred QA/Refinement breakdown and the exact `design_brief.json`/`design_memory.json` field shapes, which were summarized at the category level, not given as a full schema). Until that replacement happens, this document is treated as canonical per the founder's explicit instruction, superseding `docs/SPRINT_4_DESIGN_REVIEW.md`, `docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md`, and `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md` wherever this document's pipeline shape conflicts with theirs. Those three documents remain the historical record of how Sprint 4 Phases 1–2 were actually planned and reasoned about — read alongside this one for that context, not discarded.

---

## 1. The pipeline

```
Website Crawl → Analysis Engine → Design Intelligence (LLM) → Founder Approval → Generation Engine → QA Engine → Finished Website
```

This reframes the pipeline shape `docs/SPRINT_4_DESIGN_REVIEW.md`/`docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md` proposed. The load-bearing change: **Design Intelligence is repositioned as an LLM-powered creative-decision engine**, not the lightweight rules/schema knowledge layer Sprint 4 Phase 1 built (`lib/design-intelligence/`) — see §3 for how those two things relate going forward. **Founder Approval is a named, first-class pipeline stage** between the Design Brief and Generation, not an implicit review point.

## 2. Key principles

- **Strict separation of responsibilities.** Each engine does exactly one job. This is the same discipline `docs/CLAUDE.md`'s Architecture Principles and ADR-011 already established for the Analysis Engine's four-service split, restated as the organizing rule for the entire pipeline, not just one stage of it.
- **Analysis only gathers facts, never design decisions.** The Analysis Engine (crawl + normalization + Insights) produces structured, factual data about a business and its current site. It never reasons about typography, layout, color, or any other creative/design judgment — that reasoning belongs entirely to Design Intelligence.
- **Design Intelligence is the ONLY creative layer, and it should use an LLM.** No other engine in the pipeline makes a creative or design judgment call. This directly supersedes Sprint 4 Phase 1/2's deterministic, template-based approach to that judgment (see §3).
- **Generation stays fully deterministic — no LLM.** The Generation Engine assembles exactly what Design Intelligence specified. It does not make creative decisions, does not reinterpret the Design Brief/Design Memory, and does not call a model itself.
- **QA validates and reports differences but never redesigns.** The QA Engine's job is to check generated output against what was specified and report discrepancies — it does not have the authority to change a design decision itself. A QA finding is a report, not a redesign.

## 3. Design Intelligence (LLM-powered)

**Input boundary — strict.** The Design Intelligence LLM receives **only structured data from the Analysis Engine's output**. It never:
- crawls a website itself,
- generates React (or any other implementation code),
- performs QA.

**Output.** Two artifacts:
- `design_brief.json` — the mission-specific creative brief (positioning, direction, reasoning), the same conceptual artifact `lib/services/design-brief-service.ts` produces today, but LLM-authored rather than template-generated once this item is implemented.
- `design_memory.json` — the **persistent source of truth** that downstream engines (Generation, QA) read from. Named field categories: typography, color palette, spacing scale, grid, border radius, shadows, icons, photography/illustration style, motion level, CTA hierarchy, component variants, brand personality, accessibility targets, SEO priorities, content tone, preferred layouts.

**Relationship to `lib/design-intelligence/` (Sprint 4 Phase 1).** That module's rules/schema (typography scale shape, spacing scale shape, motion duration band, layout-family vocabulary, the Never Generate list) are the **constraints the LLM should be instructed to operate within**, not replaced by it — the LLM decides creative values; the rules module defines the space of valid values and the hard bans. Implemented in `lib/services/design-intelligence-service.ts`'s prompt construction, which embeds these rule constants directly rather than paraphrasing them — see `docs/SPRINT_STATUS.md`'s entry for this spec for what's built and what remains unverified (no real Anthropic API key has been used yet).

## 4. Founder Approval Gate

A manual checkpoint between the Design Brief and the Generation Engine:

```
Analysis → Design Brief → Founder reviews → Approve/Edit → Generation → QA
```

Explicitly called out as something the prior implementation got wrong: `researching -> designing` was auto-advancing with no human gate. This needed fixing, not just noting as a known gap.

## 5. Deferred to a future phase — not scoped by this document

Named explicitly so it isn't silently assumed in scope, but **not detailed further here** — this is exactly the content most likely to be incomplete in this transcription (see the provenance note above):

- Design Refinement
- Visual QA
- Accessibility QA
- Performance QA
- Brand QA
- Regression validation

## 6. Expanded crawler shape

The Analysis Engine's crawl step should extract, as structured facts (never design decisions, per §2): phones, emails, hours, address, socials, certifications, licenses, services, products, team, FAQ, testimonials, reviews, gallery, forms, maps.

Implemented in `lib/adapters/crawl-adapter.ts` — see `docs/SPRINT_STATUS.md` for what's built and what's still unwired downstream.
