# Sprint 4 Architecture Recommendation

**Status: recommendation only. Not implementation, not a build authorization.** `docs/SPRINT_4_DESIGN_REVIEW.md` laid out the landscape and named open questions without resolving most of them, deliberately — that document's job was to react to a proposed pipeline and surface what needs deciding. This document's job is different: to actually answer the open questions with a recommendation, synthesizing the Design Review, `docs/SPRINT_4_RESEARCH_SUMMARY.md`, and `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md` into one coherent proposed architecture. Every recommendation below still requires founder sign-off before any of it gets built — this document proposes answers, it doesn't authorize acting on them.

---

## 1. Recommended architecture, synthesized

Four pieces, three of them services (mirroring ADR-011's proven pattern) and one a knowledge layer (not a service, per the Design Intelligence Recommendation §4):

- **`lib/design-intelligence/`** — the rules/schema knowledge layer. Owns the token *schema* (categories, not per-mission values), the Never Generate list, and the design-principles document. Read-only, no orchestration, no state mutation. Built now, lightweight (§2, Design Intelligence Recommendation).
- **`lib/services/design-brief-service.ts`** — reads Analysis Engine output (Insights and Normalized Analysis directly — see §3 on the Opportunity Score dependency question) plus `companies` data, selects reference direction (informed by, never structurally copied from, whatever reference source is in place — §4), and produces the Design Brief: a structured, citable, human-reviewable text artifact. **Recommended to run during the `researching` state** — see §3, this is the recommendation's resolution of the Design Review's Open Question 1.
- **`lib/services/design-generation-service.ts`** — takes an approved Design Brief and produces the actual site through internally-separated passes (wireframe/component assembly, typography, spacing, motion — per the Design Review §4's reaction to the founder's proposed pipeline). Runs during `designing`.
- **`lib/services/design-qa-service.ts`** — grades generated output against `lib/design-intelligence/`'s rules, capped-iteration refinement loop, blocks handoff to founder review on any CRITICAL grade. Runs at the `designing → qa` boundary, mirroring how `analysis-service.ts` owns the one state transition that matters for its stage.

---

## 2. Recommended answers to the Design Review's open questions

### The `researching` state gap (Design Review Open Question 1) — recommended resolution: use it for real, don't skip it

Rather than reaching for `transitionMissionState()`'s `{ allowNonSequential: true }` override to jump `analyzing → designing`, or building a full separate Research Engine (the larger, harder agent `docs/11-Product-Roadmap.md`'s original Sprint 3 prediction scoped, and which Sprint 3 correctly did not build), this recommendation proposes a narrower reading: **the Design Brief step genuinely is research** — synthesizing what Analysis already found, selecting a reference direction, and producing a reasoned brief is a real research/synthesis activity, not a placeholder. Recommend `design-brief-service.ts` runs during `researching`, transitions the mission to `designing` once the brief is complete (and, per ADR-000's approval-gate principle, likely once a human has reviewed the brief — the cheapest, highest-leverage review point in the whole pipeline per Design Review §4), and `design-generation-service.ts` owns the `designing` state itself. This resolves the sequencing gap without either silently skipping a real state or over-building a separate Research Engine sprint never scoped for Sprint 4. It also means Sprint 4 exercises a *third* real state transition in the Mission Engine (after Sprint 3's `analyzing`), continuing the trend `docs/MISSION_ENGINE.md` §10 already named — each sprint proving out one more real segment of a machine that was, as of Sprint 2's close, entirely theoretical.

### Execution model (Design Review Open Question 2) — recommended resolution: reuse the fire-and-forget pattern, but name its resolution trigger explicitly this time

Per ADR-012's precedent and the same "one caller doesn't justify real queue infrastructure" reasoning ADR-006 established, recommend Sprint 4 reuse the fire-and-forget background-promise pattern rather than building the general job runner now — building it for a single new caller would repeat the premature-infrastructure mistake this codebase has already twice consciously avoided (ADR-006, ADR-012). What should change from Sprint 3's version, per this sprint's own retrospective lesson ("give every placeholder a resolution trigger, not just a flag" — `docs/SPRINT_3_RETROSPECTIVE.md`, Engineering process improvements): **write down, now, the concrete condition under which the general job runner becomes mandatory** — e.g., "the moment a second concurrent agent needs scheduled execution, or the moment fire-and-forget demonstrably fails under real load" — rather than letting the gap persist indefinitely by default. Also recommend the design-generation pipeline's QA loop (§1) enforce a hard iteration cap and a hard timeout from the start, given it's a heavier, more expensive pipeline than Sprint 3's — this is cheap to build in from the beginning and expensive to retrofit once missions are already running through an uncapped loop.

### Mobile Optimization placement (Design Review Open Question 5) — recommended resolution: a threaded constraint, not a separate late pass

Recommend mobile-aware values be part of `lib/design-intelligence/`'s token schema from the start (a spacing/typography scale that's inherently responsive, not a fixed desktop scale with a mobile override bolted on after) rather than a distinct final pass in the pipeline. This is both the more defensible technical practice and the lower-risk choice given this sprint's own retrospective warning that a genuinely late pass is the one most likely to get compressed under time or cost pressure.

### Reference library sourcing (Design Review Open Question 4, Design Intelligence Recommendation §7) — recommended resolution: start in-house and small

Recommend Sprint 4 v1 use a small, manually curated, industry-tagged reference set (structured data checked into the repo or a simple table — tens of entries, not a licensed corpus) rather than committing to a third-party design-reference platform. Same reasoning as the execution-model recommendation: no evidence yet that a small curated set is insufficient, and a paid/licensed dependency is real recurring cost and a real new vendor-risk category for this codebase (`docs/SPRINT_4_DESIGN_REVIEW.md` §7 already names this as a risk this codebase hasn't had to reason about before). Revisit if and when real missions demonstrate the curated set doesn't cover enough industries or produces repetitive direction choices.

### Opportunity Score dependency (Design Review Open Question 7) — recommended resolution: don't depend on it yet

Recommend `design-brief-service.ts` reads Insights and Normalized Analysis directly, not the aggregate `opportunity_score`. `docs/SPRINT_3_REVIEW.md` already flagged category weighting as an unresolved founder decision that Sprint 5 (pricing) shouldn't depend on before it's resolved — the same reasoning extends cleanly to Sprint 4's Design stage. This avoids building a second consumer on top of a number this codebase has already, explicitly, said isn't trustworthy yet.

---

## 3. Recommended phasing, if implementation is approved

Not a timeline commitment — a proposed structure, mirroring Sprint 3's own phase structure, which this sprint's retrospective named as one of the things that worked well (`docs/SPRINT_3_RETROSPECTIVE.md`, "per-phase review instead of one end-of-sprint review"):

1. **Infrastructure phase:** `lib/design-intelligence/`'s lightweight rules/schema module, `design-brief-service.ts`, the new event type(s) and migration, wired into the `researching` state per §2. Reviewed before generation work begins — the Design Brief is the cheapest point to catch a wrong direction, and reviewing it as its own phase (the way Sprint 3's Phase 1 was reviewed before Phase 2 built on it) means a flawed brief-generation approach gets caught before any generation-pass code depends on its shape.
2. **Generation phase:** `design-generation-service.ts`'s internal passes.
3. **QA + presentation phase:** `design-qa-service.ts`, founder-review UI, and (per this sprint's own lesson about validating early) a real end-to-end run against at least one live mission's actual data before this phase is called complete — not deferred to a fourth "validation" phase the way Sprint 3 initially structured it, per the retrospective's explicit recommendation to validate earlier.

---

## 4. Does this change any existing, already-built architecture?

**No — and this section states that conclusion explicitly, per the founder's own condition that `docs/MASTER_BLUEPRINT.md` and the ADR log should only be touched if something architectural actually changes.** Everything in this document, the Design Review, and the Design Intelligence Recommendation describes proposed architecture for a stage that has not been implemented — no code has been written, no schema has been migrated, no service exists yet. `docs/MASTER_BLUEPRINT.md` describes the system as it's actually built today; nothing about today's built system changes as a result of this planning pass. The ADR log's own established pattern (checked directly: ADR-011 through ADR-014 were written during Sprint 3's *closure*, after Phase 1–3 were actually implemented, not during `docs/SPRINT_3_DESIGN_REVIEW.md`'s design-only phase) confirms ADRs in this codebase record decisions that were actually built, not decisions that were merely recommended or approved-in-principle. Filing ADRs now, for architecture that doesn't exist yet, would be premature by this codebase's own established convention — and would risk exactly the kind of "documentation describes future work as if already done" problem this sprint's closure pass spent real effort correcting elsewhere (`docs/ARCHITECTURE_DECISIONS.md` ADR-011 through ADR-014's own creation, `docs/MISSION_ENGINE.md`'s rewrite). Both `docs/MASTER_BLUEPRINT.md` and new ADR entries are correctly deferred until Sprint 4 is actually implemented, reviewed, and closed — the same point at which Sprint 3's equivalent updates happened.
