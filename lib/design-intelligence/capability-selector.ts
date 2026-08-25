import type { IndustryBucket } from "@/lib/design-references/reference-library";
import type { HeroPatternId } from "@/lib/design-intelligence/section-patterns";
import type { ExperiencePlanEvidenceDensity } from "@/lib/design-intelligence/experience-planner";
import { MOTION_BUDGET_RANK, type ExperiencePlan } from "@/shared/design-intelligence/types";

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
 * Exactly one real token today, basic-motion (item 37's approved smallest
 * next build): formalizes what design-refinement-service.ts's refineMotion
 * already does today, unnamed. No other capability token exists yet —
 * scroll-linked-storytelling, shader-enhanced-hero, immersive-product-scene,
 * kinetic-typographic-storytelling, etc. are all named in the audit as
 * future candidates and are deliberately NOT built here.
 */

/**
 * The closed capability-token vocabulary. Exactly one member today —
 * "basic-motion" — per the founder's explicit Phase 6.5 scope ("do not
 * exceed"). Every future token named in docs/PHASE_6.5_CAPABILITY_AUDIT.md
 * is deliberately absent — adding an unused token would be exactly the
 * "decoration nobody asked for" pattern shared/design-intelligence/types.ts's
 * own MOTION_BUDGET_VOCABULARY comment already warns against. TypeScript's
 * exhaustive checking on Record<CapabilityToken, ...> lookups forces every
 * future addition to be a deliberate, additive, non-breaking change.
 */
export const CAPABILITY_TOKEN_VOCABULARY = ["basic-motion"] as const;
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
  const granted = isBasicMotionGranted(input.experiencePlan);
  return [
    {
      token: "basic-motion",
      granted,
      supportLevel: basicMotionSupportLevel(granted),
      confidenceScore: basicMotionConfidenceScore(input.experiencePlan),
      reason: basicMotionReason(input.experiencePlan, granted),
    },
  ];
}
