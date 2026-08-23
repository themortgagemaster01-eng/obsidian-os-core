import type { IndustryBucket } from "@/lib/design-references/reference-library";
import {
  PHOTO_DEPENDENT_HERO_PATTERNS,
  MIN_GALLERY_FOR_PHOTO_HERO_PREFERENCE,
  type HeroPatternId,
} from "@/lib/design-intelligence/section-patterns";
import { personalityPaddingBias, MIN_SERVICES_FOR_GRID_CARDS } from "@/lib/design-intelligence/composition-variants";
import {
  EXPERIENCE_MODE_VOCABULARY,
  MOTION_BUDGET_VOCABULARY,
  MOTION_BUDGET_RANK,
  type ExperienceMode,
  type MotionBudget,
  type ExperiencePlan,
} from "@/shared/design-intelligence/types";

/**
 * lib/design-intelligence/experience-planner.ts — Phase 6.1 ("Adaptive
 * Experience & Wow Factor"): the experience-planning layer. Deterministic,
 * rule-based, no LLM call — matching this codebase's established boundary
 * that Design Intelligence (design-intelligence-service.ts) is the ONLY
 * layer that talks to a model, and Generation is deterministic and
 * rule-based, never a second LLM layer. Mirrors composition-variants.ts's
 * own shape exactly: one deterministic resolution per mission, gated on real
 * evidence, never randomized, never keyed off business name/id.
 *
 * Explicit anti-drift boundary (the founder's Phase 6.1 instruction): this
 * module does NOT re-derive its own read of raw evidence independently of
 * what composition-variants.ts's resolveCompositionVariant already decided.
 * It takes that decision's own output — the already-resolved HeroPatternId —
 * as a required input and treats it as the anchor a chosen experience mode
 * can never contradict (a photo-dependent mode is only reachable when the
 * hero pattern already resolved to one of the three real-photography-gated
 * patterns; see PHOTO_DEPENDENT_HERO_PATTERNS, imported rather than
 * redefined here). The only genuinely new inputs this module reads are the
 * same real evidence *counts* generateWireframe already gathers for
 * resolveCompositionVariant (services, certifications, hasReviews,
 * galleryCount) plus one addition — hasRealTeam — used to narrow WHICH of
 * the modes compatible with that anchor this specific business's evidence
 * can honestly support, never to override the anchor itself.
 *
 * The planner is not a second design engine: it orchestrates real decisions
 * three earlier passes already made (industryBucket classification, the
 * resolved hero pattern, Design Intelligence's own disclosed
 * motionIntensity and brandPersonality/contentTone) into one coherent
 * experience decision, the same way composition-variants.ts orchestrates the
 * hero pattern into nav/CTA/spacing/services/credibility/footer choices
 * rather than re-deciding the hero pattern itself.
 *
 * Forward compatibility (founder's "FUTURE 3D EXPERIENCE CAPABILITY"
 * architectural guidance, not implemented here): no 3D/immersive technology
 * is installed or referenced in this module, and none should be. But the
 * evidence-gating PATTERN this file already establishes for
 * PHOTO_DEPENDENT_EXPERIENCE_MODES — a mode is only reachable when specific,
 * checkable real evidence backs it, never assumed from industryBucket alone
 * — is exactly the pattern a future "does this business's real evidence
 * justify an immersive/3D experience" gate should reuse, not reinvent: real
 * product/architectural/hospitality photography evidence, brand direction,
 * and this same already-resolved heroPattern would feed a future gate the
 * identical way they feed isModeEvidenceSupported below. That future gate is
 * out of scope for Phase 6.1 — flagged here only so a future implementer
 * extends this file's existing discipline rather than building a parallel,
 * inconsistent one.
 */

// ===========================================================================
// Experience mode resolution
// ===========================================================================

/**
 * Experience modes that inherently claim rich, real photography/interactive
 * media evidence — the exact same real-evidence promise
 * PHOTO_DEPENDENT_HERO_PATTERNS already makes for the hero, extended to the
 * experience-mode vocabulary. Gated on the SAME hero-pattern anchor (never a
 * second, independent photography check) so a mode this business's real
 * evidence can't back is structurally unreachable, not just discouraged.
 */
const PHOTO_DEPENDENT_EXPERIENCE_MODES = new Set<ExperienceMode>([
  "cinematic-storytelling",
  "product-showcase",
  "interactive-showcase",
]);

/**
 * Business-type -> ranked experience-mode preference, mirroring section-
 * patterns.ts's own INDUSTRY_HERO_PREFERENCE table shape and rationale
 * style. Order is ranked preference, highest first — resolveExperienceMode
 * below walks this list and takes the first candidate real evidence (and
 * the already-resolved hero pattern) can actually support. A starting
 * vocabulary (Phase 6 directive), not a fixed category -> mode mapping: two
 * businesses in the same bucket with different real evidence can still land
 * on different entries in — or fall through — this same list.
 */
const INDUSTRY_EXPERIENCE_PREFERENCE: Record<IndustryBucket, ExperienceMode[]> = {
  // Real food photography supports an immersive, image-led story; falls back to a warmer, human-scaled register, then plain editorial when no photography exists.
  restaurant: ["cinematic-storytelling", "warm-local-business", "editorial-storytelling"],
  // Credibility/team evidence supports an authority register; editorial is the safe evidence-agnostic fallback — never retail/cinematic registers a law firm's real evidence doesn't support.
  lawFirm: ["trust-authority", "editorial-storytelling"],
  // Real offering/product evidence supports a conversion-forward, energetic register; falls back to authority when the credibility evidence is what's actually strong instead.
  homeService: ["high-energy-retail", "product-showcase", "trust-authority"],
  // Trust/credential evidence is the primary signal for medical/dental; premium-minimal is the restrained fallback when it isn't present.
  dentistMedical: ["trust-authority", "premium-minimal"],
  // Individual-listing/imagery-driven category; product-showcase and cinematic-storytelling both require the same real photography the hero pattern already gates on.
  realEstate: ["product-showcase", "cinematic-storytelling", "editorial-storytelling"],
  // Higher energy tolerance per docs/DESIGN_INTELLIGENCE.md; interactive-showcase reserved for a business with both rich photography AND a real, sizeable offering list.
  fitness: ["high-energy-retail", "interactive-showcase"],
  // CTO's own "Professional Services -> Luxury Minimal" register; restraint itself is the signal, same discipline oversized-typographic already applies to the hero.
  luxuryServices: ["premium-minimal", "editorial-storytelling"],
  // Safe, evidence-agnostic default — always reachable regardless of evidence.
  general: ["editorial-storytelling", "warm-local-business"],
};

/**
 * True when this mode's real evidence bar is cleared. editorial-storytelling,
 * warm-local-business, and premium-minimal are always reachable — the three
 * modes an evidence-thin business can honestly land on, mirroring section-
 * patterns.ts's own "three patterns evidence-thin businesses can always
 * honestly reach" discipline for the hero. Every other mode requires a real,
 * checkable signal, never picked on industryBucket alone.
 */
function isModeEvidenceSupported(mode: ExperienceMode, evidence: ExperiencePlanEvidenceDensity): boolean {
  switch (mode) {
    case "cinematic-storytelling":
    case "product-showcase":
      return evidence.galleryCount >= MIN_GALLERY_FOR_PHOTO_HERO_PREFERENCE;
    case "interactive-showcase":
      return (
        evidence.galleryCount >= MIN_GALLERY_FOR_PHOTO_HERO_PREFERENCE &&
        evidence.services >= MIN_SERVICES_FOR_GRID_CARDS
      );
    case "trust-authority":
      return evidence.hasRealTeam || evidence.certifications > 0 || evidence.hasReviews;
    case "high-energy-retail":
      return evidence.services >= MIN_SERVICES_FOR_GRID_CARDS;
    case "warm-local-business":
    case "editorial-storytelling":
    case "premium-minimal":
      return true;
  }
}

/** Real evidence-density counts this module reads — the same counts generateWireframe already gathers for resolveCompositionVariant (services, certifications, hasReviews, galleryCount), plus hasRealTeam (already computed as GenerateWireframeOptions.hasRealTeam upstream, not re-derived here). */
export interface ExperiencePlanEvidenceDensity {
  services: number;
  certifications: number;
  hasReviews: boolean;
  galleryCount: number;
  hasRealTeam: boolean;
}

/**
 * resolveExperienceMode — walks this business's industryBucket preference
 * list, filtering out any photo-dependent mode the already-resolved hero
 * pattern doesn't back (the anti-drift anchor) and any mode this business's
 * real evidence doesn't support, returning the first candidate that clears
 * both. Falls back to "editorial-storytelling" — the same universal,
 * evidence-agnostic role resolveHeroPattern's own "editorial-typographic"
 * fallback plays — for a bucket with no matching table entry or a business
 * whose evidence supports nothing else in its own ranked list (both
 * unreachable in practice today, since every list ends in an
 * always-supported mode, but never left to throw).
 */
export function resolveExperienceMode(
  industryBucket: IndustryBucket,
  heroPattern: HeroPatternId,
  evidence: ExperiencePlanEvidenceDensity
): ExperienceMode {
  const preferences = INDUSTRY_EXPERIENCE_PREFERENCE[industryBucket] ?? INDUSTRY_EXPERIENCE_PREFERENCE.general;
  const heroIsPhotoBacked = PHOTO_DEPENDENT_HERO_PATTERNS.has(heroPattern);

  for (const candidate of preferences) {
    if (PHOTO_DEPENDENT_EXPERIENCE_MODES.has(candidate) && !heroIsPhotoBacked) continue;
    if (!isModeEvidenceSupported(candidate, evidence)) continue;
    return candidate;
  }
  return "editorial-storytelling";
}

// ===========================================================================
// Motion budget resolution
// ===========================================================================

/**
 * Per-mode ceiling — no mode may exceed this regardless of how rich the
 * evidence is or how "energetic" Design Intelligence's disclosed
 * motionIntensity is (the founder's "no mode should require animation
 * simply for decoration" instruction, made structural rather than aspirational).
 * trust-authority and premium-minimal cap at "subtle": restraint IS the
 * register for both (an authority-led law firm, a luxury-minimal business),
 * never unlocked into a busier experience just because evidence happens to
 * be rich. Every other mode's ceiling is proportional to how much motion its
 * own register can plausibly use.
 */
const MOTION_BUDGET_CEILING_BY_MODE: Record<ExperienceMode, MotionBudget> = {
  "cinematic-storytelling": "cinematic",
  "editorial-storytelling": "enhanced",
  "premium-minimal": "subtle",
  "product-showcase": "enhanced",
  "high-energy-retail": "cinematic",
  "trust-authority": "subtle",
  "warm-local-business": "enhanced",
  "interactive-showcase": "cinematic",
};

/**
 * Design Intelligence's own disclosed motionIntensity call (DesignBrief.
 * direction.motionIntensity) acts as an outer ceiling this pass narrows,
 * never widens — an "energetic" disclosure permits reaching this mission's
 * full evidence/mode-supported budget; a "restrained" disclosure caps it at
 * "subtle" regardless of how rich the evidence or how energetic the mode's
 * own ceiling is (§6's "deliberate Design Brief decision, not an
 * unconstrained default," applied to the budget the same way motion-
 * rules.ts already applies it to duration/easing).
 */
const MOTION_BUDGET_CEILING_BY_INTENSITY: Record<"restrained" | "energetic", MotionBudget> = {
  restrained: "subtle",
  energetic: "cinematic",
};

/**
 * How many independent real-evidence signals back an elevated motion
 * experience — real photography, real team content, real certifications,
 * real review data, a real, sizeable offering list. Never a single evidence
 * field deciding the whole ceiling; a business needs multiple independent
 * real signals to justify the top of the range, mirroring the same
 * "evidence density," not evidence presence alone, discipline
 * resolveCompositionVariant already applies to servicesPattern/
 * credibilityPattern.
 */
function evidenceMotionCeiling(evidence: ExperiencePlanEvidenceDensity): MotionBudget {
  const signals = [
    evidence.galleryCount >= MIN_GALLERY_FOR_PHOTO_HERO_PREFERENCE,
    evidence.hasRealTeam,
    evidence.certifications > 0,
    evidence.hasReviews,
    evidence.services >= MIN_SERVICES_FOR_GRID_CARDS,
  ].filter(Boolean).length;

  if (signals >= 3) return "cinematic";
  if (signals === 2) return "enhanced";
  if (signals === 1) return "subtle";
  return "none";
}

function motionBudgetByRank(rank: number): MotionBudget {
  const clamped = Math.max(0, Math.min(MOTION_BUDGET_VOCABULARY.length - 1, rank));
  return MOTION_BUDGET_VOCABULARY[clamped];
}

/**
 * resolveMotionBudget — the minimum of three independent ceilings (the
 * chosen mode's own register, how much real evidence backs an elevated
 * experience, and Design Intelligence's own disclosed motionIntensity),
 * then narrowed one further step when Design Memory's own real
 * brandPersonality/contentTone reads as deliberately restrained — reusing
 * composition-variants.ts's personalityPaddingBias rather than a second
 * keyword classifier (never redefined here; the exact same real per-
 * business signal is now genuinely load-bearing on two independent axes,
 * spacing rhythm and motion budget, rather than duplicated logic that could
 * drift apart). A "bold"-read personality never raises the budget past what
 * mode/evidence/intensity already allow — never license to add motion the
 * evidence itself doesn't support.
 */
export function resolveMotionBudget(
  mode: ExperienceMode,
  evidence: ExperiencePlanEvidenceDensity,
  motionIntensity: "restrained" | "energetic",
  brandPersonality?: string[],
  contentTone?: string
): MotionBudget {
  const modeCeiling = MOTION_BUDGET_CEILING_BY_MODE[mode];
  const evidenceCeiling = evidenceMotionCeiling(evidence);
  const intensityCeiling = MOTION_BUDGET_CEILING_BY_INTENSITY[motionIntensity];

  let rank = Math.min(
    MOTION_BUDGET_RANK[modeCeiling],
    MOTION_BUDGET_RANK[evidenceCeiling],
    MOTION_BUDGET_RANK[intensityCeiling]
  );

  const restrainedTone = personalityPaddingBias(brandPersonality, contentTone) > 0;
  if (restrainedTone) rank = Math.max(0, rank - 1);

  return motionBudgetByRank(rank);
}

// ===========================================================================
// Rationale
// ===========================================================================

function describeEvidence(evidence: ExperiencePlanEvidenceDensity): string {
  const parts: string[] = [];
  if (evidence.galleryCount > 0) {
    parts.push(`${evidence.galleryCount} real photo${evidence.galleryCount === 1 ? "" : "s"}`);
  }
  if (evidence.hasRealTeam) parts.push("real team/staff content");
  if (evidence.certifications > 0) {
    parts.push(`${evidence.certifications} real certification${evidence.certifications === 1 ? "" : "s"}`);
  }
  if (evidence.hasReviews) parts.push("real review data");
  if (evidence.services > 0) {
    parts.push(`${evidence.services} real service${evidence.services === 1 ? "" : "s"}/offering${evidence.services === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(", ") : "no evidence beyond the base crawl";
}

function buildRationale(
  mode: ExperienceMode,
  motionBudget: MotionBudget,
  industryBucket: IndustryBucket,
  heroPattern: HeroPatternId,
  evidence: ExperiencePlanEvidenceDensity,
  motionIntensity: "restrained" | "energetic"
): string {
  const evidenceSummary = describeEvidence(evidence);
  return (
    `"${industryBucket}" business resolved to the "${mode}" experience from its already-resolved "${heroPattern}" hero pattern and real evidence (${evidenceSummary}). ` +
    `Design Intelligence's disclosed motionIntensity is "${motionIntensity}". Motion budget set to "${motionBudget}" — the minimum of this mode's own register ceiling, how much real evidence backs an elevated experience, and the disclosed motion intensity, so motion never runs ahead of what this business's real evidence and category can honestly support.`
  );
}

// ===========================================================================
// Composition — the one entry point design-generation-service.ts calls.
// ===========================================================================

export interface ResolveExperiencePlanInput {
  industryBucket: IndustryBucket;
  /**
   * The same HeroPatternId generateWireframe already resolved via
   * resolveCompositionVariant (composition-variants.ts) — never re-derived
   * independently here. Required, not recomputed, so the experience plan
   * can never contradict the structural decision already made for this
   * mission (the founder's explicit Phase 6.1 anti-drift instruction).
   */
  heroPattern: HeroPatternId;
  evidence: ExperiencePlanEvidenceDensity;
  /** DesignBrief.direction.motionIntensity, passed through unchanged — Design Intelligence's own disclosed call, an outer ceiling this pass narrows, never widens. */
  motionIntensity: "restrained" | "energetic";
  /** DesignMemory.brandPersonality/contentTone, passed through unchanged — the same real per-business signal composition-variants.ts already uses for its own padding-bias nudge. */
  brandPersonality?: string[];
  contentTone?: string;
}

/**
 * resolveExperiencePlan — one deterministic experience decision per mission,
 * built from real evidence and the already-resolved composition/hero-
 * pattern decision, never a second independent read of raw evidence. Always
 * a real, renderable answer (never partial/undefined), matching
 * resolveCompositionVariant's own "always a real answer" contract.
 */
export function resolveExperiencePlan(input: ResolveExperiencePlanInput): ExperiencePlan {
  const mode = resolveExperienceMode(input.industryBucket, input.heroPattern, input.evidence);
  const motionBudget = resolveMotionBudget(
    mode,
    input.evidence,
    input.motionIntensity,
    input.brandPersonality,
    input.contentTone
  );
  const rationale = buildRationale(mode, motionBudget, input.industryBucket, input.heroPattern, input.evidence, input.motionIntensity);

  return { mode, motionBudget, rationale };
}

export { EXPERIENCE_MODE_VOCABULARY, MOTION_BUDGET_VOCABULARY };
