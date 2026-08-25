import type { IndustryBucket } from "@/lib/design-references/reference-library";
import type { HeroPatternId } from "@/lib/design-intelligence/section-patterns";
import type { ExperiencePlanEvidenceDensity } from "@/lib/design-intelligence/experience-planner";
import { MOTION_BUDGET_RANK, type ExperienceMode, type ExperiencePlan } from "@/shared/design-intelligence/types";
import { personalityPaddingBias } from "@/lib/design-intelligence/composition-variants";

/**
 * lib/design-intelligence/capability-selector.ts — Phase 6.5's approved
 * smallest next build (docs/PHASE_6.5_CAPABILITY_AUDIT.md item 37, confirmed
 * by Robert): the Capability Selector. Sits strictly after Human Refinement
 * and strictly before Execution Runtime in the approved pipeline position:
 * Evidence -> Composition/Hero Pattern -> Experience Plan -> Human
 * Refinement -> Capability Selector -> Execution Runtime -> Rendered QA.
 *
 * A deterministic rule table, not a reasoning step (the audit's confirmed
 * directive #2) — same discipline as resolveExperienceMode/
 * resolveMotionBudget (experience-planner.ts): the same input always
 * produces the same grant, no model call, fully testable. Read-only against
 * its inputs — no independent re-derivation of evidence, never re-resolves
 * ExperiencePlan itself (the same anti-drift discipline experience-
 * planner.ts and composition-variants.ts already hold each other to).
 *
 * Device-independent, business-only reasoning (audit item 27): this module
 * must never know about a vendor, a library, or the visitor's actual device
 * — that is the Adapter's and Runtime's job (capability-adapter.ts), never
 * the Selector's. Business intelligence (mode, evidence, budget) does not
 * change based on what device loads the page.
 *
 * Output shape locked by the audit's item 23: {token, granted, supportLevel,
 * confidenceScore, reason} — granted is produced FIRST and ENTIRELY by the
 * deterministic gate below; supportLevel/confidenceScore/reason are computed
 * AFTER and FROM that outcome, and never feed back into whether a
 * capability is granted (the audit's own locked rule).
 *
 * Two real tokens today: basic-motion (item 37's approved smallest next
 * build, Phase 6.5) and shader-enhanced-hero (Phase 6.6, approved by Robert
 * after docs/PHASE_6.6_SHADER_TECHNICAL_AUDIT.md). basic-motion formalizes
 * what design-refinement-service.ts's refineMotion already does. shader-
 * enhanced-hero is the first capability whose execution technology is
 * genuinely new to this codebase (raw WebGL, no dependency) rather than a
 * wrapper around something that already existed — proving the Selector/
 * Adapter/Registry seam generalizes beyond its original proof-of-concept
 * token. No other capability token exists yet — scroll-linked-storytelling,
 * immersive-product-scene, kinetic-typographic-storytelling, etc. remain
 * named-but-unbuilt future candidates.
 */

/**
 * The closed capability-token vocabulary. Every future token named in
 * docs/PHASE_6.5_CAPABILITY_AUDIT.md / docs/PHASE_6.6_RESEARCH_SYNTHESIS.md
 * beyond these two is deliberately absent — adding an unused token would be
 * exactly the "decoration nobody asked for" pattern shared/design-
 * intelligence/types.ts's own MOTION_BUDGET_VOCABULARY comment already warns
 * against. TypeScript's exhaustive checking on Record<CapabilityToken, ...>
 * lookups forces every future addition to be a deliberate, additive,
 * non-breaking change.
 */
export const CAPABILITY_TOKEN_VOCABULARY = ["basic-motion", "shader-enhanced-hero"] as const;
export type CapabilityToken = (typeof CAPABILITY_TOKEN_VOCABULARY)[number];

/**
 * Mirrors opportunity-report-service.ts's own ConfidenceLevel discipline
 * (High/Medium/Low), reused here for "how strongly this token's own
 * execution technology can fulfill this business's resolved experience" per
 * the audit's item 23. Never used to describe eligibility itself — `granted`
 * is a separate, prior field this can never influence.
 */
export const CAPABILITY_SUPPORT_LEVEL_VOCABULARY = ["High", "Medium", "Low"] as const;
export type CapabilitySupportLevel = (typeof CAPABILITY_SUPPORT_LEVEL_VOCABULARY)[number];

export interface CapabilityDecision {
  token: CapabilityToken;
  /** The sole product of the deterministic gate below — never influenced by supportLevel/confidenceScore/reason (the audit's own locked rule, item 23). */
  granted: boolean;
  /** Discrete tier, computed AFTER granted — describes how strongly the token's own execution technology can fulfill this business's resolved experience, never whether it should be granted. */
  supportLevel: CapabilitySupportLevel;
  /** Deterministic numeric value in [0, 1], computed by a fixed formula over the already-resolved MotionBudget rank (shared/design-intelligence/types.ts's MOTION_BUDGET_RANK) — mirrors opportunity-scoring-service.ts's own weighted-average-over-fixed-conditions discipline, never a model estimate. */
  confidenceScore: number;
  /** Plain-English explanation naming the actual conditions met/unmet, built the same honest way experience-planner.ts's describeHumanPreferenceOutcome already builds its explanations. */
  reason: string;
}

export interface ResolveExperienceCapabilitiesInput {
  /** The already-resolved plan (mode, motionBudget) — Phase 6.4's human-preference nudge, if any, is already folded in by resolveExperiencePlan/resolveMotionBudget upstream. Never re-resolved here. */
  experiencePlan: ExperiencePlan;
  /**
   * Read-only, the same struct experience-planner.ts's resolveExperiencePlan
   * already consumes — carried through, never re-derived. Unused by
   * basic-motion's own gate today; accepted as part of this module's
   * declared input contract because every future token in the audit (item
   * 2, item 15, item 19) needs it. Optional — not every real caller has raw
   * evidence density on hand at its own call site (the live Refinement-time
   * integration point, lib/design-intelligence/capability-motion-
   * execution.ts, only has the already-resolved ExperiencePlan and
   * Wireframe, not the original evidence counts that produced it); a caller
   * that does have it should still pass it, since basic-motion's own gate
   * ignores it either way and a future token will want it.
   */
  evidence?: ExperiencePlanEvidenceDensity;
  /** Same reasoning as `evidence` above — unused by basic-motion, required by future tokens, optional for the same "not every real caller has it" reason. */
  industryBucket?: IndustryBucket;
  /** Same reasoning as `evidence` above — unused by basic-motion, required by future tokens, optional for the same "not every real caller has it" reason. */
  heroPattern?: HeroPatternId;
  /**
   * Design Intelligence's own real per-business brandPersonality/contentTone
   * (DesignMemory) — the same real signal composition-variants.ts's
   * personalityPaddingBias already uses for its spacing-rhythm nudge, reused
   * here verbatim (never a second keyword scanner) by shader-enhanced-hero's
   * gate: an energetic-register business whose actual DesignMemory reads as
   * deliberately restrained still doesn't get an atmospheric shader
   * background — restraint is respected even inside a bold mode, the same
   * discipline the rest of this codebase already extends everywhere else.
   * Unused by basic-motion. Optional — the live render-time integration
   * point (design-preview.tsx) always has DesignMemory on hand and passes
   * it; a caller that doesn't simply gets shader-enhanced-hero's restrained-
   * tone check treated as "no restraint signal," never a crash.
   */
  brandPersonality?: string[];
  contentTone?: string;
}

/**
 * basic-motion's own deterministic gate: granted exactly when this
 * business's resolved motion budget calls for ANY motion at all. A "none"
 * budget business (a genuinely evidence-sparse business, or a trust-
 * authority/premium-minimal register whose real evidence/category caps it
 * there) stays genuinely motion-free — basic-motion is never granted just
 * because the adapter exists, mirroring refineMotionFromExperiencePlan's own
 * "none" -> zero motion entries, full stop" discipline
 * (design-refinement-service.ts).
 */
function isBasicMotionGranted(plan: ExperiencePlan): boolean {
  return plan.motionBudget !== "none";
}

/**
 * confidenceScore formula: the resolved motion budget's own rank
 * (shared/design-intelligence/types.ts's MOTION_BUDGET_RANK), normalized
 * against the top rank. Deterministic and evidence-grounded because
 * MotionBudget itself is already the output of resolveMotionBudget's
 * evidence-and-category-derived ceiling composition — this reuses that
 * resolved value rather than re-deriving a second, possibly-drifting read of
 * the same evidence (the same anti-drift discipline every other Phase 6
 * module holds to). 0 for a "none" budget (the ungranted case, included for
 * completeness rather than left undefined).
 */
function basicMotionConfidenceScore(plan: ExperiencePlan): number {
  const maxRank = MOTION_BUDGET_RANK.cinematic;
  return Math.round((MOTION_BUDGET_RANK[plan.motionBudget] / maxRank) * 100) / 100;
}

/**
 * supportLevel: basic-motion (CSS transform/opacity + IntersectionObserver)
 * is already the one execution technology every motion budget tier from
 * "subtle" through "cinematic" renders through today — it is never
 * budget-limited the way a future, heavier capability might be. "High" for
 * any granted budget therefore reflects a real, verifiable fact (the
 * existing refineMotionFromExperiencePlan already fully implements every
 * tier), not an optimistic default. "Low" only for the ungranted case, where
 * there is nothing for the adapter to support.
 */
function basicMotionSupportLevel(granted: boolean): CapabilitySupportLevel {
  return granted ? "High" : "Low";
}

function basicMotionReason(plan: ExperiencePlan, granted: boolean): string {
  if (!granted) {
    return `Not granted: this business's resolved experience plan carries a motion budget of "none" — ${plan.rationale} No capability requires motion when the resolved plan itself calls for zero motion; the render stays genuinely motion-free.`;
  }
  return `Granted: this business's resolved motion budget is "${plan.motionBudget}" under the "${plan.mode}" experience mode. The basic-motion adapter (existing CSS transform/opacity entrance + IntersectionObserver scroll-reveal) already fully implements every non-"none" motion budget tier, so support is High regardless of which tier was earned.`;
}

// ===========================================================================
// shader-enhanced-hero — Phase 6.6. Approved gate
// (docs/PHASE_6.6_SHADER_TECHNICAL_AUDIT.md): a bounded, procedural,
// non-representational WebGL background reserved for the four experience
// modes whose register is already built around energy/spectacle, at the top
// two motion-budget tiers, never for a business whose real personality/tone
// reads as deliberately restrained.
// ===========================================================================

/**
 * The four modes whose own MOTION_BUDGET_CEILING_BY_MODE ceiling
 * (experience-planner.ts) is already "enhanced" or "cinematic" — not a
 * coincidental list, the same modes whose visual register already embraces
 * boldness. A POSITIVE allowlist, not a negative exclusion list: a future
 * mode added to EXPERIENCE_MODE_VOCABULARY defaults to excluded until
 * someone deliberately adds it here, the correct fail-closed default for "is
 * this business's register bold enough for an atmospheric shader
 * background," mirroring this codebase's other allowlist precedents
 * (PHOTO_DEPENDENT_EXPERIENCE_MODES, INTERACTIVE_SECTIONS).
 *
 * trust-authority and premium-minimal need no explicit entry here — their
 * own mode ceiling already caps motionBudget at "subtle", so the budget
 * condition below excludes them structurally, the same "structural
 * guarantee, not a check that could be forgotten" discipline
 * resolveMotionBudget's own Math.min() composition already relies on.
 * editorial-storytelling and warm-local-business, by contrast, CAN
 * legitimately reach "enhanced" with rich evidence — they are excluded here
 * explicitly, on purpose: a shifting atmospheric background is tonally wrong
 * for a calm, typographic, or warm-human register even when the evidence
 * would technically support the motion tier. This is the one place this
 * gate encodes a register judgment beyond pure evidence density.
 */
const SHADER_HERO_ALLOWED_MODES = new Set<ExperienceMode>([
  "cinematic-storytelling",
  "high-energy-retail",
  "product-showcase",
  "interactive-showcase",
]);

/** Same non-negotiable minimum motionBudget every allowed mode's register can support — reusing this rank comparison rather than a fixed string-set check keeps the condition exhaustive against MOTION_BUDGET_VOCABULARY the same way MOTION_BUDGET_RANK already is everywhere else. */
const SHADER_HERO_MIN_MOTION_BUDGET_RANK = MOTION_BUDGET_RANK.enhanced;

/**
 * shader-enhanced-hero's own deterministic gate. Reads only already-resolved
 * values (mode, motionBudget — both post-human-refinement; brandPersonality/
 * contentTone — Design Intelligence's own real per-business output) — never
 * re-derives evidence, never touches a vendor/library/device concern (that
 * stays the Adapter's and the client runtime's job, per this module's own
 * established device-independence boundary).
 *
 * Human-preference-past-the-ceiling protection is inherited for free, not
 * re-implemented: motionBudget here is already the value resolveMotionBudget
 * produced AFTER Math.min(ceilingRank, ...) applied any human preference, so
 * a trust-authority business requesting "more energetic" + "more motion"
 * simultaneously still resolves to "subtle" and never reaches this gate's
 * true branch — proven directly in the founder-refinement test suite. mode
 * is even more strongly protected: resolveExperienceMode never reads human
 * preference at all, so no preference combination can move a business into
 * SHADER_HERO_ALLOWED_MODES either.
 */
function isShaderHeroGranted(plan: ExperiencePlan, brandPersonality?: string[], contentTone?: string): boolean {
  if (!SHADER_HERO_ALLOWED_MODES.has(plan.mode)) return false;
  if (MOTION_BUDGET_RANK[plan.motionBudget] < SHADER_HERO_MIN_MOTION_BUDGET_RANK) return false;
  const restrainedTone = personalityPaddingBias(brandPersonality, contentTone) > 0;
  if (restrainedTone) return false;
  return true;
}

/**
 * confidenceScore: same formula shape as basic-motion's own (a deterministic
 * function of the resolved motion budget's rank, normalized against the top
 * rank) — reused rather than a second scoring scheme, since the same real
 * signal (how much evidence-backed motion budget this business earned)
 * legitimately explains "how strongly does this business's resolved
 * experience support an atmospheric treatment" for shader-enhanced-hero too.
 */
function shaderHeroConfidenceScore(plan: ExperiencePlan): number {
  const maxRank = MOTION_BUDGET_RANK.cinematic;
  return Math.round((MOTION_BUDGET_RANK[plan.motionBudget] / maxRank) * 100) / 100;
}

/**
 * supportLevel: "High" whenever granted — the one shader visual family this
 * phase ships is uniform (no tiered variants), so once eligibility clears,
 * the adapter's own execution technology supports the granted experience
 * completely, not partially. "Low" when not granted, mirroring basic-
 * motion's own "nothing for the adapter to support" reasoning.
 */
function shaderHeroSupportLevel(granted: boolean): CapabilitySupportLevel {
  return granted ? "High" : "Low";
}

function shaderHeroReason(plan: ExperiencePlan, granted: boolean, brandPersonality?: string[], contentTone?: string): string {
  if (!SHADER_HERO_ALLOWED_MODES.has(plan.mode)) {
    return `Not granted: the "${plan.mode}" experience mode is not one of the energetic-register modes shader-enhanced-hero is reserved for (cinematic-storytelling, high-energy-retail, product-showcase, interactive-showcase) — an atmospheric shader background does not fit this business's own resolved register, regardless of its motion budget.`;
  }
  if (MOTION_BUDGET_RANK[plan.motionBudget] < SHADER_HERO_MIN_MOTION_BUDGET_RANK) {
    return `Not granted: this business's resolved motion budget is "${plan.motionBudget}", below the "enhanced" floor shader-enhanced-hero requires even under an eligible "${plan.mode}" mode — ${plan.rationale}`;
  }
  if (personalityPaddingBias(brandPersonality, contentTone) > 0) {
    return `Not granted: this business's real brand personality/content tone reads as deliberately restrained — an atmospheric shader background is withheld even though "${plan.mode}" at "${plan.motionBudget}" would otherwise qualify, the same respect for real restraint this codebase already extends to spacing rhythm.`;
  }
  return `Granted: "${plan.mode}" is an energetic-register mode and this business's resolved motion budget ("${plan.motionBudget}") clears shader-enhanced-hero's "enhanced" floor, with no restrained-tone signal withholding it. The shader adapter still requires the hero to have no real photograph already driving its background, and a real usable color palette, before it actually executes — checked separately, at execution time.`;
}

/**
 * resolveExperienceCapabilities — the one entry point a future Execution
 * Runtime calls. Always a real, complete decision array (never
 * partial/undefined), matching resolveExperiencePlan/
 * resolveCompositionVariant's own "always a real answer" contract. Exactly
 * one entry today (basic-motion) since CAPABILITY_TOKEN_VOCABULARY has
 * exactly one member — the array shape is deliberate so a future token is a
 * pure additive change (one new vocabulary entry plus one new set of
 * gate/supportLevel/confidenceScore/reason functions), never a rewrite of
 * this function's own signature or return shape.
 */
export function resolveExperienceCapabilities(input: ResolveExperienceCapabilitiesInput): CapabilityDecision[] {
  const basicMotionGranted = isBasicMotionGranted(input.experiencePlan);
  const shaderHeroGranted = isShaderHeroGranted(input.experiencePlan, input.brandPersonality, input.contentTone);
  return [
    {
      token: "basic-motion",
      granted: basicMotionGranted,
      supportLevel: basicMotionSupportLevel(basicMotionGranted),
      confidenceScore: basicMotionConfidenceScore(input.experiencePlan),
      reason: basicMotionReason(input.experiencePlan, basicMotionGranted),
    },
    {
      token: "shader-enhanced-hero",
      granted: shaderHeroGranted,
      supportLevel: shaderHeroSupportLevel(shaderHeroGranted),
      confidenceScore: shaderHeroConfidenceScore(input.experiencePlan),
      reason: shaderHeroReason(input.experiencePlan, shaderHeroGranted, input.brandPersonality, input.contentTone),
    },
  ];
}
