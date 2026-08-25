import type { SectionType } from "@/lib/services/design-generation-service";
import type { ExperienceMode, ExperiencePlan } from "@/shared/design-intelligence/types";
import type { ExperiencePlanEvidenceDensity } from "@/lib/design-intelligence/experience-planner";
import { MIN_GALLERY_FOR_PHOTO_HERO_PREFERENCE } from "@/lib/design-intelligence/section-patterns";
import { MIN_SERVICES_FOR_GRID_CARDS } from "@/lib/design-intelligence/composition-variants";

/**
 * lib/design-intelligence/narrative-arc-planner.ts — Phase 6.7 (approved
 * narrow scope, docs/PHASE_6.7_NARRATIVE_ARC_AUDIT.md): a standalone,
 * deterministic resolver, peer to experience-planner.ts and composition-
 * variants.ts. Mirrors their own shape exactly: one real decision per
 * mission, no LLM call, no randomness, gated on real evidence, never keyed
 * off business name/id.
 *
 * This module is the first mechanical, testable expression of a design
 * principle this codebase has named since early on but never enforced in
 * code: lib/design-intelligence/design-rules.ts's own
 * "storytelling-not-feature-dump" principle ("the site's structure should
 * follow the narrative order that makes sense for this specific business's
 * value proposition, not a fixed section checklist") — that file's own doc
 * comment states plainly that DESIGN_PRINCIPLES is "data, not a
 * mechanically-enforceable rule set." This module does not change that file
 * (out of this phase's scope) — it is simply the first code path that could
 * eventually make that principle real.
 *
 * INERT BY DESIGN (per Robert's explicit Phase 6.7 scope, mirroring how
 * experience-planner.ts itself shipped inert at its own Phase 6.1
 * checkpoint before Phase 6.2 later wired it into refineMotion): nothing in
 * generateWebsiteStructure, capability-selector.ts, either existing
 * Capability Adapter, or the renderer calls this module. Whether/how it
 * eventually gets a real consumer is an explicitly separate, future
 * decision — proving the planning intelligence and proving a consumer are
 * two different phases, never bundled.
 *
 * Anti-drift boundary: this module does NOT reorder sections (that job is
 * already solved, evidence-gated, and tested by design-generation-
 * service.ts's applyContentEmphasis) and does NOT re-derive ExperiencePlan
 * (mode, motionBudget) or evidence — it consumes exactly three
 * already-resolved values (ExperiencePlan, the rendered section sequence,
 * the same ExperiencePlanEvidenceDensity struct experience-planner.ts
 * itself consumes) and produces one new, additive decision: which narrative
 * STAGE each already-placed section plays.
 *
 * Output boundary (Robert's own locked shape): intent and progression only
 * — establish/reveal/demonstrate/validate/deepen/convert — never a
 * duration, an easing curve, a pin/scrub instruction, or a vendor name. A
 * future GSAP-class Capability Adapter is the kind of thing that would read
 * this output; this module must never know that GSAP, or any other
 * execution technology, exists.
 */

// ===========================================================================
// Vocabularies
// ===========================================================================

/**
 * Six arc tokens for eight experience modes — not eight-for-eight.
 * editorial-storytelling/warm-local-business share a register (reading
 * rhythm, content-led pacing) the same way product-showcase/interactive-
 * showcase already share one under PHOTO_DEPENDENT_EXPERIENCE_MODES
 * (experience-planner.ts) — collapsing genuinely-identical registers avoids
 * the "dozens of bespoke arc names" failure mode the founder's Phase 6.7
 * directive explicitly warns against.
 */
export const NARRATIVE_ARC_TOKEN_VOCABULARY = [
  "authority",
  "minimal-direct",
  "sensory",
  "editorial",
  "discovery",
  "conversion",
] as const;
export type NarrativeArcToken = (typeof NARRATIVE_ARC_TOKEN_VOCABULARY)[number];

/**
 * Six stage tokens, taken verbatim from the founder's own "acceptable
 * concepts" list. hero always resolves to "establish" and contact/footer
 * always resolve to "convert" — universal, arc-independent anchors (both
 * are structurally fixed positions design-generation-service.ts's own
 * applyContentEmphasis already never moves). The remaining four are
 * assigned to middle sections by the fixed tables below.
 */
export const NARRATIVE_STAGE_TOKEN_VOCABULARY = [
  "establish",
  "reveal",
  "demonstrate",
  "validate",
  "deepen",
  "convert",
] as const;
export type NarrativeStageToken = (typeof NARRATIVE_STAGE_TOKEN_VOCABULARY)[number];

export type NarrativeArcConfidence = "High" | "Medium" | "Low";

export interface NarrativeSectionStage {
  section: SectionType;
  stage: NarrativeStageToken;
}

export interface NarrativeArcPlan {
  arcToken: NarrativeArcToken;
  /** One entry per section actually present in the input `sections` list, in the SAME order — never padded with a stage for a section that doesn't exist, never reordered. */
  stageBySection: NarrativeSectionStage[];
  /** Discrete tier, mirrors CapabilityDecision's own supportLevel discipline — explanatory only, never a second gate. */
  confidence: NarrativeArcConfidence;
  /** Plain-English, cites the real resolved mode, the real evidence-signal count, and — honestly, mirroring experience-planner.ts's own describeHumanPreferenceOutcome — whether a richer register was requested by the mode but withheld by evidence. */
  rationale: string;
}

export interface ResolveNarrativeArcInput {
  /** The already-resolved plan (mode, motionBudget) — never re-derived here. Only `mode` drives this module; `motionBudget` is not read (arc richness is gated on evidence signals directly, not on the motion-budget ceiling, which answers a related but different question). */
  experiencePlan: ExperiencePlan;
  /**
   * The RENDERED section sequence — the same list design-preview.tsx
   * actually iterates: post applyContentEmphasis reordering AND post
   * OMIT_SECTION_IF_EMPTY filtering. Passing the raw, pre-filter
   * wireframe.sections would risk describing a stage for a section that
   * never actually renders — the exact failure mode
   * docs/PHASE_6.7_NARRATIVE_ARC_AUDIT.md's own Q9 flagged concretely. This
   * module never reorders or filters this list itself; it only reads it.
   */
  sections: SectionType[];
  /** The same evidence-density struct experience-planner.ts's own resolveExperiencePlan already consumes — never a new evidence signal, never re-derived from raw crawl data. */
  evidence: ExperiencePlanEvidenceDensity;
}

// ===========================================================================
// Mode -> candidate arc (fixed table, not a ranked list — by the time this
// module runs, mode is already decided; the only remaining question is
// whether real evidence can honestly support that mode's natural register).
// ===========================================================================

const ARC_BY_MODE: Record<ExperienceMode, NarrativeArcToken> = {
  "trust-authority": "authority",
  "premium-minimal": "minimal-direct",
  "cinematic-storytelling": "sensory",
  "editorial-storytelling": "editorial",
  "warm-local-business": "editorial",
  "product-showcase": "discovery",
  "interactive-showcase": "discovery",
  "high-energy-retail": "conversion",
};

/** The three arcs that expect at least a few genuinely differentiated middle-section stages to mean anything — gated below on real evidence signals, never granted merely because the mode would prefer them. */
const RICH_ARCS = new Set<NarrativeArcToken>(["sensory", "discovery", "conversion"]);

/**
 * How many of the same five real evidence signals experience-planner.ts's
 * own (private) evidenceMotionCeiling already counts — reused here as the
 * exported constants those signals are built from
 * (MIN_GALLERY_FOR_PHOTO_HERO_PREFERENCE, MIN_SERVICES_FOR_GRID_CARDS) —
 * are present. Deliberately the SAME signal-counting shape, not a new,
 * independently-invented richness metric: a business's real evidence
 * density is the one thing this whole pipeline already measures
 * consistently everywhere else (resolveExperienceMode, resolveMotionBudget,
 * the Capability Selector), so arc richness is gated the same way rather
 * than inventing a "how many distinct section TYPES exist" metric that
 * would drift from that established discipline.
 */
function evidenceSignalCount(evidence: ExperiencePlanEvidenceDensity): number {
  return [
    evidence.galleryCount >= MIN_GALLERY_FOR_PHOTO_HERO_PREFERENCE,
    evidence.hasRealTeam,
    evidence.certifications > 0,
    evidence.hasReviews,
    evidence.services >= MIN_SERVICES_FOR_GRID_CARDS,
  ].filter(Boolean).length;
}

/** A rich arc needs at least this many real evidence signals — the same "enhanced" tier bar experience-planner.ts's own evidenceMotionCeiling already uses for its own middle tier, reused rather than a fresh threshold invented for this module alone. */
const NARRATIVE_ARC_EVIDENCE_SIGNAL_FLOOR = 2;

/**
 * resolveArcToken — the deterministic gate. A rich-arc candidate
 * (sensory/discovery/conversion) that clears the evidence floor is granted
 * outright. One that doesn't degrades to "editorial" (some real content
 * exists, just not enough to differentiate a multi-beat progression) or
 * "minimal-direct" (nothing beyond the universal establish/convert anchors
 * — the honest floor, never a failed version of a richer arc). authority/
 * minimal-direct/editorial themselves are never gated here: trust-authority
 * and editorial-storytelling/warm-local-business already had their own real
 * evidence bar (or explicit evidence-agnostic reachability) enforced by
 * resolveExperienceMode before this module ever runs — re-gating them here
 * would be exactly the "recreate an existing decision" anti-pattern this
 * module's own doc comment warns against.
 *
 * Falls back to "minimal-direct" for a mode outside the closed union
 * (defensive — mirrors experience-planner.ts's own "unrecognized bucket
 * falls back rather than throwing" precedent; unreachable via any real,
 * TypeScript-checked caller since ARC_BY_MODE is exhaustive over
 * ExperienceMode).
 */
function resolveArcToken(mode: ExperienceMode, evidenceSignals: number): NarrativeArcToken {
  const candidate = ARC_BY_MODE[mode] ?? "minimal-direct";
  if (!RICH_ARCS.has(candidate)) return candidate;
  if (evidenceSignals >= NARRATIVE_ARC_EVIDENCE_SIGNAL_FLOOR) return candidate;
  return evidenceSignals >= 1 ? "editorial" : "minimal-direct";
}

// ===========================================================================
// Section -> stage (fixed tables; hero/contact/footer are handled as
// universal anchors, never looked up here).
// ===========================================================================

/** Base stage per middle SectionType — used by every arc unless STAGE_OVERRIDE_BY_ARC names a more specific one. Every real middle SectionType is covered; a section type this table doesn't recognize simply gets no stage (see stageForSection), never a fabricated one. */
const DEFAULT_STAGE_BY_SECTION: Partial<Record<SectionType, NarrativeStageToken>> = {
  services: "reveal",
  menu: "reveal",
  listings: "reveal",
  schedule: "reveal",
  serviceArea: "reveal",
  gallery: "reveal",
  credibility: "validate",
  team: "validate",
  testimonials: "validate",
  faq: "deepen",
};

/**
 * Per-arc overrides — deliberately small. Only "sensory" changes anything:
 * under a photography/atmosphere-led register, a gallery section carries
 * real persuasive weight ("demonstrate") rather than merely listing offered
 * items ("reveal"), the same distinction design-refinement-service.ts's own
 * refineMotionFromExperiencePlan already draws for "fade-scale" (reserved
 * for photography-backed sections specifically, never assumed).
 */
const STAGE_OVERRIDE_BY_ARC: Partial<Record<NarrativeArcToken, Partial<Record<SectionType, NarrativeStageToken>>>> = {
  sensory: { gallery: "demonstrate" },
};

function stageForSection(section: SectionType, arcToken: NarrativeArcToken): NarrativeStageToken | null {
  if (section === "hero") return "establish";
  if (section === "contact" || section === "footer") return "convert";
  const override = STAGE_OVERRIDE_BY_ARC[arcToken]?.[section];
  if (override) return override;
  return DEFAULT_STAGE_BY_SECTION[section] ?? null;
}

// ===========================================================================
// Confidence
// ===========================================================================

/**
 * "minimal-direct" is always High confidence — correctly identifying that a
 * business should get the honest, simple floor is itself the confident,
 * correct read; there is no "unconfident" version of that judgment the way
 * there could be for a richer, more differentiated arc. Every other arc's
 * confidence is a direct function of the same evidence-signal count the
 * gate above already computed — never a second, independent measurement.
 */
function resolveConfidence(arcToken: NarrativeArcToken, evidenceSignals: number): NarrativeArcConfidence {
  if (arcToken === "minimal-direct") return "High";
  if (evidenceSignals >= 3) return "High";
  if (evidenceSignals >= 1) return "Medium";
  return "Low";
}

// ===========================================================================
// Rationale
// ===========================================================================

function buildRationale(
  plan: ExperiencePlan,
  arcToken: NarrativeArcToken,
  modeArc: NarrativeArcToken,
  evidenceSignals: number,
  stageCount: number
): string {
  const base = `"${plan.mode}" experience mode resolves to the "${arcToken}" narrative arc`;
  if (arcToken === modeArc) {
    return `${base} — its own natural register. ${evidenceSignals} of 5 real evidence signals (real gallery/team/certification/review/service-count density) back this business's content richness; ${stageCount} real section(s) beyond the universal establish/convert anchors were assigned a stage.`;
  }
  return (
    `${base} — downgraded from "${modeArc}" (the "${plan.mode}" mode's own natural register) because only ` +
    `${evidenceSignals} of 5 real evidence signals exist, below the ${NARRATIVE_ARC_EVIDENCE_SIGNAL_FLOOR} needed to honestly differentiate a richer progression. ` +
    `A simpler, honest arc is not a failed version of the richer one — it is the correct choice for what this business's real evidence actually supports. ` +
    `${stageCount} real section(s) beyond the universal establish/convert anchors were assigned a stage.`
  );
}

// ===========================================================================
// Composition — the one entry point.
// ===========================================================================

/**
 * resolveNarrativeArc — always a real, complete plan (never partial/
 * undefined), matching resolveExperiencePlan/resolveCompositionVariant's own
 * "always a real answer" contract. `stageBySection` only ever contains
 * entries for sections genuinely present in `input.sections`, in that same
 * order — never invents, never reorders, never pads for a missing section.
 */
export function resolveNarrativeArc(input: ResolveNarrativeArcInput): NarrativeArcPlan {
  const modeArc = ARC_BY_MODE[input.experiencePlan.mode] ?? "minimal-direct";
  const evidenceSignals = evidenceSignalCount(input.evidence);
  const arcToken = resolveArcToken(input.experiencePlan.mode, evidenceSignals);

  const stageBySection: NarrativeSectionStage[] = [];
  for (const section of input.sections) {
    const stage = stageForSection(section, arcToken);
    if (stage) stageBySection.push({ section, stage });
  }

  return {
    arcToken,
    stageBySection,
    confidence: resolveConfidence(arcToken, evidenceSignals),
    rationale: buildRationale(input.experiencePlan, arcToken, modeArc, evidenceSignals, stageBySection.length),
  };
}
