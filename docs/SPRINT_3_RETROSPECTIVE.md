# Sprint 3 Retrospective

**Status:** Written at Sprint 3's formal close, after founder approval. Companion to `docs/SPRINT_3_REVIEW.md` (the architecture/technical review) — this document is about process and judgment: what the way this sprint actually unfolded should change about how Sprint 4 and beyond get run, separate from what got built. Sprint 3 ran as three phases (Infrastructure → Business Logic → Presentation/Validation), each reviewed before the next began, closing with real end-to-end validation against two independent live websites.

---

## What worked well

**Per-phase review instead of one end-of-sprint review.** `CLAUDE.md`'s workflow rule — review Infrastructure, then Business Logic, then Presentation separately rather than saving everything for one large review — meant Phase 2 could disclose and get a decision on the equal-weighting scoring placeholder *before* Phase 3 built UI on top of it, and Phase 3's validation pass could be scoped to exactly two authorized defects rather than an open-ended "fix whatever's broken." Smaller review surfaces caught smaller, more specific problems earlier, which is the whole point of the rule.

**The evidence-first architecture wasn't just a design principle, it was a real safety net.** `docs/ARCHITECTURE_DECISIONS.md` ADR-013's mandatory per-category confidence rating meant that when Lighthouse and axe-core were both silently broken at runtime, the product's actual behavior was "show Unavailable confidence for Performance and Accessibility" — not a crash, not a fabricated score, not a customer-facing lie. That's the architecture doing exactly the job it was designed for, under real conditions nobody engineered on purpose. A design principle that only gets tested by design review, never by an actual failure, is a claim; Sprint 3 is the first sprint where it was also a demonstrated fact.

**Running the product for real, not just testing the code, is what actually found the bugs that mattered.** Every one of the sprint's five real production defects — the URL field, the login redirect, the missing DB grants, the Lighthouse failure, the axe-core failure — passed unit tests and code review and was invisible until someone actually pasted a real URL into the real form against a real database. `docs/CLAUDE.md`'s testing-expectations rule ("nothing is considered complete until it's been run against a real public website") was not a formality this sprint; it was the entire reason these bugs were found before a customer found them instead.

**Disclosure over silence, repeatedly, in both directions.** The Phase 2 report disclosed a fourth file beyond its three-file scope and explained exactly why. The Phase 3 validation report disclosed a `chrome-launcher` fix beyond its two-authorized-item scope, explained why it was necessary to validate the other two at all, and explicitly left the "was this in scope" judgment call to the founder rather than deciding it unilaterally. The founder, in turn, caught a real inconsistency (a "SHIP" recommendation sitting against an 8.5 score that the stated rubric places in "Needs another pass") and the correction was recorded in the document itself, not silently fixed — visible in both directions is the pattern, not just "the AI discloses to the human."

---

## What failed

**The scoring model shipped as a placeholder and nobody scheduled the decision that would un-placeholder it.** Equal 20% weighting across five categories was disclosed clearly, every time it came up — and then Phase 3 built a UI on top of it, two real websites were scored with it, and it is now live in every report a founder generates, with the actual founder decision about how these categories should be weighted still not made. Disclosure prevented anyone from being misled about what it is; it did not prevent it from quietly becoming the default anyway. Flagging something as a placeholder is not the same as scheduling the decision that resolves it.

**A named follow-up from the previous sprint's review got dropped without anyone noticing until this closure audit.** `docs/ARCHITECTURE_DECISIONS.md` ADR-010, written during the Sprint 2 review, explicitly named fixing the login page's retired tagline as "a concrete, named follow-up for the first code-touching sprint after this review." Sprint 3 was that sprint. It didn't happen — not because anyone decided to defer it again, but because none of the three phases' scopes happened to touch that file, and nothing was tracking the follow-up as its own item that a phase boundary could miss. A "named follow-up" that isn't a tracked item with an owner is functionally the same as an unwritten one.

**Sandbox environment friction cost real time and produced workarounds that needed their own disclosure.** Phase 2's report documents a real `npm install` failure requiring packages be installed to a scratch directory and copied in — a second workaround on top of a similar one from Phase 1. This is not a code-quality problem, but it's a real cost that recurred, and it's worth naming as friction rather than treating each occurrence as a one-off.

---

## Biggest production discoveries

**Two of five real bugs were completely invisible without a live, non-hosted Postgres instance.** The missing table grants (`0009_grant_table_privileges.sql`) were invisible against a hosted Supabase project because the platform bootstraps those grants by default — the schema had been "correct" by every check available until the moment it ran against a bare `supabase start`. This is the sharpest example in the sprint of a gap between "passes every test we have" and "actually works," because the missing piece was infrastructure the team hadn't been testing against, not application logic anyone had reviewed.

**Two adapters were non-functional in every prior run, and nothing had checked.** The axe-core failure ("Accessibility scoring has likely never worked in any local or hosted run to date," per `docs/TECH_DEBT.md` item 3) was not a regression — it was a previously-undiscovered gap that real validation surfaced for the first time, because prior testing evidently never checked `website_analyses.accessibility_result.fetchError` directly. A category can report "success" (no crash, no thrown error) while its actual measurement silently never ran, and the only way that gets caught is checking the content of the result, not just whether the code path completed.

**A one-line URL-parsing bug had been sitting in the product's own front door the entire sprint.** `isPlausibleUrl` rejected any URL typed with a protocol — exactly the format its own placeholder text showed the user to type — which means the New Mission dialog could not be submitted with a realistic input until this was caught during end-to-end validation. Nobody had tried submitting the form with a real `https://` URL before that point.

---

## Biggest architectural wins

**The four-service split made a policy ("no jargon in customer-facing text") into a testable property instead of a convention someone has to remember.** Because `insight-service.ts`, `opportunity-scoring-service.ts`, and `opportunity-report-service.ts` are separate services with a defined data contract between them, a single automated test can scan the final assembled report for banned terms and catch a violation regardless of which of the three services introduced it. A monolithic analysis function could not have been tested this cheaply or this completely.

**The async execution decision (ADR-012) was scoped honestly — a real workaround for one caller, not oversold as solving the job-runner gap.** Every place this appears in the docs is explicit that this is not the general-purpose worker `docs/MISSION_ENGINE.md` §6 describes as unbuilt. That honesty is itself an architectural win: it means Sprint 4+ won't accidentally build a second agent assuming infrastructure exists that only ever worked for exactly one caller.

**The Lighthouse/axe-core fix generalized into a rule, not just a patch.** `docs/ARCHITECTURE_DECISIONS.md` ADR-014 turns "we fixed this one bug" into "any future Node-native/CJS-incompatible adapter dependency should be marked external, and ESM-only ones additionally need dynamic `import()`" — a reusable pattern for every adapter Sprint 4+ adds, derived from root-causing two real failures in plain Node before touching any code rather than guessing from the stack trace.

---

## Biggest surprises

**The score/recommendation mismatch in the Phase 3 validation report** — an 8.5 CTO score sitting under a "SHIP" recommendation that the document's own stated rubric places in "Needs another pass" — was a surprise less for the error itself (narrative reasoning about "the fix works" answering a different question than "is this pass complete") than for what caught it: the founder reading the numbers against the rubric, not a process or a test. It's a concrete reminder that self-review, however honest, has a blind spot for exactly this kind of internal-consistency check, and that an external read still catches things self-review structurally can't.

**How much of this sprint's real defect count came from environment, not logic.** Three of the five production bugs (login grants, Lighthouse's ESM interop, the `chrome-launcher` Windows race) were fundamentally about *where* correct-looking code actually runs — a bare Postgres instance instead of hosted Supabase, Next's webpack bundler instead of plain Node, Windows instead of whatever the eventual hosting platform is — rather than wrong business logic. The adapters' scoring formulas, the insight-generation rules, the report assembly logic: none of that needed a bug fix this sprint. The environment did.

---

## Lessons learned

1. **A disclosed placeholder still needs a scheduled resolution, not just a flag.** Naming something a placeholder in three documents prevented anyone from being misled; it did not prevent it from shipping into production-shaped output anyway. The fix going forward: a placeholder that ships into a customer-facing artifact needs a named owner and an expected resolution point, not just an honest label.
2. **A "named follow-up for the next sprint" needs to be a tracked item, not a sentence in an ADR.** ADR-010's follow-up was clear and correctly written down — and still got missed, because nothing forced a phase-scoping conversation to check "does anything carried forward from the last review apply here." Carried-forward items belong in `docs/SPRINT_STATUS.md`'s "Known gaps" list where the next sprint's scoping will actually see them, not only in the ADR log.
3. **Real end-to-end validation earlier would have been cheaper than real end-to-end validation later.** Every defect Phase 3's validation pass found was discoverable the moment any adapter first ran against a real URL — which could have been Phase 1, not after Phase 2 and Phase 3's UI were already built on top of a pipeline nobody had confirmed actually worked end to end. This isn't a criticism of Phase 3's validation itself (it did exactly what it should have) — it's a scheduling lesson about *when* the first real run should happen.
4. **Environment-shaped bugs deserve their own checklist, not just "test with a real site."** Three of five bugs this sprint were about deployment/runtime environment specifically (hosted vs. bare Postgres, webpack bundling, OS-specific file locking) rather than application logic. "Run it for real" caught them, but a more targeted question — "does this depend on infrastructure this specific dev environment happens to provide for free?" — might catch the next one faster.

---

## What changes for Sprint 4

- **Category weighting gets a named decision point before Sprint 5 (proposal pricing) can depend on the Opportunity Score being meaningful.** This is now explicit in `docs/SPRINT_3_REVIEW.md`'s recommendation — not a Sprint 4 implementation task, a founder decision that should happen before scoring output gets treated as authoritative anywhere downstream.
- **Sprint 4 is scoped design-only, deliberately, before any implementation** — see `docs/SPRINT_4_DESIGN_REVIEW.md`. Given this sprint's own lesson about running things for real early, the design review explicitly considers when Sprint 4's first real end-to-end check against a live case should happen, rather than leaving it implicit until a late phase.
- **Every carried-forward item from this sprint's closure (the tagline, the `chrome-launcher` leak, the job-runner gap) is written into `docs/SPRINT_STATUS.md`'s Known Gaps list, not only into ADRs or TECH_DEBT**, specifically so a future sprint's scoping conversation sees them without needing to cross-reference every prior document.
- **The "run it for real" bar extends explicitly to infrastructure/environment, not just application behavior** — Sprint 4's design review should name, up front, which parts of its design have never been run against anything but the current dev machine, the same way this retrospective's "Biggest Surprises" section had to name it after the fact.

---

## Engineering process improvements

**Add a "does this depend on infrastructure the dev environment provides for free?" question to phase scoping, not just to post-hoc debugging.** Three of this sprint's five real bugs were environment-shaped (hosted vs. bare Postgres, webpack bundling, OS file-locking) and all three were only asked about *after* something broke. The question is cheap to ask up front — "will this behave the same on the platform we'll actually deploy to?" — for any new adapter, dependency, or execution model, and asking it during design review rather than during a validation pass would move the same discovery earlier at effectively zero cost.

**Give every disclosed placeholder a resolution owner and a trigger condition, not just a flag.** `EQUAL_CATEGORY_WEIGHT` was disclosed as a placeholder three separate times across three documents this sprint, and still shipped into every report with no scheduled decision point. The process gap isn't disclosure — disclosure worked exactly as intended — it's that "placeholder, needs a real decision" has no standard next step in this project's workflow the way "known gap" does in `docs/SPRINT_STATUS.md`. A placeholder that ships into customer-facing output should get the same tracked-item treatment a TECH_DEBT entry gets: a named condition under which it must be resolved (here: "before Sprint 5 depends on the score"), not just an honest label at the point it was introduced.

**Carry forward items as tracked line items, not only as prose inside an ADR or a report.** ADR-010's tagline follow-up was clearly written down and still missed for an entire sprint because nothing outside the ADR log itself was checking for it. `docs/SPRINT_STATUS.md`'s Known Gaps list is now the designated single place future phase-scoping should check — this sprint's closure pass moved every carried-forward item there specifically to test whether that fixes the pattern; whether it actually does is something Sprint 4 will demonstrate or fail to demonstrate, not something this document can claim in advance.

## GitHub workflow lessons

**The disposable-session premise was tested for real this sprint, not just stated as policy.** `CLAUDE.md`'s "any given Claude session is disposable, the repo should always be fully recoverable from GitHub alone" claim was actually exercised: the closure session that produced this retrospective started cold, pulled `origin/main`, and reconstructed the sprint's full history — what was built, what broke, what was fixed, why — entirely from commit messages and the docs already in the repo, without any session-to-session memory. That worked. It's worth naming as a positive result rather than assuming it would, because it's the kind of premise that looks fine on paper and only actually gets validated when a session really does start from zero.

**Commit messages carrying real technical detail (root cause, not just "fix bug") is what made that reconstruction possible.** Commits like `eba6aaa` and `42941ba` explain the actual mechanism of the bug in the message body, not just the symptom — that detail is what let a cold session understand *why* a fix existed without re-deriving it from the diff alone. This is worth continuing deliberately, not just as a style preference: terse commit messages would have made the disposable-session model markedly more expensive to actually use.

**One real gap in "fully recoverable from GitHub alone": local runtime state isn't code, and git can't carry it.** The login/grants bug this sprint was only discoverable by actually running a local Supabase instance — `supabase/.gitignore` correctly excludes that instance's local state, but that also means a fresh session cloning the repo cannot reproduce "a bare `supabase start` was already running" as a precondition without being told, or without running it again itself. The repo is fully recoverable; the *validated, running* state a prior session reached is not, and that's an inherent limit of the disposable-session model worth stating rather than assuming away.

## AI collaboration lessons

**Disclosing a scope overage and leaving the judgment call to the founder, rather than deciding it unilaterally either way, worked as intended.** Both Phase 2 (the extra `analysis-types.ts` file) and Phase 3 (the `chrome-launcher` guard) took the same shape: do the narrowly-necessary extra thing, explain exactly why it was necessary, and explicitly flag that the founder might disagree with the scoping judgment — rather than either quietly doing it without mention, or refusing to do necessary work because it technically exceeded a stated boundary. This is a repeatable pattern worth keeping, not a one-off.

**Self-critical review sections only work if they're actually graded against something, not just written in a self-critical tone.** The Phase 3 report's CTO Assessment held its own score to the stated rubric and still got the recommendation wrong on the first pass — self-critical *language* didn't catch it; a founder actually checking the number against the rubric did. The lesson isn't "be more self-critical," it's "state the check as an explicit, verifiable rule (like the rubric bands) so a mismatch is checkable by anyone reading the document, not just detectable by the same judgment that produced the error in the first place."

**"Confirm before fixing" held up as a real methodology, not just a stated value, when it mattered.** The Lighthouse/axe-core investigation's discipline — reproduce in plain Node before touching code, read the installed library's actual source before assuming its shape — is what separated "the fix that happened to work" from "the fix that would have looked complete after one bundler-config change and quietly left lighthouse still broken." Worth naming explicitly as validated, not just assumed correct going in, since it cost more upfront time than guessing would have.

**Founder corrections landing as visible, recorded edits rather than silent fixes is what makes Decision Memory's "founder edits become learning data" principle actually true in practice, not just in the schema.** The SHIP/score correction in `docs/SPRINT_3_PHASE_3_VALIDATION_REPORT.md` is a small but real proof point: the document still shows the wrong claim, the correction, and the reasoning for the correction, rather than reading as if "Needs another pass" had been the answer all along. A collaboration pattern that quietly cleaned that up in place would have been easier to read and would have destroyed exactly the information ADR-000's philosophy says a five-minute human review depends on being able to trust.

## Recommendations for Sprint 4

1. **Resolve category weighting before anything downstream (Sprint 5 pricing, in particular) treats the Opportunity Score as authoritative.** Concrete trigger, not an open-ended someday.
2. **Decide the `researching` state gap explicitly before Sprint 4 writes its first `transitionMissionState()` call** — either a minimal Research stage or a recorded, deliberate non-sequential override, not a default reached for silently during implementation. Detailed in `docs/SPRINT_4_DESIGN_REVIEW.md` §3.
3. **Decide the execution model for Sprint 4's (heavier, multi-pass) generation pipeline before building it**, rather than inheriting Sprint 3's fire-and-forget worker by default just because it's the only precedent available.
4. **Fix the retired tagline** (`docs/TECH_DEBT.md` item 5) — cheap, two-line, no design work needed, no reason it should wait for a dedicated sprint the way it already has once.
5. **Do Sprint 4's first real end-to-end check early** (its own Phase 1 equivalent), given this sprint's own lesson that every defect found in Phase 3 was discoverable the moment anything ran for real — don't repeat the pattern of validating late by default.
6. **Treat every Sprint 4 placeholder the way this recommendation list treats category weighting** — a named trigger condition for resolution at the moment it's disclosed, not just an honest label.
