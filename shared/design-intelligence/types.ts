/**
 * shared/design-intelligence/types.ts — Phase 6 ("Adaptive Experience & Wow
 * Factor") experience-planning contract: the vocabulary Generation
 * (lib/design-intelligence/experience-planner.ts), Refinement, and
 * (eventually) QA all need to agree on. Lives outside lib/design-
 * intelligence/ deliberately — this is part of the broader cross-pipeline
 * Design Intelligence contract, not a private implementation detail of one
 * planner module (the founder's own Phase 6.1 instruction). Mirrors
 * lib/design-intelligence/types.ts's existing boundary for this same reason:
 * schema and vocabulary only, never a per-mission value, never orchestration
 * — nothing here depends on an adapter, a repository, Supabase, or the
 * Mission Engine, and nothing here decides anything for a specific business.
 * The actual decision logic (resolveExperiencePlan) lives in
 * lib/design-intelligence/experience-planner.ts, which imports these types
 * rather than declaring its own.
 */

/**
 * The experience direction a specific business's real evidence supports —
 * Phase 6.1's starting vocabulary (Phase 6 directive §"PHASE 6.1"), not a
 * rigid business-category -> mode fixed mapping. Two businesses in the same
 * IndustryBucket with different real evidence can land on different modes;
 * two businesses in different buckets with similar evidence can share one —
 * resolveExperiencePlan (lib/design-intelligence/experience-planner.ts)
 * enforces that by gating each mode on real evidence, never picking one from
 * industryBucket alone.
 */
export const EXPERIENCE_MODE_VOCABULARY = [
  "cinematic-storytelling",
  "editorial-storytelling",
  "premium-minimal",
  "product-showcase",
  "high-energy-retail",
  "trust-authority",
  "warm-local-business",
  "interactive-showcase",
] as const;

export type ExperienceMode = (typeof EXPERIENCE_MODE_VOCABULARY)[number];

/**
 * Phase 6.4's four-level motion budget — ordered, increasing experiential
 * intensity. Never a claim that a higher level is objectively "better": a
 * business whose real evidence and category call for `none`/`subtle` is not
 * an unfinished cinematic experience, it is the correct, honest choice for
 * that business (Phase 6's own "some businesses should receive almost no
 * advanced motion" instruction). At the Phase 6.1 checkpoint this is inert
 * planning data — RefinedDesign.motion (design-refinement-service.ts)
 * doesn't yet consume it; that wiring is a later, separate checkpoint.
 *
 * Deliberately left room to grow (founder's "FUTURE 3D EXPERIENCE
 * CAPABILITY" architectural guidance): a future 5th tier (e.g. a
 * `3D-immersive` step above `cinematic`, for the rare business whose real
 * evidence — strong product/architectural/hospitality photography, a brand
 * direction that genuinely calls for it — justifies an immersive/3D
 * experience) is a pure additive change to this array plus
 * MOTION_BUDGET_RANK below. Every consumer keys off MotionBudget through
 * `Record<MotionBudget, ...>` (see experience-planner.ts's
 * MOTION_BUDGET_CEILING_BY_MODE/BY_INTENSITY) or this file's own
 * MOTION_BUDGET_RANK, both of which TypeScript's `strict` mode forces to be
 * exhaustively updated the moment a new value is added here — there is no
 * silent gap a new tier could fall through unnoticed. Not added now: no
 * business today can honestly justify a 3D/immersive tier (no evidence
 * source for it exists in the pipeline yet), and adding an unused value
 * would be exactly the "decoration nobody asked for" this codebase already
 * bans elsewhere.
 */
export const MOTION_BUDGET_VOCABULARY = ["none", "subtle", "enhanced", "cinematic"] as const;

export type MotionBudget = (typeof MOTION_BUDGET_VOCABULARY)[number];

/**
 * Ordinal rank for comparing/clamping MotionBudget values — used only to
 * compute the minimum of several independent ceilings (evidence richness,
 * the experience mode's own ceiling, Design Intelligence's disclosed
 * motionIntensity, brand-personality tone). Never used to imply one level is
 * inherently more desirable than another.
 */
export const MOTION_BUDGET_RANK: Record<MotionBudget, number> = {
  none: 0,
  subtle: 1,
  enhanced: 2,
  cinematic: 3,
};

/**
 * ExperiencePlan is intentionally NOT closed to exactly {mode, motionBudget,
 * rationale} forever. The founder's "FUTURE 3D EXPERIENCE CAPABILITY"
 * guidance describes a later, separate capability — reasoning about whether
 * a business's real evidence (strong product/architectural/hospitality
 * photography, brand direction, product type) justifies an immersive/3D
 * experience (Three.js, React Three Fiber, Spline, or another browser-based
 * 3D/motion system) — that is deliberately out of scope for Phase 6.1, but
 * must not be designed AWAY from here. A future, separate field on this
 * interface (e.g. an `interactionCapability?: "none" | "subtle-interactive"
 * | "immersive-motion" | "3D-immersive"`-shaped addition — illustrative only,
 * not committed to) would be a pure additive optional field, exactly the
 * same non-breaking shape compositionVariant/experiencePlan themselves used
 * when they were added to Wireframe — every existing caller of
 * resolveExperiencePlan and every existing ExperiencePlan consumer keeps
 * type-checking unchanged. This module stays technology-agnostic on
 * purpose: it expresses INTENT (a mode, a budget), never a library name —
 * no field here should ever be named after Three.js/GSAP/Spline/etc.
 * directly, so a future rendering choice never has to fight this schema.
 */
export interface ExperiencePlan {
  mode: ExperienceMode;
  motionBudget: MotionBudget;
  /**
   * Plain-English explanation grounded in real evidence already available to
   * the pipeline (real gallery/team/certification/review/service counts,
   * the already-resolved hero pattern, Design Intelligence's own disclosed
   * motionIntensity) — never a vague "modern"/"premium" justification with
   * nothing real behind it, matching design-intelligence-service.ts's own
   * "constraints over vibes" discipline.
   */
  rationale: string;
}

// ===========================================================================
// Phase 6.4 — Human-in-the-Loop Experience Refinement. A bounded preference
// vocabulary a founder can express AFTER seeing the AI's resolved
// ExperiencePlan, never a mode override and never a raw numeric dial. Two
// independent axes, each with an explicit neutral value (never "no field
// present" — a neutral selection is itself a real, chosen state: "I looked
// at this and want the AI's own recommendation," distinct from "I haven't
// looked yet"). Resolution (lib/design-intelligence/experience-planner.ts's
// resolveMotionBudget) treats both axes as bounded nudges on the SAME
// existing mode/evidence/intensity ceiling composition — never a second,
// independent decision path. Matches the founder's own framing exactly:
// "AI recommendation -> human preference input -> existing constraint
// resolution -> final resolved experience plan."
// ===========================================================================

/** "Experience Tone" — the founder-facing axis closest to motionIntensity/brandPersonality's own existing register. calmer/more-energetic only ever nudge the resolved motion budget within what the mode/evidence/intensity ceiling composition already allows; "more-energetic" can never push a business past its own evidence-backed ceiling. */
export const ENERGY_PREFERENCE_VOCABULARY = ["calmer", "keep", "more-energetic"] as const;
export type EnergyPreference = (typeof ENERGY_PREFERENCE_VOCABULARY)[number];

/** "Motion Intensity" — the founder-facing axis closest to the motion budget itself. Same bounded-nudge contract as EnergyPreference; the two axes are independent (a founder could ask for calmer tone AND more motion) and compose onto the same resolved rank, each within the same hard ceiling. */
export const MOTION_PREFERENCE_VOCABULARY = ["less", "recommended", "more"] as const;
export type MotionPreference = (typeof MOTION_PREFERENCE_VOCABULARY)[number];

/**
 * A founder's bounded preference, always both axes present (the UI is two
 * required button groups, not optional freeform fields) — "keep"/
 * "recommended" on both axes is itself a meaningful, loggable choice ("I
 * reviewed this and it's right as-is"), not the absence of one.
 */
export interface HumanExperiencePreference {
  energy: EnergyPreference;
  motion: MotionPreference;
}

/** The neutral preference — resolves to exactly the AI baseline, byte-for-byte. Used both as the UI's own default selection and as the explicit "Reset to AI Recommendation" action's payload, so a reset is a real, insert-only history entry (§6.4's insert-only requirement) rather than a special-cased delete/null. */
export const NEUTRAL_EXPERIENCE_PREFERENCE: HumanExperiencePreference = { energy: "keep", motion: "recommended" };
