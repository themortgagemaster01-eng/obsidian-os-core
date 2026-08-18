import type { TypeRole } from "@/lib/design-intelligence/types";
import {
  DEFAULT_TYPE_SCALE,
  MAX_TYPE_FAMILIES,
  validateTypeScaleOrdering,
  validateTypographyChoice,
} from "@/lib/design-intelligence/typography-rules";
import { DEFAULT_SPACING_SCALE, validateSpacingScale, type SpacingScale } from "@/lib/design-intelligence/design-rules";
import {
  DEFAULT_GRID_RHYTHM,
  matchesGenericSaasTemplate,
  type GridRhythm,
} from "@/lib/design-intelligence/layout-rules";
import {
  MOTION_DURATION_BAND_MS,
  validateMotionChoice,
  type MotionChoice,
} from "@/lib/design-intelligence/motion-rules";
import {
  MOBILE_BODY_FONT_FLOOR_PX,
  MOBILE_READABILITY,
  validateMobileTypeChoice,
  validateTouchTarget,
  type TouchTarget,
} from "@/lib/design-intelligence/mobile-rules";

import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import type { SectionType, Wireframe } from "@/lib/services/design-generation-service";

/**
 * design-refinement-service.ts — Sprint 4 Phase 3 (Design Refinement). Not a
 * new pipeline stage: per docs/SPRINT_STATUS.md's own framing of this
 * phase's scope and the architecture boundary
 * docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md §1 already drew ("takes an
 * approved Design Brief and produces the actual site through internally-
 * separated passes (wireframe/component assembly, typography, spacing,
 * motion)"), this module is the typography/spacing/motion/mobile passes
 * design-generation-service.ts's Phase 2 doc comment explicitly deferred —
 * it consumes Phase 2's WebsiteStructure output and produces concrete,
 * checkable style values, refining what Phase 2 assembled rather than
 * replacing any of it. Called from design-generation-service.ts's own
 * orchestration (runDesignGeneration), not a new mission-state transition or
 * a new service in the Design Engine's three-service architecture.
 *
 * Each pass is a pure function, mirroring generateWireframe/
 * assembleComponents's own shape: deterministic, rule-derived, no LLM call,
 * no Supabase access. Every pass validates its own output against
 * lib/design-intelligence/'s actual validators (never a paraphrase of the
 * rule, the rule itself) and returns a `violations: string[]` — normally
 * empty, since these values are constructed to satisfy the rules by
 * construction, but checked for real rather than merely asserted, the same
 * "make the boundary a real enforced one in code" precedent
 * generateWireframe's own generic-SaaS-template check set in Phase 2.
 *
 * Layout refinement deliberately does NOT include §12 AC3's cross-mission
 * "no two sites share an identical section skeleton" check
 * (lib/design-intelligence/layout-rules.ts's findDuplicateSectionStructures)
 * — that's a batch-level comparison across missions, which is
 * design-qa-service.ts's (Phase 4, not yet built) job, not a single
 * mission's refinement pass. Keeping that boundary real is the same
 * "don't let Generation drift into QA territory" instruction this phase was
 * scoped under.
 */

// ===========================================================================
// Typography refinement
// ===========================================================================

export interface TypeRoleValue {
  role: TypeRole;
  sizePx: number;
  weight: "regular" | "medium" | "semibold" | "bold";
}

export interface TypographyRefinement {
  families: string[];
  scale: TypeRoleValue[];
  bodyLineLengthChars: number;
  bodyLineHeight: number;
  violations: string[];
}

/** Body role's concrete pixel size — every other role's size is derived from DEFAULT_TYPE_SCALE's proportions relative to this. */
const BASE_BODY_SIZE_PX = 16;
/** Mid-band defaults — real values within READABILITY's range (§3), not the range's edges. */
const DEFAULT_BODY_LINE_LENGTH_CHARS = 65;
const DEFAULT_BODY_LINE_HEIGHT = 1.5;

/**
 * refineTypography — turns Design Memory's family choice (already a
 * per-mission creative decision made by design-intelligence-service.ts) into
 * a concrete, validated scale. `memory` is optional: a Design Brief
 * predating design_memory (or a test fixture) still gets a safe, valid
 * default rather than this pass throwing.
 */
export function refineTypography(memory?: Pick<DesignMemory, "typography"> | null): TypographyRefinement {
  const violations: string[] = [];

  const requestedFamilies = [memory?.typography?.headingFamily, memory?.typography?.bodyFamily].filter(
    (f): f is string => !!f && f.trim().length > 0
  );
  let families = [...new Set(requestedFamilies)];

  if (families.length === 0) {
    families = ["system-ui"];
    violations.push(
      "Design Memory did not specify a typography family; defaulted to a system font stack (§3)."
    );
  } else if (families.length > MAX_TYPE_FAMILIES) {
    violations.push(
      `Design Memory named ${families.length} type families; capped at ${MAX_TYPE_FAMILIES} per §3.`
    );
    families = families.slice(0, MAX_TYPE_FAMILIES);
  }

  const scale: TypeRoleValue[] = DEFAULT_TYPE_SCALE.map((spec) => ({
    role: spec.role,
    sizePx: Math.round(BASE_BODY_SIZE_PX * spec.relativeSize),
    weight: spec.relativeWeight,
  }));

  violations.push(
    ...validateTypeScaleOrdering(
      scale.map((s) => ({ role: s.role, relativeSize: s.sizePx / BASE_BODY_SIZE_PX, relativeWeight: s.weight }))
    )
  );

  const bodyLineLengthChars = DEFAULT_BODY_LINE_LENGTH_CHARS;
  const bodyLineHeight = DEFAULT_BODY_LINE_HEIGHT;
  violations.push(...validateTypographyChoice({ families, bodyLineLengthChars, bodyLineHeight }));

  return { families, scale, bodyLineLengthChars, bodyLineHeight, violations };
}

// ===========================================================================
// Spacing refinement
// ===========================================================================

export type SectionSpacingRole = "hero" | "content" | "closing";

export interface SectionSpacingValue {
  section: SectionType;
  role: SectionSpacingRole;
  sectionPaddingRem: number;
  componentPaddingRem: number;
}

export interface SpacingRefinement {
  scale: SpacingScale;
  sectionSpacing: SectionSpacingValue[];
  violations: string[];
}

/** Exported for design-qa-service.ts's independent re-verification of section-spacing role-proportionality (defense in depth, §4.2) — never for a caller to derive a *new* spacing decision from. */
export function spacingRoleFor(section: SectionType): SectionSpacingRole {
  if (section === "hero") return "hero";
  if (section === "footer") return "closing";
  return "content";
}

/**
 * Indices into DEFAULT_SPACING_SCALE.steps — deliberately expressed as scale
 * positions, not standalone rem numbers, so every spacing value this pass
 * produces is provably a member of the one sitewide scale (§4's "a single
 * spacing scale applied sitewide," never an invented one-off value).
 * Section-level padding uses larger steps than component-level padding at
 * the same role, and hero's own values are larger than footer's — the
 * concrete form of §4's "a hero's internal spacing is not the same scale as
 * a footer link list's."
 */
export const SECTION_PADDING_STEP_INDEX_BY_ROLE: Record<SectionSpacingRole, number> = {
  hero: 9, // 8rem
  content: 7, // 4rem
  closing: 5, // 2rem
};
export const COMPONENT_PADDING_STEP_INDEX_BY_ROLE: Record<SectionSpacingRole, number> = {
  hero: 5, // 2rem
  content: 3, // 1rem
  closing: 1, // 0.5rem
};

function clampStepIndex(index: number, scaleLength: number): number {
  return Math.max(0, Math.min(scaleLength - 1, index));
}

/**
 * refineSpacing — assigns section- and component-level spacing per §4's
 * role-proportional standard, derived from the one sitewide scale (§9's
 * "reuse Obsidian's own numeric scale as a starting default"). When the
 * wireframe carries a real compositionVariant (lib/design-intelligence/
 * composition-variants.ts), its paddingBiasSteps shifts every role's step
 * index up or down — Luxury Minimal's real evidence-driven bias toward more
 * generous whitespace, Bold Commerce's toward tighter, denser rhythm — always
 * clamped into the one sitewide scale's actual index range, never an invented
 * off-scale value (§4). Absent for a wireframe predating compositionVariant,
 * which is exactly equivalent to a zero bias (today's existing behavior,
 * unchanged).
 */
export function refineSpacing(wireframe: Wireframe): SpacingRefinement {
  const scale = DEFAULT_SPACING_SCALE;
  const violations = [...validateSpacingScale(scale)];
  const bias = wireframe.compositionVariant?.paddingBiasSteps ?? 0;

  const sectionSpacing: SectionSpacingValue[] = wireframe.sections.map(({ type }) => {
    const role = spacingRoleFor(type);
    return {
      section: type,
      role,
      sectionPaddingRem: scale.steps[clampStepIndex(SECTION_PADDING_STEP_INDEX_BY_ROLE[role] + bias, scale.steps.length)],
      componentPaddingRem: scale.steps[clampStepIndex(COMPONENT_PADDING_STEP_INDEX_BY_ROLE[role] + bias, scale.steps.length)],
    };
  });

  return { scale, sectionSpacing, violations };
}

// ===========================================================================
// Layout refinement
// ===========================================================================

/** The renderer's own prior fixed content-width value — the compositionVariant-absent default, so an older persisted wireframe renders exactly as before. */
const DEFAULT_CONTENT_WIDTH_REM = 72;

export interface LayoutRefinement {
  grid: GridRhythm;
  /** Re-verified independently of generateWireframe's own check (defense in depth, §5, §11) — should always be false for any wireframe that reached this pass. */
  matchesGenericTemplate: boolean;
  /** §2's "a reader's eye should land on the most important thing first" — mechanically, the wireframe's first section is the hero. */
  leadsWithHero: boolean;
  /** wireframe.compositionVariant.contentWidthRem when present (lib/design-intelligence/composition-variants.ts's real, evidence-driven per-strategy content width — Luxury Minimal's wider column, Editorial's narrower one), otherwise this renderer's prior fixed 72rem. */
  contentWidthRem: number;
  violations: string[];
}

/**
 * refineLayout — applies the grid-rhythm default (§4) and re-verifies the
 * two layout invariants §5/§11 require. Does NOT perform §12 AC3's
 * cross-mission duplicate-structure check — see this file's header comment
 * for why that's out of scope here.
 */
export function refineLayout(wireframe: Wireframe): LayoutRefinement {
  const violations: string[] = [];
  const sectionOrder = wireframe.sections.map((s) => s.type);

  const matchesGenericTemplate = matchesGenericSaasTemplate(sectionOrder);
  if (matchesGenericTemplate) {
    violations.push(
      "Wireframe's section order matches the banned generic-SaaS-template pattern (§5, §11) — should be unreachable from generateWireframe's own templates; flagged here as a defense-in-depth re-check, not the primary enforcement point."
    );
  }

  const leadsWithHero = sectionOrder[0] === "hero";
  if (!leadsWithHero) {
    violations.push(
      "Wireframe does not lead with a hero section — a reader's eye needs an obvious first landing point (§2)."
    );
  }

  const contentWidthRem = wireframe.compositionVariant?.contentWidthRem ?? DEFAULT_CONTENT_WIDTH_REM;

  return { grid: DEFAULT_GRID_RHYTHM, matchesGenericTemplate, leadsWithHero, contentWidthRem, violations };
}

// ===========================================================================
// Motion refinement
// ===========================================================================

export interface SectionMotionValue extends MotionChoice {
  section: SectionType;
}

export interface MotionRefinement {
  intensity: "restrained" | "energetic";
  motions: SectionMotionValue[];
  violations: string[];
}

/** The footer carries no direction-specific content (design-generation-service.ts's own RATIONALE_BY_SECTION) — no motion needed, per §6's "never exist purely to seem alive." Exported so design-qa-service.ts can independently re-verify "every animated section has a motion entry, every non-animated one doesn't" rather than assuming refineMotion's own output. */
export const NO_MOTION_SECTIONS: SectionType[] = ["footer"];

const RESTRAINED_DURATION_MS = Math.round((MOTION_DURATION_BAND_MS.min + MOTION_DURATION_BAND_MS.max) / 2);
/** Outside the default band on purpose — only ever used with deliberateDeviation: true, the disclosed-deviation mechanism §6 requires. */
const ENERGETIC_DURATION_MS = MOTION_DURATION_BAND_MS.max + 50;

/**
 * refineMotion — assigns one motion per animated section: an entrance as it
 * scrolls into view, or (for the hero, always first) a load-time reveal.
 * `motionIntensity` comes from the Design Brief's own direction (Design
 * Intelligence's creative call, §6's "deliberate Design Brief decision, not
 * an unconstrained default") — this pass applies it, it doesn't decide it.
 */
export function refineMotion(wireframe: Wireframe, motionIntensity: "restrained" | "energetic"): MotionRefinement {
  const violations: string[] = [];
  const durationMs = motionIntensity === "energetic" ? ENERGETIC_DURATION_MS : RESTRAINED_DURATION_MS;
  const deliberateDeviation = motionIntensity === "energetic";

  const motions: SectionMotionValue[] = wireframe.sections
    .filter(({ type }) => !NO_MOTION_SECTIONS.includes(type))
    .map(({ type }) => {
      const purpose =
        type === "hero"
          ? "Initial content reveal on page load, confirming the page has finished loading — not decoration (§6)."
          : "Entrance as this section scrolls into view, confirming new content is now in focus — not decoration (§6).";

      const choice: SectionMotionValue = {
        section: type,
        durationMs,
        easing: "ease-out",
        purpose,
        deliberateDeviation,
      };
      violations.push(...validateMotionChoice(choice).map((e) => `[${type}] ${e}`));
      return choice;
    });

  return { intensity: motionIntensity, motions, violations };
}

// ===========================================================================
// Mobile refinement
// ===========================================================================

export interface MobileRefinement {
  touchTargets: TouchTarget[];
  bodyFontSizePx: number;
  bodyLineLengthChars: number;
  /**
   * True by construction: this data model represents a page as an ordered,
   * single-column list of sections (Wireframe.sections) with no mechanism to
   * express a multi-column section, so "collapses cleanly to a single
   * column" (§7) is structurally guaranteed rather than something this pass
   * has to compute. Named explicitly, not silently assumed, per §12's "must
   * be part of the QA pass's actual evidence, not assumed" standard — this
   * becomes a real, non-trivial check only once a rendering layer exists
   * that could actually deviate from this structure.
   */
  singleColumnVerified: boolean;
  violations: string[];
}

/** Sections with a primary interactive element a mobile user taps — everything else in this data model is read-only content. Exported for design-qa-service.ts's Conversion QA (§4.9) touch-target-uniqueness check. */
export const INTERACTIVE_SECTIONS: SectionType[] = ["hero", "contact", "faq", "schedule", "listings"];

export const TOUCH_TARGET_NAME_BY_SECTION: Partial<Record<SectionType, string>> = {
  hero: "hero-primary-cta",
  contact: "contact-primary-action",
  faq: "faq-accordion-toggle",
  schedule: "schedule-book-button",
  listings: "listing-view-button",
};

/** Comfortably above MIN_TOUCH_TARGET_PX/MIN_TOUCH_TARGET_SPACING_PX — a real value this pass could tighten later, not just the bare legal minimum. */
const DEFAULT_TOUCH_TARGET_PX = 48;
const DEFAULT_TOUCH_TARGET_SPACING_PX = 12;

/**
 * refineMobile — the mobile-scale re-check §7 requires: touch targets sized
 * for a finger, body type re-verified against the mobile floor, and line
 * length re-clamped into the mobile-scale band rather than naively scaled
 * down from the desktop value (§7's own explicit instruction). Takes the
 * Typography pass's output as input rather than recomputing type sizes
 * itself — mobile refinement adjusts Typography's values for a narrower
 * viewport, it doesn't own type sizing independently.
 */
export function refineMobile(wireframe: Wireframe, typography: TypographyRefinement): MobileRefinement {
  const violations: string[] = [];

  const touchTargets: TouchTarget[] = wireframe.sections
    .filter(({ type }) => INTERACTIVE_SECTIONS.includes(type))
    .map(({ type }) => {
      const target: TouchTarget = {
        name: TOUCH_TARGET_NAME_BY_SECTION[type] ?? `${type}-primary-action`,
        widthPx: DEFAULT_TOUCH_TARGET_PX,
        heightPx: DEFAULT_TOUCH_TARGET_PX,
        spacingPx: DEFAULT_TOUCH_TARGET_SPACING_PX,
      };
      violations.push(...validateTouchTarget(target));
      return target;
    });

  const bodyRoleSize = typography.scale.find((s) => s.role === "body")?.sizePx ?? BASE_BODY_SIZE_PX;
  const bodyFontSizePx = Math.max(bodyRoleSize, MOBILE_BODY_FONT_FLOOR_PX);
  const bodyLineLengthChars = Math.min(
    Math.max(typography.bodyLineLengthChars, MOBILE_READABILITY.bodyLineLengthCharsMin),
    MOBILE_READABILITY.bodyLineLengthCharsMax
  );
  violations.push(...validateMobileTypeChoice({ bodyFontSizePx, bodyLineLengthChars }));

  return { touchTargets, bodyFontSizePx, bodyLineLengthChars, singleColumnVerified: true, violations };
}

// ===========================================================================
// Composition — mirrors generateWebsiteStructure's role in
// design-generation-service.ts (Phase 2): one entry point composing every
// pass, called by that file's own orchestration.
// ===========================================================================

export interface RefinedDesign {
  typography: TypographyRefinement;
  spacing: SpacingRefinement;
  layout: LayoutRefinement;
  motion: MotionRefinement;
  mobile: MobileRefinement;
  /** Every violation collected across all five passes, flattened — normally empty. Lets a caller (runDesignGeneration, and eventually design-qa-service.ts) check "did refinement find anything" without inspecting five separate arrays. */
  violations: string[];
}

/** The refinement passes need only the generated wireframe, never component
 * implementation details or a prior refinement result. */
export interface RefinementInput {
  wireframe: Wireframe;
}

/**
 * refineDesign — Phase 3's one composed entry point: Phase 2's
 * WebsiteStructure plus the approved Design Brief and its Design Memory in,
 * a RefinedDesign of concrete typography/spacing/layout/motion/mobile
 * values out. Pure; no Supabase, no LLM call — design-generation-service.ts
 * calls this the same way it already calls generateWebsiteStructure.
 */
export function refineDesign(
  structure: RefinementInput,
  brief: Pick<DesignBrief, "direction">,
  designMemory?: DesignMemory | null
): RefinedDesign {
  const typography = refineTypography(designMemory);
  const spacing = refineSpacing(structure.wireframe);
  const layout = refineLayout(structure.wireframe);
  const motion = refineMotion(structure.wireframe, brief.direction.motionIntensity);
  const mobile = refineMobile(structure.wireframe, typography);

  return {
    typography,
    spacing,
    layout,
    motion,
    mobile,
    violations: [
      ...typography.violations,
      ...spacing.violations,
      ...layout.violations,
      ...motion.violations,
      ...mobile.violations,
    ],
  };
}
