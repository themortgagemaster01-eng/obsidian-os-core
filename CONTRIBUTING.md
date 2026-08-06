# Contributing to Obsidian OS Core

This document describes how work actually gets done on this project. It isn't a wishlist —
every rule below is already in force and has been followed (or, where noted, enforced only by
review discipline rather than tooling) since Sprint 1. If you're picking this project up cold,
read `docs/MASTER_BLUEPRINT.md` first; this file is the day-to-day operating manual that follows
from it.

## The Mission Engine owns workflow

A mission's state only ever changes in one place: `lib/workflow/mission-workflow.ts` and its
named wrappers (`rejectMission()`, `archiveMission()`). No component, route handler, or service
outside the workflow engine is allowed to `.update()` a mission's state directly, no matter how
small or "obviously safe" the change looks. If code needs a mission to move forward, it calls the
workflow engine — it doesn't reach around it. This isn't a style preference; it's what keeps the
11-state pipeline (and its non-sequential exceptions, like the QA revise loop) trustworthy as a
single source of truth instead of something that can drift out of sync with itself the way the
old two-field `status`/`stage` model did.

## Services do one thing

`lib/services` is where business logic and orchestration live, and each service should have a
narrow, nameable job — not a junk drawer. Sprint 3's Opportunity Intelligence work is the clearest
example in the codebase: rather than one large "analyze a website" service, the work is split into
four services that each own a single stage of the pipeline and hand a clean, typed object to the
next one:

```
analysis-service        → runs the adapters, normalizes raw results into scores + findings
insight-service          → turns normalized data into plain-language business observations
opportunity-scoring-service → turns insights + normalized data into a deterministic score
opportunity-report-service  → assembles the final, presentation-ready report object
```

Each of these can be tested and reasoned about on its own, without needing to understand the
other three. If you find yourself adding a fifth responsibility to one of these files, that's a
sign it should be a fifth service, not a bigger one.

## Adapters are I/O only

Every adapter in `lib/adapters` (crawl, mobile analysis, SEO, accessibility, Lighthouse, tech
detection, screenshot, and any future one) does exactly one thing: call an external tool or API
and return its raw, vendor-shaped result. An adapter never scores anything, never decides what a
result "means," never translates a result into user-facing language, and never throws — a failure
comes back as data (a `fetchError` field on the result), not an exception the caller has to catch.
All of the judgment — what a raw result implies, how good or bad it is, what to tell a business
owner about it — belongs one layer up, in a service. This mirrors the same port/adapter shape the
event bus already uses, and it's what makes it possible to swap or fix one adapter without
touching anything downstream of it.

## Every claim in a report traces to a measurement

The Opportunity Report is the product — it's what a human actually reads — so nothing in it is
allowed to be a vague or invented-sounding claim. Every insight and every recommendation carries a
`source` back to the specific check that produced it, and every score comes with confidence
metadata (`High` / `Medium` / `Low` / `Unavailable`) computed from whether the underlying
measurement actually completed, not from the score value itself. A category whose adapter failed
reads as `Unavailable`, not as a confident-sounding score of zero — collapsing "we measured this
and it's bad" and "we couldn't measure this at all" into the same signal is exactly the kind of
quiet, misleading gap this project treats as a bug worth fixing on sight (see the Sprint 3 Phase 2
report for a real instance of this being caught and corrected).

## Documentation changes land with the change it describes

Per Architecture Principle 7 in `docs/MASTER_BLUEPRINT.md`: when a change alters the architecture,
`docs/MASTER_BLUEPRINT.md` and `docs/ARCHITECTURE_DECISIONS.md` get updated in the same commit,
not in a follow-up pass "later." A pull request or sprint that changes how the system is built
without a corresponding doc update is incomplete work, full stop — the same way a change without
tests would be treated as incomplete anywhere else. The reasoning is practical, not bureaucratic:
this project is meant to be picked up by someone (or some agent) with zero memory of how it got
here, and a doc that's stale by even one sprint stops being trustworthy enough to build on.

## Commits are small, reviewable, and phase-gated

Sprint 3 was built in explicit phases (adapters + infrastructure, then the four services, then —
not yet authorized — presentation), each with its own commit and its own review before the next
phase started. That pattern is the standard going forward, not a one-off: one phase, one commit,
a report of what was actually built and verified, and a stop for review before moving on. Don't
bundle unrelated work into a phase's commit, and don't start the next phase on the assumption that
approval is a formality — it isn't.

## No scope expansion without explicit approval

If a phase is scoped to three files, it stays three files unless a deviation is disclosed and
approved before or as part of the report-back — not discovered later by whoever reviews the diff.
This project has had, and will keep having, moments where a small justified exception makes sense
(Sprint 3 Phase 2 exported a handful of previously-private helper functions instead of duplicating
logic, and disclosed it explicitly rather than quietly going out of scope). The rule isn't "never
deviate" — it's "never deviate silently." The same applies to architecture: a decision that
conflicts with an existing Architecture Principle or ADR gets resolved explicitly, in the ADR log,
not worked around in code.

## Report honestly — what was built, and what wasn't verified

Every phase report distinguishes, in plain terms, between what was actually built and verified and
what wasn't — and it says so even when the honest answer is inconvenient. The `package-lock.json`
situation is a live, current example of the standard to follow: this sandbox's `npm install` has
never been able to complete cleanly, so rather than fake a lockfile or quietly skip mentioning it,
that gap was reported as exactly what it is — a real limitation of the environment, not a passed
check — and handed off to be resolved on a machine that can actually run `npm install` properly.
The same standard applies to test coverage, to demo runs (a real business URL was required before
Phase 2 could be signed off precisely because a synthetic one like `example.com` doesn't prove
anything about the real pipeline), and to any claim about what a piece of code does. If something
doesn't work, or can't be verified, say so — don't let a confident-sounding report paper over a
gap that someone downstream will eventually trip over.
