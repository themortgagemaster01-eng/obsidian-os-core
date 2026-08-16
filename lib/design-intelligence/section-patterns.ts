import type { IndustryBucket } from "@/lib/design-references/reference-library";

/**
 * The Generalized Premium Design Pattern Library (Friedman Flagship Final
 * Content Pass, Step 2, extended by the CTO's "Benchmark Follow-Up: Fix
 * Extraction + Eliminate Template Convergence" directive). Friedman, Grimes,
 * Meinken & Leischner PLLC is the flagship REFERENCE implementation — its
 * numbered practice-area index (design-preview.tsx, "services" section),
 * editorial testimonial pull-quote ("testimonials"), and structured team
 * rows ("team") are not one-off Friedman code; they are the first real,
 * evidence-driven implementations of the pattern categories this module
 * names. This module's job is to make the underlying PRINCIPLE — "compose
 * real evidence into a deliberate editorial treatment appropriate to how
 * much of it exists, never a generic card grid, never padded when evidence
 * is thin" — a reusable, generalized capability instead of Friedman-
 * specific code.
 *
 * Architecture: CRAWL -> EVIDENCE -> DESIGN INTELLIGENCE -> PATTERN
 * SELECTION -> COMPOSITION -> RENDERER -> QA. Design Intelligence (the LLM,
 * design-intelligence-service.ts) already reasons about industry, audience,
 * business character, and evidence density when it chooses layoutFamily,
 * signatureElement, and contentEmphasis — that reasoning is real and
 * expensive to duplicate. PATTERN SELECTION, this module, is deliberately
 * NOT a second LLM call: it's a small, deterministic, testable function
 * that translates a business-type visual strategy (below) plus hard
 * evidence facts (does real photography exist?) into a concrete per-section
 * pattern id design-generation-service.ts's assembleComponents() can act on
 * and components/design-preview/design-preview.tsx can render — the same
 * "Generation is deterministic and rule-based, never a second LLM layer"
 * precedent this codebase already holds to everywhere else (design-
 * generation-service.ts's own header comment).
 *
 * Evidence-density awareness is built into each resolver, not bolted on
 * separately: a resolver that would pick an evidence-hungry pattern with no
 * evidence to back it instead falls back to the pattern that degrades
 * honestly — most content types generalize by construction already (a
 * numbered index with 1 real category and one with 5 both use the same
 * pattern id; only genuinely evidence-*gated* patterns, like a photo-backed
 * hero, need this module to decide between DIFFERENT patterns).
 */

// ===========================================================================
// Hero — six real, structurally distinct compositions (CTO Benchmark
// Follow-Up directive §3/§8: "the underlying layout, composition,
// typography hierarchy, imagery treatment, and CTA structure need to
// vary," not just color). Each internal id below corresponds 1:1 to one of
// the CTO's six lettered patterns — kept as descriptive technical ids
// (what the composition IS) rather than the letters themselves, with the
// mapping documented here once so it's unambiguous everywhere else in the
// codebase:
//
//   editorial-typographic  = Pattern A, Editorial      — large type-first
//     composition, no photography, magazine/editorial feel. A left hairline
//     rule + eyebrow label carries hierarchy instead of imagery. Outline CTA.
//   centered-cinematic     = Pattern B, Cinematic      — full-bleed real
//     photography, dark scrim, centered display type, dramatic/storytelling
//     register. Outline CTA on the scrim.
//   split-media-text       = Pattern C, Local Story    — real photography
//     placed asymmetrically beside (not behind) the text in a two-column
//     grid — warmer, more human-scaled than a full-bleed dramatic treatment;
//     reads as "here's our place/team," not "look at this."  Outline CTA.
//   image-full-bleed       = Pattern D, Service/Product — real photography
//     fills the hero, text is LEFT-aligned (not centered) over it, and the
//     CTA is a solid FILLED button (not outline) — the more conversion-
//     forward, benefit-led treatment the CTO's description calls for.
//   oversized-typographic  = Pattern E, Luxury Minimal — the widest
//     container and the largest display type scale of any pattern, no
//     border/rule decoration at all, CTA rendered as a plain understated
//     text link rather than a boxed button — restraint itself is the
//     signal, per docs/DESIGN_INTELLIGENCE.md's luxury-services guidance.
//   offset-overlap         = Pattern F, Bold Commerce  — the prose block is
//     offset and given its own tinted background panel (visual energy/
//     "stronger cards" without literally being a card grid elsewhere on the
//     page), paired with a solid FILLED, larger CTA button — the most
//     conversion-urgent of the six.
//
// Never a random assignment (CTO §4): resolveHeroPattern below always
// starts from a per-industryBucket ranked preference list (the CTO's own
// "suggested starting logic" table) and only ever removes a candidate for a
// concrete evidence reason (no real photography for a photo-dependent
// pattern) — it never swaps in a pattern industryBucket didn't already rank
// for this business's category.
// ===========================================================================

export const HERO_PATTERN_VOCABULARY = [
  "editorial-typographic",
  "centered-cinematic",
  "split-media-text",
  "image-full-bleed",
  "oversized-typographic",
  "offset-overlap",
] as const;
export type HeroPatternId = (typeof HERO_PATTERN_VOCABULARY)[number];

/** centered-cinematic, split-media-text, and image-full-bleed (Cinematic, Local Story, Service/Product) all require REAL photography the business itself publishes (DesignBrief.gallery, crawl-adapter.ts's extractGallery) — never a Lighthouse/Screenshot-adapter page capture (the exact Friedman Flagship regression this pass's Step 1 fixed). editorial-typographic, oversized-typographic, and offset-overlap never depend on photography at all — the three patterns evidence-thin businesses can always honestly reach. */
const PHOTO_DEPENDENT_HERO_PATTERNS = new Set<HeroPatternId>(["centered-cinematic", "split-media-text", "image-full-bleed"]);

/**
 * Business-type -> visual strategy (CTO Benchmark Follow-Up directive §4),
 * translated onto lib/design-references/reference-library.ts's actual
 * IndustryBucket vocabulary and this module's pattern ids. Order is ranked
 * preference, highest first — resolveHeroPattern below walks this list and
 * takes the first candidate real evidence can actually support. Directly
 * follows the CTO's own suggested table where our bucket vocabulary has a
 * matching entry (lawFirm, restaurant); "homeService" is this codebase's
 * one bucket covering both the CTO's separately-named HVAC and Contractor
 * categories, so its preference list blends both (Service/Product first —
 * common to both — then Bold Commerce, then Cinematic). The CTO's
 * Barbershop/Auto Service/Retail examples have no corresponding
 * IndustryBucket in this codebase today (adding new buckets is a larger,
 * separate change touching WIREFRAME_TEMPLATE_BY_BUCKET and the reference
 * library — out of scope for this pass) and are intentionally not mapped.
 */
const INDUSTRY_HERO_PREFERENCE: Record<IndustryBucket, HeroPatternId[]> = {
  // CTO: "Restaurant -> Editorial/Local Story/Cinematic"
  restaurant: ["editorial-typographic", "split-media-text", "centered-cinematic"],
  // CTO: "Law Firm -> Editorial/Luxury Minimal"
  lawFirm: ["editorial-typographic", "oversized-typographic"],
  // CTO: "HVAC -> Service/Product/Bold Commerce" blended with "Contractor -> Cinematic/Service-Product"
  homeService: ["image-full-bleed", "offset-overlap", "centered-cinematic"],
  // No direct CTO example; closest named analogue is "Professional Services -> Luxury Minimal/Editorial" (trust/credibility-led, same register as dentistry)
  dentistMedical: ["oversized-typographic", "editorial-typographic"],
  // No direct CTO example; imagery-heavy, individual-listing-driven per docs/DESIGN_INTELLIGENCE.md's own industry table — closest to Local Story/Cinematic
  realEstate: ["split-media-text", "centered-cinematic"],
  // No direct CTO example; higher energy tolerance per docs/DESIGN_INTELLIGENCE.md -> Bold Commerce/Cinematic
  fitness: ["offset-overlap", "centered-cinematic"],
  // CTO's own "Professional Services -> Luxury Minimal/Editorial" is the direct fit
  luxuryServices: ["oversized-typographic", "editorial-typographic"],
  // Safe, evidence-agnostic default
  general: ["editorial-typographic", "image-full-bleed"],
};

/**
 * resolveHeroPattern — Pattern Selection's hero decision. Starts from
 * INDUSTRY_HERO_PREFERENCE[industryBucket] (falling back to "general" for
 * an unrecognized bucket, never throwing) and returns the first candidate
 * that doesn't require photography this business doesn't have. Every
 * preference list's last resort is reachable without photography (each
 * list is constructed so its final entries include at least one non-photo-
 * dependent pattern, and the function's own final fallback below is
 * editorial-typographic regardless), so this always returns a real,
 * renderable pattern — never partial/undefined.
 */
export function resolveHeroPattern(industryBucket: IndustryBucket, hasRealImagery: boolean): HeroPatternId {
  const preferences = INDUSTRY_HERO_PREFERENCE[industryBucket] ?? INDUSTRY_HERO_PREFERENCE.general;
  for (const candidate of preferences) {
    if (PHOTO_DEPENDENT_HERO_PATTERNS.has(candidate) && !hasRealImagery) continue;
    return candidate;
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
    note: "Six real, structurally distinct compositions mapped 1:1 to the CTO's Editorial/Cinematic/Local Story/Service-Product/Luxury Minimal/Bold Commerce patterns (see the module-level comment above for the exact mapping and what varies structurally in each). Selected by resolveHeroPattern's per-industryBucket preference table, gated on real photography for the three photo-dependent patterns.",
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
