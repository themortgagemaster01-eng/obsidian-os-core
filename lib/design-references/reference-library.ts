/**
 * The in-house reference set docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md §2
 * recommended for Sprint 4 v1: "a small, manually curated, industry-tagged
 * reference set (structured data checked into the repo... tens of entries,
 * not a licensed corpus) rather than committing to a third-party
 * design-reference platform." This module is deliberately NOT part of
 * lib/design-intelligence/ — the Design Intelligence Recommendation §2
 * decomposes the founder's original list into four asset kinds, and names
 * the reference library specifically as "the one item that's genuinely
 * infrastructure-shaped," distinct from the schema/rules Design Intelligence
 * owns. Keeping it a separate module keeps that ownership boundary real in
 * code, not just in the doc.
 *
 * The hard line, restated because it governs how this module may be used
 * (docs/SPRINT_4_DESIGN_REVIEW.md §8, §10, the single highest-priority risk
 * named in that document): a ReferenceDirection informs design-brief-
 * service.ts's *reasoning* — cited direction input — and must NEVER be the
 * source of the actual section order, copy structure, or component tree
 * that ships. design-generation-service.ts never reads this module at all;
 * only design-brief-service.ts does, and only to populate `direction` and
 * `referencesConsidered` on the Design Brief it produces.
 */
import type { LayoutFamily } from "@/lib/design-intelligence/layout-rules";

/**
 * The industry buckets docs/DESIGN_INTELLIGENCE.md §10 names, plus
 * "general" — the deliberately safe fallback used whenever a business's
 * industry can't be confidently classified, per the evidence-first
 * discipline (ADR-013) applied to direction-selection rather than claims:
 * guessing a specific wrong industry is worse than an honest general
 * default, the same reasoning that keeps an unmeasured report category
 * reading "Unavailable" instead of a plausible-looking guess.
 */
export type IndustryBucket =
  | "restaurant"
  | "lawFirm"
  | "dentistMedical"
  | "homeService"
  | "realEstate"
  | "fitness"
  | "luxuryServices"
  | "general";

export interface ReferenceDirection {
  id: string;
  industryBucket: IndustryBucket;
  /** Exactly one entry per bucket is primary — resolveDesignDirection()'s deterministic default pick when several entries exist for a bucket. */
  primary: boolean;
  layoutFamily: LayoutFamily;
  typographicMood: string;
  colorDirection: string;
  /** What this direction leads with, per §10's "what shifts" column — feeds design-brief-service.ts's positioning statement. */
  positioningEmphasis: string;
  /** What makes this direction premium/appropriate for the bucket — the citable reasoning, never a structure to copy (§8). */
  description: string;
}

/**
 * A starting seed, not a finished corpus: two directions per bucket (one
 * primary, one alternative), covering every §10 bucket plus "general."
 * "Tens of entries" per the Architecture Recommendation is a range this set
 * grows into as real missions run and specific gaps show up — not a target
 * to hit on day one, per the same evidence-triggered-growth discipline
 * ADR-006 used for the event bus.
 */
export const REFERENCE_LIBRARY: ReferenceDirection[] = [
  // --- Restaurant ---------------------------------------------------------
  {
    id: "restaurant-imagery-atmosphere",
    industryBucket: "restaurant",
    primary: true,
    layoutFamily: "imagery-led",
    typographicMood: "a warm serif display paired with a clean sans body",
    colorDirection: "warm, natural tones grounded in real photography rather than a flat brand palette",
    positioningEmphasis: "imagery and atmosphere, with menu, hours, and reservation clarity treated as functionally critical",
    description: "A photography-forward, warm, locally-rooted direction for dining businesses (§10).",
  },
  {
    id: "restaurant-menu-forward",
    industryBucket: "restaurant",
    primary: false,
    layoutFamily: "menu-led",
    typographicMood: "a single confident serif used across weights",
    colorDirection: "a restrained neutral palette that lets food photography carry the color",
    positioningEmphasis: "a scannable, menu-first structure for a business whose core visitor decision is what's on the menu tonight",
    description: "A menu-first alternative direction for casual/fast-casual dining.",
  },

  // --- Law Firm ------------------------------------------------------------
  {
    id: "lawfirm-credibility-led",
    industryBucket: "lawFirm",
    primary: true,
    layoutFamily: "credibility-led",
    typographicMood: "a measured serif or high-contrast sans conveying authority",
    colorDirection: "deep, calm neutral tones — no bright or urgent color",
    positioningEmphasis: "credibility and outcomes, in a measured, authoritative, non-urgent tone",
    description: "A credibility-first direction for practices where trust and outcomes lead (§10).",
  },
  {
    id: "lawfirm-outcomes-forward",
    industryBucket: "lawFirm",
    primary: false,
    layoutFamily: "credibility-led",
    typographicMood: "a clean, high-legibility sans throughout",
    colorDirection: "navy and charcoal neutrals",
    positioningEmphasis: "clear, scannable practice-area and case-outcome structure",
    description: "An outcomes-forward alternative emphasizing scannable case results.",
  },

  // --- Dentist / Medical -----------------------------------------------------
  {
    id: "medical-trust-clean",
    industryBucket: "dentistMedical",
    primary: true,
    layoutFamily: "credibility-led",
    typographicMood: "a clean, approachable sans with generous spacing",
    colorDirection: "clinical-clean whites and soft, calming secondary tones",
    positioningEmphasis: "trust and cleanliness read visually, alongside patient comfort and approachability",
    description: "A clean, trust-forward direction for patient-facing healthcare (§10).",
  },
  {
    id: "medical-approachable-warm",
    industryBucket: "dentistMedical",
    primary: false,
    layoutFamily: "credibility-led",
    typographicMood: "a rounded, friendly sans",
    colorDirection: "soft, warm neutral accents that reduce clinical coldness",
    positioningEmphasis: "patient comfort leading alongside credibility, for a less clinical, more approachable register",
    description: "A warmer alternative for family/pediatric-style practices.",
  },

  // --- HVAC / Landscaping / home-service trades ------------------------------
  {
    id: "homeservice-urgency-reliability",
    industryBucket: "homeService",
    primary: true,
    layoutFamily: "credibility-led",
    typographicMood: "a bold, high-legibility sans built for a fast decision",
    colorDirection: "a high-contrast, trustworthy primary color reinforcing reliability, used deliberately, not decoratively",
    positioningEmphasis: "urgency and reliability, with pricing transparency and service-area clarity treated as expected, not optional",
    description: "An urgency/reliability-first direction for emergency and scheduled home-service trades (§10).",
  },
  {
    id: "homeservice-local-trusted",
    industryBucket: "homeService",
    primary: false,
    layoutFamily: "credibility-led",
    typographicMood: "a straightforward, plain-spoken sans",
    colorDirection: "a single confident accent color used consistently for calls to action",
    positioningEmphasis: "local, trusted-neighbor framing over corporate polish",
    description: "A local-trust alternative for owner-operator trades businesses.",
  },

  // --- Real Estate -----------------------------------------------------------
  {
    id: "realestate-imagery-listings",
    industryBucket: "realEstate",
    primary: true,
    layoutFamily: "listing-led",
    typographicMood: "a refined sans with confident display sizing for property imagery",
    colorDirection: "a neutral, gallery-like palette that lets listing photography lead",
    positioningEmphasis: "imagery-heavy, individual-agent and listing presentation, with local-market credibility signals",
    description: "An imagery-led direction for individual-agent/listing-driven real estate (§10).",
  },
  {
    id: "realestate-agent-credibility",
    industryBucket: "realEstate",
    primary: false,
    layoutFamily: "credibility-led",
    typographicMood: "a confident serif for the agent's personal brand",
    colorDirection: "warm neutrals reinforcing an individual, trusted-advisor feel",
    positioningEmphasis: "trust in the individual agent as much as the brokerage brand",
    description: "An agent-credibility-forward alternative.",
  },

  // --- Fitness -----------------------------------------------------------
  {
    id: "fitness-energy-schedule",
    industryBucket: "fitness",
    primary: true,
    layoutFamily: "schedule-led",
    typographicMood: "a bold, high-energy sans with strong weight contrast",
    colorDirection: "a bolder, higher-energy accent than this document's general restraint default — a deliberate, disclosed deviation (§6, §10)",
    positioningEmphasis: "energy and motion tolerance higher than the general restraint default, with a clear class-schedule/trial path functionally critical",
    description: "An energetic direction for studios where energy is itself the sell (§10).",
  },
  {
    id: "fitness-community-forward",
    industryBucket: "fitness",
    primary: false,
    layoutFamily: "schedule-led",
    typographicMood: "a friendly, rounded sans",
    colorDirection: "warm, community-oriented accent tones",
    positioningEmphasis: "community and belonging leading over pure intensity",
    description: "A community-forward alternative for group-fitness/wellness studios.",
  },

  // --- Luxury Services -----------------------------------------------------
  {
    id: "luxury-restraint",
    industryBucket: "luxuryServices",
    primary: true,
    layoutFamily: "editorial",
    typographicMood: "a single refined serif or high-end sans, used with extreme restraint",
    colorDirection: "a near-monochrome, minimal palette — understatement is the signal",
    positioningEmphasis: "the strictest application of restraint — understatement over visible effort, consultation-framed rather than listed pricing",
    description: "The most restrained direction in the library, for businesses where understatement itself communicates luxury (§10).",
  },
  {
    id: "luxury-editorial-minimal",
    industryBucket: "luxuryServices",
    primary: false,
    layoutFamily: "editorial",
    typographicMood: "generous whitespace with a single quiet display face",
    colorDirection: "monochrome with one muted accent",
    positioningEmphasis: "typography and whitespace discipline carrying nearly all of the premium signal",
    description: "An editorial-minimal alternative for high-end consultation-based services.",
  },

  // --- General (safe default) ----------------------------------------------
  {
    id: "general-editorial-default",
    industryBucket: "general",
    primary: true,
    layoutFamily: "editorial",
    typographicMood: "a single well-chosen sans across weights, per §3's single-family option",
    colorDirection: "a restrained neutral palette with one deliberate accent color",
    positioningEmphasis: "real hierarchy and editorial composition, since no more specific industry direction is confidently known",
    description:
      "The safe, restrained default used when a business's industry can't be confidently classified — deliberately generic-safe, never a guessed specific industry (evidence-first discipline applied to direction, not just claims).",
  },
  {
    id: "general-storytelling-forward",
    industryBucket: "general",
    primary: false,
    layoutFamily: "editorial",
    typographicMood: "a confident sans paired with a single serif accent for headings",
    colorDirection: "a neutral base with one accent tied to whatever brand color the business already uses, if known",
    positioningEmphasis: "business storytelling over a feature-dump, still without guessing an unconfirmed industry",
    description: "A storytelling-forward alternative default.",
  },
];

/**
 * Keyword lists used to classify a company's freeform `industry`/
 * `business_category` text (companies.industry is a nullable, unconstrained
 * text column — see supabase/migrations/0006_memory_vault.sql) into one of
 * the known buckets. Checked in this fixed order; the first bucket with a
 * matching keyword wins. This is a deliberately simple heuristic, not a
 * classifier — per the evidence-first principle, an unmatched or unknown
 * industry falls through to "general" rather than guessing.
 */
const BUCKET_KEYWORDS: { bucket: IndustryBucket; keywords: string[] }[] = [
  { bucket: "restaurant", keywords: ["restaurant", "cafe", "café", "diner", "bakery", "catering", "bistro", "eatery"] },
  { bucket: "lawFirm", keywords: ["law firm", "attorney", "legal", "lawyer", "law office"] },
  { bucket: "dentistMedical", keywords: ["dental", "dentist", "medical", "clinic", "healthcare", "physician", "doctor", "orthodont"] },
  { bucket: "homeService", keywords: ["hvac", "plumbing", "landscap", "roofing", "electrician", "contractor", "home service", "lawn care", "pest control"] },
  { bucket: "realEstate", keywords: ["real estate", "realtor", "realty", "property management"] },
  { bucket: "fitness", keywords: ["fitness", "gym", "yoga", "pilates", "crossfit", "personal training"] },
  { bucket: "luxuryServices", keywords: ["luxury", "concierge", "private jet", "yacht", "couture", "bespoke"] },
];

/**
 * Real, food/drink-shaped menu-category labels (crawl-adapter.ts's
 * findMenuItemsByStructure groups real items under a real label the source
 * page itself published, e.g. "FOOD"/"DRINK"/"Appetizers"/"Cocktails" —
 * MENU_FALLBACK_CATEGORY_NAME "Menu" when none was found). Deliberately
 * separate from BUCKET_KEYWORDS: this list is only ever checked against
 * those real category labels, never arbitrary page text, so it can afford
 * to be broader/more generic ("food", "drink") than BUCKET_KEYWORDS' own
 * restaurant terms without false-positiving on unrelated body copy. A
 * fitness studio's real class-pass categories ("Drop-In", "10-Class Pack")
 * or a spa's ("Massage", "Facial") never match this list — this is a signal
 * about what KIND of real price list was found, not just that one exists.
 */
const RESTAURANT_MENU_CATEGORY_KEYWORDS = [
  "food",
  "drink",
  "menu",
  "appetizer",
  "starter",
  "entree",
  "entrée",
  "main course",
  "dessert",
  "beverage",
  "cocktail",
  "wine",
  "beer",
  "brunch",
  "lunch",
  "dinner",
  "small plate",
];

/**
 * Classifies a company's industry/category text into a known bucket, or
 * "general" when neither field matches — the safe default, never a guessed
 * specific industry (see REFERENCE_LIBRARY's general-editorial-default
 * entry for why that matters).
 *
 * `menuCategoryNames` is an optional structural-evidence fallback (Phase
 * 4.9 fix): `companies.industry`/`business_category` are nullable,
 * unconstrained text columns nothing guarantees gets populated (confirmed
 * empty for a real business, janebond.ca, during Phase 4.8 validation) —
 * when both are empty/unmatched, a REAL structurally-detected menu whose
 * own real category labels are food/drink-shaped (checked against
 * RESTAURANT_MENU_CATEGORY_KEYWORDS above) is stronger, more specific
 * mechanical evidence of a restaurant/food-service business than an absent
 * or generic industry field — never a guess, since the labels themselves
 * were real text the business published next to real prices. Generalizes to
 * any business the crawler found a real menu for, not just one by name.
 */
export function resolveIndustryBucket(
  industry: string | null,
  businessCategory: string | null,
  menuCategoryNames: string[] = []
): IndustryBucket {
  const haystacks = [industry, businessCategory]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .map((v) => v.toLowerCase());

  for (const { bucket, keywords } of BUCKET_KEYWORDS) {
    if (haystacks.some((text) => keywords.some((keyword) => text.includes(keyword)))) {
      return bucket;
    }
  }

  const menuHaystacks = menuCategoryNames.filter((n) => n.trim().length > 0).map((n) => n.toLowerCase());
  if (menuHaystacks.some((name) => RESTAURANT_MENU_CATEGORY_KEYWORDS.some((keyword) => name.includes(keyword)))) {
    return "restaurant";
  }

  return "general";
}

/** Every reference direction tagged to a bucket, primary entry first. */
export function selectReferenceDirections(bucket: IndustryBucket): ReferenceDirection[] {
  return REFERENCE_LIBRARY.filter((r) => r.industryBucket === bucket).sort(
    (a, b) => Number(b.primary) - Number(a.primary)
  );
}

/** The single default direction design-brief-service.ts uses for a bucket — the first primary entry, or the first entry if none is flagged primary (shouldn't happen for a complete library, guarded in tests). */
export function selectPrimaryReferenceDirection(bucket: IndustryBucket): ReferenceDirection | undefined {
  const directions = selectReferenceDirections(bucket);
  return directions.find((r) => r.primary) ?? directions[0];
}
