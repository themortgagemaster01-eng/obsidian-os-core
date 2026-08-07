# Sprint 4 Design Review — Website Generation (the Design Stage)

**Status: design only. Nothing in this document has been implemented, and this review does not authorize implementation to begin.** Per standing process (`CLAUDE.md`'s Workflow section, `docs/SPRINT_3_DESIGN_REVIEW.md`'s own precedent), this exists to be reviewed and explicitly approved by the founder before any Sprint 4 code is written. It follows Sprint 3's close (`docs/SPRINT_3_REVIEW.md`, CTO score 9.0/10, Ship, tagged `v0.4.0-alpha`) and covers exactly what the founder directed: philosophy, architecture, workflow, Mission Engine integration, the design pipeline, the Design Intelligence layer, reference selection, design constraints, AI responsibilities, quality assurance, human approval points, acceptance criteria, risks, and open questions for the next pipeline stage — website generation.

**This document is one of four companion deliverables from this planning pass**, deliberately kept separate so each stays legible on its own: `docs/SPRINT_4_RESEARCH_SUMMARY.md` (the underlying research, reported without judgment), this document (the design review — landscape, discussion, mostly-open questions), `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md` (a focused evaluation of one specific sub-question), and `docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md` (this review's open questions, actually answered with a recommendation). None of the four authorizes implementation.

**Scope, per `docs/ARCHITECTURE_DECISIONS.md` ADR-010's named pipeline** (Discovery → Qualification → Research → Design → Proposal → Email → CRM → Learning → Analytics): this is the **Design** stage. A redesigned website is one artifact the Design stage produces, not the stage's whole identity — `docs/VISION_GUARDRAILS.md` is explicit that Obsidian OS is not a website builder and not a template marketplace, and every design principle below is written to hold that line, not quietly cross it because a website generator is genuinely what gets built first.

---

## 0. What this document is answering, and what it deliberately isn't

The founder asked for research into modern premium AI-assisted design workflows, an evaluation of what aligns with this codebase's existing philosophy, and a design document reacting to (not committing to) a specific conceptual pipeline — later expanded to also cover the Design Intelligence layer, reference selection, design constraints, quality assurance, and human approval points explicitly, plus a standalone evaluation of whether Design Intelligence should be its own subsystem. This document does all of that. It does **not** decide the category-weighting question `docs/SPRINT_3_REVIEW.md` flagged as an open founder decision (Opportunity Score weighting) — that's Analysis Engine debt, unrelated to this stage, and is called out again in Open Questions below only because Sprint 4's Design stage will be one of the first real consumers of that score and should not silently start depending on a number nobody has actually decided is trustworthy yet.

---

## 1. Philosophy — the founder isn't buying HTML, they're buying confidence

Worth stating as a first-class principle, not an implicit assumption: nobody who uses this product is paying for a website. They're paying for the moment a prospect's owner looks at what Obsidian OS generated and thinks *this company deserves a better website* — before they've read a single word of the pitch. That reaction is the actual product of the Design stage. A technically correct, on-brief, accessible site that doesn't produce that reaction has failed at the thing this stage exists for, even if every acceptance criterion in §12 passes; a site that produces that reaction while cutting a corner somewhere is closer to succeeding than the reverse, though that's not license to cut corners deliberately.

This reframes several decisions elsewhere in this document rather than sitting apart from them. It's why §7's Quality Assurance section grades against "does this read as considered" dimensions, not just technical correctness. It's why §2 and §11 treat the founder's own review as a real gate, not a formality — a founder who has to talk themselves into being confident in a generated site has already lost the reaction the whole stage is built to produce, the same way a report section that reads "Unavailable confidence" (`docs/ARCHITECTURE_DECISIONS.md` ADR-013) is honest specifically so nothing ever needs a founder to talk themselves into trusting it. And it's the sharpest available test for §5 and §9's hardest risk — reference-library output masquerading as bespoke work: a template-derived site can look competent without ever producing genuine confidence, because competence and "built for exactly this business" are different reactions, and only the second is what this stage is actually selling.

---

## 2. Research: what "premium AI-assisted design" actually means right now, and what to take from it

**Full findings, sourced and unedited by this review's own judgment: `docs/SPRINT_4_RESEARCH_SUMMARY.md`.** Condensed here, with this review's judgment applied — what's adopted, adapted, or rejected for Obsidian OS specifically, which is this section's actual value-add over the research document itself:

- **Generic output is a workflow problem, not a model problem.** One prompt doing "taste, exploration, and code all at once" returns the statistical average. The fix is separating *what should this look like* from *build it* into distinct passes with distinct review points.
- **Plan the creative in text before generating anything visual.** An explicit design brief, reviewed as text, before any component or layout gets generated.
- **Multi-pass refinement, graded per dimension, not "generate once and ship."** Render, compare against explicit criteria across independent dimensions, grade each, fix what's graded poorly, re-render, capped iterations.
- **Structured design constraints (tokens, a written style system) make AI output better, not just more consistent** — including, per the research's deeper finding, a standard three-tier token architecture (primitive → semantic → component) directly relevant to generating for many different client brands rather than one.
- **Curated, industry-tagged reference libraries exist as a real category**, positioned as taste/direction inputs.
- **Separate exploration tools for unconventional layouts** exist as a technique for escaping "coding-agent-shaped" default layouts.

### Adopted (fits directly)

**Separating direction from execution into distinct, independently-gradable passes** is adopted as the core structural idea for §5's pipeline below — it's the same lesson Sprint 3 already learned and encoded as ADR-011 (four single-responsibility services beat one large function), applied to design instead of analysis. **Writing the creative direction as a text brief before generating anything** is adopted for the same reason `insight-service.ts` exists as a distinct layer from `opportunity-report-service.ts`: a text artifact is reviewable, an assembled page is not, until it's too late to cheaply redirect it. **Explicit, checkable per-dimension QA grading, capped and iterative** is adopted directly — it's evidence-first architecture (ADR-013) applied to visual output instead of textual claims.

### Adapted (right idea, needs a guardrail this codebase specifically requires)

**Curated, industry-tagged reference libraries** are adapted, not adopted outright: they inform *direction* and never supply content, copy, or structure that gets filled in with the client's name and shipped — see §8 for the full treatment. **Structured design tokens/constraints** are adapted with one clarification that matters enough to repeat: `docs/09-UI-Design-System.md`'s specific tokens govern Obsidian's *own* product surfaces and do not extend to what a generated client website looks like — see §9.

### Rejected, or held as an open question rather than a default

**A separate image-generation exploration step for unconventional (tilted/glass/3D) layouts** is not adopted as a default — Obsidian's own design language is explicit about restraint over cleverness, and there will be real businesses for which a bolder layout is correct, but that should be a deliberate per-mission direction decision, not a default generation mode. Flagged as Open Question 3. **Adopting a specific third-party paid design-reference platform as a hard dependency** is rejected for the same reason ADR-006 rejected adopting a real message queue before there was a consumer for it. Flagged as Open Question 4.

---

## 3. Architecture

**New subsystem: the Design Engine**, following Sprint 3's now-proven pattern (ADR-011) of one job per service rather than one large generation function:

- **`lib/services/design-brief-service.ts`** (proposed) — reads a mission's already-completed Analysis Engine output (`website_analyses`, the assembled `OpportunityReport`, its Insights) plus `companies` data, and produces a **Design Brief**: a structured, text-first artifact naming the target audience, the business's actual stated or inferred positioning, which specific Insights the new design must address, and a proposed direction (layout family, typographic mood, color direction) with its reasoning. This is the "plan the creative in text first" step from §2, and it is the layer where reference-library input (§8) enters — as citations informing the brief's reasoning, never as a structure the brief hands downstream.
- **`lib/services/design-generation-service.ts`** (proposed) — takes the Design Brief and produces the actual site: layout/wireframe, component assembly, typography application, spacing application, and (last, most restrained) motion. Whether this is one service with internal passes or several smaller services mirroring §5's stages exactly is an implementation decision for the next phase, not this review — but per ADR-011's lesson, each pass should be a distinct, independently-testable step, not one prompt doing everything at once.
- **`lib/services/design-qa-service.ts`** (proposed) — renders the generated output and grades it against explicit, named dimensions, per §7 below.
- **`lib/design-intelligence/`** (proposed, not a service — see §6) — the read-only rules/schema/constraints layer both `design-brief-service.ts` and `design-qa-service.ts` depend on.

Per Architecture Principle 1, none of these services mutates `missions.state` directly — the Design Engine calls `transitionMissionState()` at the points that matter (§4), the same pattern `analysis-service.ts` established in Sprint 3.

---

## 4. Mission Engine integration

**The state-machine gap this stage must resolve, or explicitly not resolve, before code is written.** `lib/workflow/mission-state.ts`'s primary sequence is `discovered → analyzing → researching → designing → qa → proposal → email → approval → sent → archived`. Sprint 3 built `analyzing`; nothing has ever built `researching` — no Research Agent exists (`docs/11-Product-Roadmap.md`'s Sprint 3 prediction named a Research Engine and it was never built; the Founder Directive redirected Sprint 3 to Analysis instead). `transitionMissionState()` only allows the state machine's own default "next state" or one of two named exceptions (the `qa → designing` revise loop, or rejection) by default — moving `analyzing → designing` directly would require the explicit `{ allowNonSequential: true }` opt-in the function reserves for deliberate overrides, not silent convenience. This is Open Question 1, and it is the single most consequential open question in this document: Sprint 4 cannot start moving missions into `designing` without either a real (even minimal) Research stage, or a founder-approved decision to intentionally use the non-sequential override and treat `researching` as legitimately skippable for now. Guessing at this rather than deciding it explicitly would be exactly the "redesign the platform mid-implementation" failure mode `CLAUDE.md` warns against. (`docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md` §2 proposes an actual answer to this question, for the founder's review — this document deliberately leaves it open rather than pre-deciding it.)

**Events.** Following Sprint 3's precedent (ADR-006, extended by Sprint 3's `AnalysisFailed` addition): the Design Engine needs at least one new event type recording that design generation completed (carrying, at minimum, which direction/brief was used and a reference to the generated output) and one for failure, both requiring a `lib/events/types.ts` catalog addition and a matching migration updating `mission_events.event_type`'s CHECK constraint — the same two-places-in-sync discipline every prior event addition has followed.

**Execution model.** Design generation is a multi-pass pipeline, plausibly slower and more resource-intensive than Sprint 3's seven-adapter analysis run (an LLM call per pass, potentially a render-and-screenshot step per QA iteration). ADR-012's fire-and-forget worker is the only precedent this codebase has for "don't block a request on slow multi-step work," but ADR-012 was explicit that it is a narrow workaround for one caller, not a general solution — and Sprint 4's pipeline is a heavier, more expensive version of exactly the load ADR-012 was never meant to generalize to. This document does not decide whether Sprint 4 reuses the same fire-and-forget pattern or is the sprint that finally requires the general-purpose job runner `docs/MISSION_ENGINE.md` §6 has flagged as unbuilt since Sprint 2 — that's Open Question 2.

**Approval gate.** Per ADR-000's non-negotiable commitment (the system prepares, it never unilaterally acts), generated design output is not customer-facing until a human reviews it — this stage produces something for the `qa`/founder-review gate already in the state sequence, not something that advances autonomously past it. See §11 for the full accounting of every human review point this stage introduces, not just the final one.

---

## 5. Design pipeline — discussion structure, not a commitment

The founder's directive offered this conceptual pipeline as a discussion point, explicitly not a commitment: **Business Analysis → Reference Selection → Design Direction → Wireframe → Component Assembly → Typography Pass → Spacing Pass → Motion Pass → Mobile Optimization → Quality Assurance → Founder Approval → Deployment.** Reacting to it stage by stage:

- **Business Analysis** — not a new step to build; this is Sprint 3's output, already real. The Design Brief service should read `website_analyses` and the assembled `OpportunityReport` directly rather than re-deriving business context from scratch — the strongest, most concrete argument for sequencing Design after Analysis, which Sprint 3 already did.
- **Reference Selection** — real, but scoped narrowly. Full treatment in §8, its own section per the founder's request.
- **Design Direction** — the text-first brief (§3's `design-brief-service.ts`). The highest-leverage review point in the whole pipeline — cheap to read, cheap to redirect, and the artifact a founder should plausibly approve or redirect before any generation cost is spent. See §11.
- **Wireframe → Component Assembly → Typography Pass → Spacing Pass → Motion Pass** — plausible as the internal structure of `design-generation-service.ts`'s multiple passes, each independently gradable rather than one generation call doing everything. Constrained throughout by §9's Design Constraints. Whether these five are separate service calls, separate LLM calls within one service, or some other decomposition is an implementation decision, correctly left for the next phase.
- **Mobile Optimization** — should not be a bolt-on last pass; if it's genuinely last in sequence, it risks being the pass most likely to get compressed under time pressure. Open Question 5.
- **Quality Assurance** — full treatment in §7, its own section per the founder's request.
- **Founder Approval** — maps directly onto the existing `qa`/approval states already in the mission sequence. Full treatment in §11.
- **Deployment** — explicitly out of scope for this review. `lib/workflow/mission-state.ts` deliberately does not carry Sprint 1's standalone `deployment` state forward — whatever "deployment" means for a generated client website is a genuinely new problem this codebase hasn't touched. Open Question 6.

**This review's judgment on the pipeline as a whole:** the stage-by-stage structure is sound and consistent with how Sprint 3 was actually built — adapted, not adopted verbatim, per the changes named above and detailed in the sections below.

---

## 6. The Design Intelligence layer

The founder separately asked for an evaluation of whether Sprint 4 should introduce a dedicated **Design Intelligence** subsystem — owning the industry reference library, typography/layout/component/motion standards, color systems, general design rules, and "Never Generate" rules — as its own subsystem. **Full evaluation and recommendation: `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md`.** Summarized here, as this section's evaluation, not a build decision:

**The founder's list decomposes into four different kinds of asset**, not one thing: (1) a token *schema* — which categories of design decision always get made, stable across every mission; (2) a rules/principles document — the qualitative standard plus the Never Generate list, text, not data; (3) per-mission token *values* and a chosen direction — inherently per-mission, not a shared subsystem asset, and really just the Design Brief's own output; (4) the industry reference library itself — the one item that's genuinely infrastructure-shaped.

**Recommendation, in brief (full reasoning in the standalone doc): define the rules/schema layer now, as a lightweight code-adjacent module — not a heavyweight standalone platform.** A canonical rules document (proposed `docs/DESIGN_INTELLIGENCE.md`, playing the role for generated output that `docs/09-UI-Design-System.md` plays for Obsidian's own UI) plus a small typed module (`lib/design-intelligence/`) that `design-brief-service.ts` and `design-qa-service.ts` depend on. Deferred, explicitly rather than silently dropped: a queryable/indexed reference-library integration, a real multi-component library, a versioned rules engine — each built once there's evidence the lightweight version is insufficient, the same trigger-condition discipline ADR-006 used for the event bus. This mirrors the same "build the seam, not the heavy infrastructure behind it" judgment this codebase has already made once and is proposing to make again, deliberately, rather than either over-building prematurely or leaving generation entirely unconstrained until problems show up in shipped output.

**Ownership boundary, kept clean against ADR-011's precedent:** Design Intelligence is read-only knowledge, never orchestration — it never calls `transitionMissionState()`, never talks to adapters, never generates anything itself. Blurring this would repeat the "one function doing too many jobs" mistake ADR-011 exists to prevent.

---

## 7. Quality Assurance

The visual-domain equivalent of Sprint 3's evidence-first standard (ADR-013): a design doesn't get called premium because it looks confident, it gets called premium because it passed named, checkable criteria against `lib/design-intelligence/`'s rules (§6).

**Grading structure**, per the research's recurring pattern (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §2): render the generated output, grade it across named independent dimensions — proposed: layout, typography, spacing, motion, mobile rendering, and evidence-grounding of copy (does the generated text trace to real company/analysis data, per §10) — on a discrete scale (PASS/MINOR/MODERATE/CRITICAL, matching the shape the research surfaced), fix what's graded poorly, re-render, repeat up to a small, fixed, documented cap rather than looping until subjectively "good enough." `docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md` §2 recommends this cap be decided and enforced from the start, not retrofitted, given this pipeline is more expensive per-iteration than Sprint 3's.

**What QA blocks on.** A CRITICAL grade on any dimension blocks handoff to founder review — the design-domain equivalent of an Opportunity Report category reading "Unavailable confidence" rather than shipping a plausible-looking but unearned result. This is not optional polish; per §1's philosophy, a design that hasn't passed its own graded criteria is a design that hasn't earned the confidence reaction this whole stage exists to produce, and presenting it to a founder anyway would be asking the founder to do the QA pass's job manually.

**The one dimension this codebase cannot yet check as cleanly as the others.** §9's Never Generate rules and §8's "reference informs, never structures" line are both, honestly, harder to grade mechanically than "does this string contain the word Lighthouse" (Sprint 3's banned-terms test). §12's acceptance criteria propose a partial mechanical proxy (structural diversity across a review batch); §14 names this gap as a real, unresolved risk rather than implying QA can fully automate judgment of "does this look bespoke."

---

## 8. Reference selection

**What it is:** the step where `design-brief-service.ts` (§3) selects industry-appropriate direction input — mood, layout family, typographic pairing, color direction — informed by real examples of premium work in the target business's industry, before generation begins.

**The hard line, restated because it's the single highest-priority risk in this whole document (§14):** a reference informs the Design Brief's *reasoning*, and is cited as such — "informed by [industry] sites emphasizing X" — and must never be the source of the actual section order, copy structure, or component tree that ships. `docs/VISION_GUARDRAILS.md` is unambiguous that Obsidian OS is not a template marketplace and that every design a mission produces is bespoke work product for one specific business — a reference library used carelessly, where a generation pass leans on a cited reference's actual structure because it's the easiest path to a plausible result, is exactly the mechanism that guardrail exists to prevent. This isn't a style preference; it's the boundary between what this product is and a different, explicitly-rejected product.

**Selection mechanism, proposed at a conceptual level (implementation detail for the next phase):** references are tagged by industry/category and, per the token-architecture research, ideally by the same semantic categories `lib/design-intelligence/`'s schema uses (typographic mood, color direction, layout family) rather than free-text description — so selection can be a structured match against the Design Brief's inputs, not a fuzzy retrieval step whose reasoning is opaque even to itself.

**Sourcing — third-party vs. in-house, Open Question 4.** Whether the reference set is a licensed third-party design-reference service or a small, in-house-curated set is unresolved by this review. `docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md` §2 recommends starting in-house and small, for the same reason ADR-006 avoided premature infrastructure — but that recommendation still requires founder sign-off, and this section deliberately doesn't pre-decide it.

---

## 9. Design constraints

The positive counterpart to §6's Never Generate rules — what the Design Engine is told to *do*, not just what it's told to avoid, per the research finding that negative constraints work best paired with positive ones (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §3).

**The schema is Obsidian's; the values are the mission's.** `docs/09-UI-Design-System.md`'s specific tokens (the navy/near-black palette, Inter, dark-mode-only) govern Obsidian's *own* product surfaces — Mission Control, login, the Opportunity Report — and do not extend to what a generated client website looks like. A bakery's site and a law firm's site should not both come out looking like Obsidian's own dashboard. What transfers universally, per the token-architecture research's primitive/semantic split, is the *schema and the discipline*: a typographic scale with named slots, a deliberate spacing scale, color *roles* (not fixed hex values), a restrained motion-duration band — the categories of decision, always made, with mission-specific values inside them.

**Concretely, per mission, `design-brief-service.ts` should produce (not `lib/design-intelligence/` itself, which owns only the schema):** a chosen typographic pairing appropriate to the business's industry and positioning; a color palette expressed as semantic roles (primary action, surface, emphasis) with actual values chosen per mission; a spacing scale (can reuse Obsidian's own numeric scale as a starting default — the *proportions* are closer to universal than colors are — but this is a default, not a constraint); a motion-duration band matching Obsidian's own restraint discipline (200–300ms-class, `ease`/`ease-in-out`, no bounce/spring) unless the Design Brief explicitly justifies a deviation.

**Mobile as a constraint, not an afterthought.** Per §5 and Open Question 5, this review's judgment is that mobile-aware values belong in the constraint schema from the start (a spacing/typography scale that's inherently responsive) rather than a separate late pass — cheaper to build in from the beginning than to retrofit after a desktop-first scale is already load-bearing elsewhere in the pipeline.

---

## 10. AI responsibilities — and the hard line on bespoke output

What the Design Engine's AI components should and should not do, stated as plainly as `docs/CLAUDE.md`'s existing rules do for the report:

- **Ground every design decision in the mission's actual analysis data.** The Design Brief must cite specific Insights or Normalized Analysis findings it's responding to — the visual-domain equivalent of ADR-013's "every report claim traces to a specific measurement." A brief that can't point to what it's addressing shouldn't generate anything.
- **Reference libraries inform taste, never supply structure.** Restated from §8 because it's this document's most important single rule, not because it needs new content here.
- **Never fabricate business content.** Generated copy, claims, and positioning must be grounded in real company/mission data — never invented biographical or business detail presented as fact. This extends ADR-013's "no unsupported claims" standard from report language into generated site copy, where the stakes of a fabricated claim are arguably higher (it would appear on a live, published site, not an internal report).
- **Self-QA before presenting to a founder.** Per §7 — a design that hasn't passed its own graded criteria shouldn't reach founder review.
- **Motion and visual restraint follow the discipline `docs/09-UI-Design-System.md` established, adapted per business, not copied verbatim.** Per §9.

---

## 11. Human approval points

Per ADR-000's non-negotiable commitment — the system prepares, it never unilaterally acts — this stage introduces more than one review point, not only the final founder handoff, and naming them all explicitly matters more here than in Sprint 3, given §1's framing that a founder talking themselves into confidence has already lost the point of the stage:

1. **This document itself**, and its three companions, before any implementation begins — the same gate `docs/SPRINT_3_DESIGN_REVIEW.md` went through before Sprint 3's code was written.
2. **The Design Brief**, before generation cost is spent — the cheapest, highest-leverage review point in the whole pipeline (§5, §8). A founder redirecting a wrong direction here costs nothing but re-reading text; redirecting it after generation costs a full regeneration pass.
3. **The `lib/design-intelligence/` rules document itself** (§6, §9), particularly the Never Generate list (§9) and the reference-sourcing decision (§8, Open Question 4) — these are standing policy, not a per-mission review, but they're still a human decision this document doesn't have standing to make unilaterally.
4. **Post-QA, pre-founder-handoff** — the existing `qa` state gate, where a design that has already passed its own graded criteria (§7) still requires a human before anything is customer-facing. This is the gate `docs/MASTER_BLUEPRINT.md`'s pipeline already names and this stage doesn't get to skip.

None of these four is optional or a formality per ADR-000 — but #2 deserves particular emphasis given how directly it maps onto this document's own philosophy (§1): it's the point where the founder can catch a wrong direction before any of the "does this produce confidence" work has actually been attempted, rather than discovering the direction was wrong only after seeing a finished, expensively-generated site.

---

## 12. Acceptance criteria (proposed, for the review's discussion — not yet approved as final)

Engineering acceptance, mirroring the concrete, checkable standard Sprint 3 set for itself:

1. A generated site's Design Brief cites at least one specific Insight or Normalized Analysis finding it addresses — mechanically checkable (the brief has a non-empty, structured citation field), not just narratively true.
2. The QA pass (§7) grades every one of its named dimensions and blocks founder-review handoff on any CRITICAL grade, capped at a fixed, documented number of refinement iterations.
3. No two generated sites for different industries in the same review batch share identical section structure/copy skeleton — the most direct mechanical proxy available for "not a template," acknowledging (§7, §14) that this is a proxy, not a complete guarantee.
4. Mobile rendering is verified, not assumed — a mobile-viewport render must be part of the QA pass's actual evidence, the same way Sprint 3 required real end-to-end validation against a live site rather than trusting the code.
5. Generated copy passes the same category of banned/unsupported-claims check `opportunity-report-service.test.ts` already established for report text — extended to cover generated site copy.

**Qualitative bar**, stated the way `docs/SPRINT_3_DESIGN_REVIEW.md`'s own Success Criteria section separated qualitative from engineering acceptance, and directly downstream of §1's philosophy: a founder looking at a generated site's output should be able to tell, without being told, which real weakness in the business's current site it's addressing — and should not be able to guess, from the output alone, that it came from a shared underlying system rather than being designed for that specific business. If the founder has to talk themselves into confidence rather than immediately feeling it, this bar has not been met, regardless of how many mechanical criteria above passed.

---

## 13. Risks

**Reference-library-as-template-in-disguise is the highest-priority risk in this document.** It's the one place this pipeline could quietly violate `docs/VISION_GUARDRAILS.md`'s explicit "not a template marketplace" guardrail without anyone deciding to — not through a deliberate choice, but through the ordinary drift of an AI generation pass leaning on cited references more heavily than intended because it's the easiest path to a plausible-looking result. §8 and §10's citation requirement is a mitigation, not a guarantee — this needs active review during implementation, not a one-time design-doc mention.

**Cost and latency compound Sprint 3's known, unresolved fire-and-forget-worker gap.** A multi-pass generation-plus-QA pipeline is meaningfully more expensive and slower than Sprint 3's seven-adapter analysis run, and Sprint 3's execution model was already flagged (ADR-012) as unverified against real serverless function-freezing behavior. This risk compounds rather than introduces a new one, but it compounds enough that Open Question 2 should be resolved deliberately, not by default inheritance of Sprint 3's pattern.

**The `researching` state gap is a real sequencing risk, not just a documentation nuance.** If Sprint 4 ships a Design Engine that calls `transitionMissionState()` with `allowNonSequential: true` to skip `researching` without an explicit founder decision recorded, that's exactly the kind of "redesign mid-implementation without flagging it" `CLAUDE.md` warns against, even though the mechanism already exists and would technically work.

**Mechanically checking "not generic" is harder than mechanically checking "no adapter names in this string."** §7 and §12 already name this honestly — the proposed structural-diversity proxy is real but partial, and this gap should be named as such rather than implied to be as solved as Sprint 3's jargon check was.

**Third-party design-reference dependency risk** — cost, licensing, and availability of any external reference-library service, if Open Question 4 resolves toward using one, is an ordinary vendor-dependency risk this codebase hasn't had to reason about yet (Sprint 1–3's external dependencies are all developer tooling, not a paid content/data service).

**A founder who has to justify their own confidence in a generated site is itself a QA failure, per §1** — worth naming as its own risk category, distinct from a mechanical criterion failing: it's possible for every criterion in §12 to pass while the qualitative bar still isn't met, and no amount of additional mechanical checking fully closes that gap, which is exactly why §11's human review points exist as real gates rather than a formality layered on top of automated QA.

---

## 14. Open questions

1. **Does Sprint 4 need a minimal Research stage, or does it deliberately skip `researching` via the non-sequential override?** The single most consequential open question in this document (§4). `docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md` §2 proposes an answer.
2. **Where does the multi-pass generation pipeline actually run?** Reuse Sprint 3's fire-and-forget pattern (ADR-012) as-is, extend it, or is this the sprint that finally builds the general-purpose job runner? (§4) Recommendation proposed in the Architecture Recommendation doc.
3. **Should any generation mode intentionally produce bolder, less restrained layouts for businesses whose industry/positioning calls for it**, and if so, is that a per-mission direction decision made in the Design Brief, or a distinct, explicitly-scoped Phase 2 capability? (§2)
4. **Third-party design-reference platform vs. in-house-curated reference set** — cost, licensing, and whether a smaller owned set is sufficient before committing to an external dependency. (§8, §13) Recommendation proposed in the Architecture Recommendation doc.
5. **Is Mobile Optimization a distinct late pass, or a constraint threaded through every earlier pass?** (§5, §9)
6. **What does "Deployment" mean for a generated client website** — a shareable preview link, an actual hosting target, something else? Explicitly out of scope for this review, named so it isn't silently assumed away. (§5)
7. **Should the Design stage read the Opportunity Score at all, given `docs/SPRINT_3_REVIEW.md` flagged its category weighting as an unresolved founder decision?** Reading Insights and Normalized Analysis directly (not the aggregate score) may be sufficient and would sidestep depending on a number nobody has signed off on yet.
8. **Should Design Intelligence be built as a standalone subsystem now, deferred, or built lightweight?** (§6) Full evaluation and recommendation: `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md`.

---

## 15. What this review is asking the founder to decide before implementation starts

Everything in §14, but concretely: this document is not requesting sign-off to begin building. It's requesting a decision on Open Questions 1, 2, and 8 in particular (the state-machine sequencing gap, the execution-model question, and how much of Design Intelligence to build now), since all three would materially change the shape of the first code written, and getting any of them wrong would mean redesigning mid-implementation — exactly the failure mode `CLAUDE.md` asks to be avoided by deciding up front instead. `docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md` proposes an answer to each of the eight open questions above, for the founder's review alongside this document — proposed, not decided.
