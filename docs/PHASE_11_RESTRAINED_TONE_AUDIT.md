# Phase 11 — Restrained-Tone Keyword Rule Audit

Audit/scoping only. No implementation code written, no test changed, no commit made. Follows
directly from the Dante's Trattoria diagnostic, which proved by direct re-execution (not
inference) that removing the single word "unpretentious" from that business's real design-memory
flips the outcome from motion `"none"` + both capabilities denied to `"subtle"` +
`basic-motion` granted, with every other input held identical.

---

## 1. The complete keyword list and the exact penalty logic

`lib/design-intelligence/composition-variants.ts:142-143`:

```ts
const RESTRAINED_TONE_KEYWORDS = ["restrained", "quiet", "understate", "minimal", "refined", "subtle", "calm", "unpretentious"];
const BOLD_TONE_KEYWORDS = ["bold", "energetic", "vibrant", "loud", "punchy", "urgent", "playful", "high-energy"];
```

`personalityPaddingBias(brandPersonality, contentTone)`: joins both inputs into one lowercased
string, checks `.includes(keyword)` (**substring match, not word-boundary** — see §3) against
both lists, returns `+1` if a restrained keyword matched and no bold one did, `-1` for the
reverse, `0` otherwise.

**This one function is reused in three structurally different places, at three different
severities, and this is the actual core of the problem — not just the word list:**

| Consumer | What the ±1 controls | Stakes |
|---|---|---|
| `composition-variants.ts:219` (original, first use) | `paddingBiasSteps` — a small spacing/whitespace nudge, clamped into the existing spacing scale | Low — cosmetic density, never gates content or capability |
| `experience-planner.ts:310-311` (`resolveMotionBudget`) | A full **motion-tier rank subtraction**: `if (restrainedTone) rank = Math.max(0, rank - 1)`, applied *after* `ceilingRank = min(modeCeiling, evidenceCeiling, intensityCeiling)` | High — one keyword match removes an entire tier, unbounded by how much headroom the ceiling had |
| `capability-selector.ts:236-238` (`isShaderHeroGranted`) | A **hard, independent veto**: `if (restrainedTone) return false;` — evaluated a second time, separately from whatever the motion-budget rank already did | Highest — total denial of a capability, regardless of motion budget |

**Exact stacking for Dante's Trattoria, traced by direct re-execution:**
`modeCeiling("cinematic-storytelling") = cinematic` (rank 3), `evidenceCeiling = subtle` (rank 1
— only 1 of 5 real-evidence signals present: photography), `intensityCeiling("restrained") =
subtle` (rank 1). `min(3,1,1) = 1` ("subtle") — this is the real, evidence-and-category-derived
answer. Then the tone check fires because `brandPersonality` contained `"unpretentious"`, pulling
rank 1 → 0 ("none"). The penalty is **freely additive on top of the already-computed ceiling,
with no floor tied to the evidence ceiling specifically** — it can and did push the result below
what evidence alone had already concluded.

For shader-enhanced-hero specifically, the same tone check runs **again**, independently, as a
hard veto — in Dante's case redundant (motion budget was already below the "enhanced" floor by
the time it ran), but in a different business's case (rich evidence, an energetic mode, a
motion budget that legitimately reached "enhanced"/"cinematic") this second, separate veto is the
one and only thing standing between that business and shader-enhanced-hero — worth knowing
precisely because a fix to the motion-budget nudge alone would not automatically fix this second,
independent check.

---

## 2. What the rule was originally trying to prevent

Traced via `git log` — `composition-variants.ts` (and `personalityPaddingBias`, in its original
padding-only form) predates this engagement's numbered phases (created in a prior "Phase 4.6"
commit). `experience-planner.ts` — where the *motion-budget* use of this same function was
introduced — landed in commit `f608556`, "Phase 6.1: Experience Intelligence." The commit message
itself doesn't discuss the tone-reuse decision explicitly; the reasoning lives in the code's own
doc comments, read directly rather than assumed:

- `MOTION_BUDGET_CEILING_BY_MODE`'s own comment states the real, structural intent: *"the founder's
  'no mode should require animation simply for decoration' instruction, made structural rather
  than aspirational... trust-authority and premium-minimal cap at 'subtle'... never unlocked into
  a busier experience just because evidence happens to be rich."*
- Critically: **this structural protection already exists independently of the keyword check.**
  A genuinely formal/somber business (Robert's own funeral-home/formal-law-firm example) resolves
  to `trust-authority` or `premium-minimal` mode via `resolveExperienceMode`'s own
  evidence-and-industry-gated logic — and *that mode's own ceiling* already caps motion at
  "subtle" **regardless of evidence richness and regardless of any keyword match at all.** The
  keyword-based tone check is not what protects a funeral home from bouncy motion — the mode
  ceiling already does that, structurally, with no string-matching involved.
- So what is the keyword check actually *for*? The legitimate case it protects that mode-ceiling
  alone does not: **two businesses that land on the *same*, non-restrained mode** (e.g., two
  different `warm-local-business` restaurants, or two `cinematic-storytelling` businesses) **can
  still have genuinely different personal registers** — one bubbly and playful, one hushed and
  understated — and the tone check exists to let a business's own real, disclosed voice narrow the
  experience *within* an otherwise-eligible mode, not just at the mode-selection level. This is a
  real, legitimate design goal, confirmed by its own test coverage
  (`experience-planner.test.ts:109-121` explicitly fixtures this with `["restrained", "quiet"]`
  pulling a `warm-local-business` mission from "enhanced" down to "subtle").

**The legitimate case is real. It is not the thing that broke.** Every existing test that
exercises this mechanism as a *deliberate, correct* restraint signal uses unambiguous words:
`"restrained"`, `"quiet"`, `"understated"` (`experience-planner.test.ts`, `capability-selector.test.ts`,
`capability-hero-execution.test.ts`). Not one existing test relies on `"unpretentious"` to prove
the *motion* effect — the two tests that do use `"unpretentious"` (`composition-variants.test.ts:87`,
`design-qa-service.test.ts:218`) both exclusively exercise the **spacing** effect, never motion or
capability grants (confirmed by reading both tests directly — see §4/§6).

---

## 3. Is the flaw the keyword list, the stacking logic, or both?

**Both, but not equally, and not for the same reason.**

**The keyword list is the confirmed, direct cause of this specific incident.** Of the eight words
in `RESTRAINED_TONE_KEYWORDS`, seven (`restrained, quiet, understate, minimal, refined, subtle,
calm`) plausibly describe an intended *visual/experiential register* directly — a business
describing itself this way is very likely making a real statement about how its site should
feel. `"unpretentious"` is different in kind: it describes the *business's own character*
(down-to-earth, no airs) — a true and useful creative read for a neighborhood trattoria — but
says nothing about what its *website* should look or move like. Design Intelligence's LLM call
assigned it correctly and honestly (Dante's really is unpretentious); the mechanical mapping from
that word to "cut a full motion tier" is where the mismatch actually lives.

**Robert's specific fear — that "warm," "authentic," "down-to-earth," "family-owned,"
"old-fashioned" are also live landmines today — does not hold for the *current* list.** None of
those words are in `RESTRAINED_TONE_KEYWORDS` right now. Only `"unpretentious"` is. But the
underlying *class* of risk he's naming is real: Design Intelligence's brand-personality output is
free-text LLM generation, not a fixed vocabulary, and this exact business category (warm, modest,
family-run local businesses) will keep producing exactly this flavor of word. Today it's one word
that slipped in; a keyword-only defense against an open-ended LLM vocabulary will keep needing
maintenance as new near-miss words surface, which is a real, ongoing cost of this design even
after `"unpretentious"` itself is fixed.

**The stacking logic is a secondary, real contributor, but fixing it alone doesn't resolve this
incident, and over-fixing it here would break a case Robert wants preserved (see §5).** The
freely-additive `-1` (uncapped against the evidence ceiling specifically) is *why* one keyword
match was able to erase an entire tier rather than something smaller — but the tone check's
legitimate job (§2) *requires* the ability to pull a result below what evidence alone would
support (a rich-evidence, genuinely-restrained business is exactly the case this mechanism exists
to serve). Capping the nudge so it can never go below the evidence ceiling would fix Dante's case
too, but would also disable the mechanism's one clearly legitimate use — evaluated and not
recommended as the primary fix in §5, for exactly this reason.

---

## 4. Blast radius — test suite and mode survey

**Seven test files reference this mechanism**, confirmed by direct grep, not assumed:
`composition-variants.test.ts`, `experience-planner.test.ts`, `capability-selector.test.ts`,
`capability-hero-execution.test.ts`, `design-intelligence-service.test.ts`,
`design-refinement-service.test.ts`, `design-qa-service.test.ts`.

**Exactly two tests use the literal word `"unpretentious"`**, both read in full:
- `composition-variants.test.ts:80-89` — `brandPersonality: ["unpretentious", "confident"]`,
  asserts only `paddingBiasSteps` (spacing), never touches motion/capability.
- `design-qa-service.test.ts:214-223` — `brandPersonality: ["unpretentious", "quiet"]`, asserts
  a QA `qaSpacing` verdict — also spacing-only (and note this fixture *also* contains `"quiet"`,
  a word that would remain in any narrowed motion-specific list, so even the spacing/QA
  cross-check keeps a real restrained-tone signal present either way).

**Every test that exercises the *motion or capability* effect of a restrained tone uses only
unambiguous words** — `["restrained", "quiet"]` (`experience-planner.test.ts:118`),
`["restrained"]` (`experience-planner.test.ts:143`), `["understated", "quiet"]`
(`capability-selector.test.ts:227`, `capability-hero-execution.test.ts:125`), `["restrained"]`
(`capability-selector.test.ts:265`). **None of these rely on `"unpretentious"`.**

**Practical consequence:** removing `"unpretentious"` from a motion/capability-specific keyword
set, while leaving the original list (with `"unpretentious"` intact) for the spacing use, would
flip **zero** currently-passing tests. This is a directly checked fact, not an estimate.

**Mode survey:** `resolveMotionBudget`'s tone nudge applies unconditionally across all 8
`EXPERIENCE_MODE_VOCABULARY` modes — it is not mode-gated at all, unlike
`MOTION_BUDGET_CEILING_BY_MODE`. `isShaderHeroGranted`'s own independent veto only matters for
the 4 modes in `SHADER_HERO_ALLOWED_MODES` (`cinematic-storytelling`, `high-energy-retail`,
`product-showcase`, `interactive-showcase`) — for the other 4 modes the veto is moot, since
shader-enhanced-hero is already excluded by mode alone.

---

## 5. Proposed fix — ranked, with reasoning

### Recommendation 1 (primary): split the keyword list by consumer, not by rewriting the mechanism

Keep `RESTRAINED_TONE_KEYWORDS` exactly as-is (including `"unpretentious"`) for
`composition-variants.ts`'s own original spacing use — that effect is low-stakes, was never the
complaint, and `"unpretentious"` genuinely does support "give this business's site a touch more
breathing room." Introduce a second, narrower constant — used only by
`experience-planner.ts`'s `resolveMotionBudget` and `capability-selector.ts`'s
`isShaderHeroGranted` — containing the seven words that actually describe visual/experiential
register (`restrained, quiet, understate, minimal, refined, subtle, calm`), dropping
`"unpretentious"`.

**Why this ranks first:** it's the smallest possible change that directly fixes the confirmed
root cause (a word, not an arithmetic error), touches zero evidence-ceiling logic, zero
capability-selector *architecture* (only which constant one function references), and — proven
in §4, not assumed — breaks no existing test. It also doesn't touch the one legitimate use case
(a rich-evidence, genuinely-restrained business still gets pulled down by "restrained"/"quiet"/etc.,
exactly as designed and exactly as already tested).

**Its limitation, stated honestly:** it's a fix for the word we now know about, not a structural
guarantee against the next one. Recommendation 2 addresses that.

### Recommendation 2 (complementary, do alongside #1): fix substring matching to word-boundary matching

`personalityPaddingBias` currently does `haystack.includes(keyword)` on a lowercased,
joined string — a **substring** match with no negation-awareness. A `contentTone` reading
"not loud or overstated" would match `"loud"` (bold) and `"understate"` (restrained) — both
false positives, and both would fire even under Recommendation 1. This is a real, separate,
mechanical precision gap, independent of which words are on which list, and cheap to fix
(word-boundary regex instead of `.includes()`). Doesn't change intent or scope — same keyword
lists, same two output classes, just matched correctly.

### Recommendation 3 (not recommended now): cap the tone-nudge so it can never reduce below the evidence ceiling

Evaluated because Robert asked for it explicitly. **Rejected as the primary fix** because it
would disable the mechanism's one clearly legitimate, already-tested job: a rich-evidence
business whose real personality reads as genuinely restrained is *supposed* to land below what
evidence alone would support (that's the entire point of `experience-planner.test.ts:109-121`'s
own fixture). Capping against the evidence ceiling specifically would silently break that
scenario the next time it occurs for a real business. If Recommendations 1+2 turn out to be
insufficient in practice (a future word or phrase still slips through and causes an
over-aggressive stack), the more targeted next step would be requiring corroboration — e.g., two
independent restrained signals, or a check against a second, independent field — rather than a
blanket evidence-floor cap; not proposed for implementation now since #1+#2 already fix the
confirmed case without this larger behavior change.

**Ranked order: 1, then 2 alongside it. 3 not recommended unless 1+2 prove insufficient later.**

---

## 6. Test cases that would prove the fix correct

1. **Dante's-equivalent case, exact repro:** `resolveMotionBudget("cinematic-storytelling",
   { services: 0, certifications: 0, hasReviews: false, galleryCount: 20, hasRealTeam: false },
   "restrained", ["warm", "unpretentious", "rooted", "authentic"], "Warm, direct, unpretentious
   neighborhood-Italian voice...")` must now return `"subtle"`, not `"none"` — and
   `resolveExperienceCapabilities` on that plan must grant `basic-motion`.
2. **Formal/somber case must be unaffected:** a `trust-authority`-or-`premium-minimal`-mode
   business with rich evidence and `brandPersonality: ["restrained", "dignified", "quiet"]` must
   still resolve motion at `"subtle"` or lower (mode ceiling already enforces this; the narrowed
   keyword list still matches `"restrained"`/`"quiet"` for the tone nudge on top) — proving the
   legitimate case survives the fix untouched.
3. **A rich-evidence, non-restrained-mode business whose real tone is genuinely restrained**
   (e.g. `warm-local-business` with rich evidence but `brandPersonality: ["quiet", "understated"]`)
   must still be pulled down a tier — this is `experience-planner.test.ts:109-121`'s own existing
   test; it must keep passing unchanged, proving Recommendation 1 doesn't collaterally disable
   the mechanism's real job.
4. **A merely-humble business must no longer be penalized on motion:** `brandPersonality:
   ["warm", "unpretentious", "family-owned"]` alone (no other restrained words) must *not* trigger
   the motion/capability nudge, while a parallel spacing-only check on the same input must still
   show the `+1` paddingBiasSteps nudge (proving the split, not a deletion, is what happened).
5. **Substring false-positive check (Recommendation 2):** `contentTone: "not loud, not
   understated either — just direct"` must not match either keyword list after the word-boundary
   fix, where it would incorrectly match both today.
6. **Full regression:** every existing test in the seven files listed in §4 must still pass
   unmodified — confirmed in advance by direct reading (§4) that none of them depend on
   `"unpretentious"` for a motion/capability assertion, so this is a real prediction, not a hope.

---

## 7. Scope confirmation

Recommendations 1 and 2 touch only:
- `composition-variants.ts` (adding the second, narrower constant; `personalityPaddingBias`'s own
  matching logic for Recommendation 2)
- `experience-planner.ts` (which constant `resolveMotionBudget` imports/checks)
- `capability-selector.ts` (which constant `isShaderHeroGranted` imports/checks)

**Confirmed NOT touched by either recommendation:**
- The evidence-based ceiling itself — `evidenceMotionCeiling`, `MOTION_BUDGET_CEILING_BY_MODE`,
  `MOTION_BUDGET_CEILING_BY_INTENSITY` are all unchanged; evidence continues to mean exactly what
  it means today.
- The capability selector/adapter/registry *architecture* — `resolveExperienceCapabilities`'s
  shape, the `CapabilityDecision` contract, `basic-motion`'s own gate (`isBasicMotionGranted`,
  untouched — it only reads `motionBudget`, never brand personality directly), and the
  Adapter/Registry layers are all unmodified. Only the keyword *values* one existing gate function
  already consults change.
- QA — `design-qa-service.ts`'s own re-verification of `personalityPaddingBias` for the spacing
  signal is unaffected, since the spacing list is unchanged.

No genuine need found to touch any of the three items Robert flagged as out-of-bounds. If that
changes during implementation, this document's own claim here should be treated as void until
re-confirmed.

---

## Status

Audit complete. No code written, no test modified, no commit made. Awaiting Robert's approval of
Recommendation 1 (+ 2 alongside it) before any implementation begins.
