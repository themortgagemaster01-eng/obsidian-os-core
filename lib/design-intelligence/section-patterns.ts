import type { LayoutFamily } from "@/lib/design-intelligence/layout-rules";

/**
 * The Generalized Premium Design Pattern Library (Friedman Flagship Final
 * Content Pass, Step 2). Friedman, Grimes, Meinken & Leischner PLLC is the
 * flagship REFERENCE implementation — its numbered practice-area index
 * (design-preview.tsx, "services" section), editorial testimonial pull-quote
 * ("testimonials"), and structured team rows ("team") are not one-off
 * Friedman code; they are the first real, evidence-driven implementations of
 * the pattern categories this module names. This module's job is to make
 * the underlying PRINCIPLE — "compose real evidence into a deliberate
 * editorial treatment appropriate to how much of it exists, never a generic
 * card grid, never padded when evidence is thin" — a reusable, generalized
 * capability instead of Friedman-specific code.
 *
 * Architecture: CRAWL -> EVIDENCE -> DESIGN INTELLIGENCE -> PATTERN
 * SELECTION -> COMPOSITION -> RENDERER -> QA. Design Intelligence (the LLM,
 * design-intelligence-service.ts) already reasons about industry, audience,
 * business character, and evidence density when it chooses layoutFamily,
 * signatureElement, and contentEmphasis — that reasoning is real and
 * expensive to duplicate. PATTERN SELECTION, this module, is deliberately
 * NOT a second LLM call: it's a small, deterministic, testable function
 * that translates Design Intelligence's already-made creative call plus
 * hard evidence facts (does real photography exist? how many testimonials?)
 * into a concrete per-section pattern id design-generation-service.ts's
 * assembleComponents() can act on and components/design-preview/design-
 * preview.tsx can render — the same "Generation is deterministic and rule-
 * based, never a second LLM layer" precedent this codebase already holds to
 * everywhere else (design-generation-service.ts's own header comment).
 *
 * Evidence-density awareness is built into each resolver, not bolted on
 * separately: a resolver that would pick an evidence-hungry pattern with no
 * evidence to back it instead falls back to the pattern that degrades
 * honestly — most content types generalize by construction already (a
 * numbered index with 1 real category and one with 5 both use the same
 * pattern id; only genuinely evidence-*gated* patterns, like an image-led
 * hero, need this module to decide between two DIFFERENT patterns).
 *
 * Deliberately scoped, not exhaustive: every section category names its
 * full intended pattern vocabulary (documented below) so Design
 * Intelligence/Generation have real room to grow into over time, but only
 * the patterns backed by a genuine, checkable evidence signal today
 * (currently: hero) have more than one real, distinct implementation.
 * Registering a category with a single canonical pattern is an honest
 * statement of "this is the one strong, evidence-adaptive treatment that
 * exists today," not a placeholder pretending to be a full library —
 * building several near-identical "variants" that don't actually compose
 * differently would be decoration for its own sake, exactly what docs/
 * DESIGN_INTELLIGENCE.md §2 warns against.
 */

// ===========================================================================
// Hero — the one category with a real, evidence-gated second pattern today.
// ===========================================================================

export const HERO_PATTERN_VOCABULARY = ["editorial-typographic", "image-full-bleed"] as const;
export type HeroPatternId = (typeof HERO_PATTERN_VOCABULARY)[number];

/**
 * image-full-bleed requires REAL photography the business itself publishes
 * (DesignBrief.gallery, crawl-adapter.ts's extractGallery) — never a
 * Lighthouse/Screenshot-adapter page capture (the exact Friedman Flagship
 * regression this pass's Step 1 fixed: a diagnostic UI screenshot is not
 * "real business photography" and must never be used as decorative hero
 * imagery). Falls back to editorial-typographic — Friedman's own real hero
 * treatment — whenever that evidence doesn't exist, regardless of what
 * layoutFamily Design Intelligence chose; imagery-led is a legitimate
 * REASON to prefer an image hero, never license to fabricate one.
 */
export function resolveHeroPattern(layoutFamily: LayoutFamily, hasRealImagery: boolean): HeroPatternId {
  if (hasRealImagery && (layoutFamily === "imagery-led" || layoutFamily === "listing-led")) {
    return "image-full-bleed";
  }
  return "editorial-typographic";
}

// ===========================================================================
// Full documented vocabulary, including single-canonical-pattern categories
// — real infrastructure for a future pass to extend, not a claim that every
// category already has multiple distinct implementations. Kept in one place
// so a future addition (e.g. a second, evidence-gated Services variant) has
// an obvious, single spot to register in.
// ===========================================================================

export const SECTION_PATTERN_REGISTRY = {
  hero: {
    vocabulary: HERO_PATTERN_VOCABULARY,
    implemented: HERO_PATTERN_VOCABULARY,
    note: "Two real, evidence-gated variants: editorial-typographic (no real photography — oversized serif headline, thin eyebrow label, restrained accent CTA, solid palette fill) and image-full-bleed (real business photography exists — the same headline composited over it with a scrim). Chosen by resolveHeroPattern above.",
  },
  services: {
    vocabulary: ["numbered-editorial-index"] as const,
    implemented: ["numbered-editorial-index"] as const,
    note: "One canonical pattern (generalized from Friedman's real practice-area index): a numbered list — muted accent numeral, bold category name, lighter real sub-item detail line, hairline dividers. Scales honestly from 1 real category to many by construction; no second variant exists today because a card grid or icon-feature-row alternative would be exactly the generic pattern docs/DESIGN_INTELLIGENCE.md §5/§11 names to avoid, not a genuine second composition.",
  },
  testimonials: {
    vocabulary: ["editorial-pull-quote"] as const,
    implemented: ["editorial-pull-quote"] as const,
    note: "One canonical pattern (Friedman's real treatment): one large quotation at a time with real attribution beneath a hairline rule, not a card carousel. Already evidence-density-adaptive — renders exactly as many real quotes as exist.",
  },
  team: {
    vocabulary: ["editorial-index", "portrait-grid"] as const,
    implemented: ["editorial-index"] as const,
    note: "editorial-index (Friedman's real treatment: 'Name — Title' divided rows) is the only implemented pattern today. portrait-grid (a real photo per person) is named in the vocabulary but deliberately NOT built this pass: crawl-adapter.ts's findTeamMembersByStructure captures a real name+title pair but does not yet associate a specific photo with a specific person — building that association without real per-person image evidence risks a genuinely worse failure than no photo (a mismatched face next to a real name), so it's left as a named, evidence-gated follow-up rather than shipped half-verified.",
  },
  faq: {
    vocabulary: ["editorial-accordion"] as const,
    implemented: ["editorial-accordion"] as const,
    note: "One canonical pattern (Friedman's real treatment): a plain divided-row accordion, real questions only, never a generic filler FAQ.",
  },
  contact: {
    vocabulary: ["large-closing-statement"] as const,
    implemented: ["large-closing-statement"] as const,
    note: "One canonical pattern (Friedman's real treatment): the verified phone number promoted to large, direct display type as the page's closing action.",
  },
  footer: {
    vocabulary: ["minimal-editorial"] as const,
    implemented: ["minimal-editorial"] as const,
    note: "One canonical pattern: a hairline rule, business name, phone, copyright — no decorative content.",
  },
  gallery: {
    vocabulary: ["real-photo-grid"] as const,
    implemented: ["real-photo-grid"] as const,
    note: "Real photos only (DesignBrief.gallery) — a simple grid of the business's own real images with real alt text when captured. Section is honestly omitted when no real photography exists, never filled with stock imagery.",
  },
} as const;
