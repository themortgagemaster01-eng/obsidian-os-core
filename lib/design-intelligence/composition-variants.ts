import type { IndustryBucket } from "@/lib/design-references/reference-library";
import { resolveHeroPattern, type HeroPatternId } from "@/lib/design-intelligence/section-patterns";

/**
 * lib/design-intelligence/composition-variants.ts — the structural
 * differentiation engine this codebase was missing (CTO directive: "the six
 * visual strategies must meaningfully drive actual page composition... not
 * six rigid templates, a controlled design-variant system where each
 * strategy supports multiple meaningful composition choices").
 *
 * Before this module, section-patterns.ts's six hero patterns were the ONLY
 * structural choice point in the entire Generation pipeline — every other
 * section category (services, credibility, footer, ...) had exactly one
 * implemented pattern (SECTION_PATTERN_REGISTRY), and nav/CTA/content-width/
 * spacing were rendered identically regardless of which visual strategy a
 * business's hero landed on. Two businesses in the same industryBucket with
 * similar evidence density (no testimonials, no team, similar contentEmphasis)
 * therefore produced an identical rendered composition apart from color —
 * exactly the failure mode a real QA run on the Jane Bond mission caught: 7
 * restaurant missions in one org batch shared a byte-identical structural
 * fingerprint.
 *
 * resolveCompositionVariant is the fix: ONE deterministic resolution per
 * mission, starting from the same real hero-pattern choice
 * (resolveHeroPattern already makes, industryBucket + real photography), then
 * propagating that same visual-strategy choice across nav style, CTA
 * arrangement, content width, spacing rhythm, and — new — a second real
 * pattern for services/credibility/footer, each still evidence-density-gated
 * (never picked when the evidence backing it doesn't exist, same discipline
 * resolveHeroPattern's own PHOTO_DEPENDENT_HERO_PATTERNS gate already holds
 * to). DesignMemory's brandPersonality/contentTone — real per-business LLM
 * output that was previously recorded but never load-bearing in what actually
 * rendered (a real QA-flagged gap) — nudge spacing rhythm within a bounded
 * range, making them genuinely consumed without inventing new content.
 *
 * Never random, never keyed off business name/id: every axis here traces to
 * either the business's real industryBucket, its real evidence counts, or
 * Design Intelligence's own real brandPersonality/contentTone output — the
 * same "verify, don't just ask nicely" / evidence-first discipline this
 * codebase already holds every other design decision to.
 */

export type NavStyle = "minimal" | "linked" | "cta-prominent";
export type CtaVariant = "outline" | "filled" | "text-link";
export type ServicesPattern = "numbered-editorial-index" | "grid-cards";
export type CredibilityPattern = "divided-rows" | "stat-strip";
export type FooterPattern = "minimal-centered" | "multi-column";

export interface CompositionVariant {
  /** The same hero pattern resolveHeroPattern already chooses — carried here so every other axis below is a real, traceable consequence of ONE visual-strategy decision, never a second independent choice that could drift out of sync with the hero. */
  heroPattern: HeroPatternId;
  navStyle: NavStyle;
  ctaVariant: CtaVariant;
  contentWidthRem: number;
  /** Added to design-refinement-service.ts's SECTION_PADDING_STEP_INDEX_BY_ROLE/COMPONENT_PADDING_STEP_INDEX_BY_ROLE step indices by the renderer, clamped into the sitewide DEFAULT_SPACING_SCALE's valid range — never a new, off-scale spacing value (§4). */
  paddingBiasSteps: number;
  servicesPattern: ServicesPattern;
  credibilityPattern: CredibilityPattern;
  footerPattern: FooterPattern;
}

/**
 * Base structural profile per hero pattern — the concrete, checkable form of
 * the CTO's six-strategy table extended beyond the hero: Editorial and
 * Luxury Minimal stay restrained (minimal nav, no filled buttons, generous
 * whitespace); Service/Product and Bold Commerce are the conversion-forward
 * pair (prominent nav CTA, filled buttons, denser spacing, card/strip
 * treatments); Cinematic and Local Story sit in between (standard linked
 * nav, outline CTAs, standard width) since their differentiation is carried
 * by the hero's photography/composition rather than page-wide density.
 */
const BASE_VARIANT_BY_HERO_PATTERN: Record<HeroPatternId, Omit<CompositionVariant, "heroPattern">> = {
  "editorial-typographic": {
    navStyle: "minimal",
    ctaVariant: "outline",
    contentWidthRem: 60,
    paddingBiasSteps: 0,
    servicesPattern: "numbered-editorial-index",
    credibilityPattern: "divided-rows",
    footerPattern: "minimal-centered",
  },
  "centered-cinematic": {
    navStyle: "linked",
    ctaVariant: "outline",
    contentWidthRem: 72,
    paddingBiasSteps: 0,
    servicesPattern: "numbered-editorial-index",
    credibilityPattern: "divided-rows",
    footerPattern: "minimal-centered",
  },
  "split-media-text": {
    navStyle: "linked",
    ctaVariant: "outline",
    contentWidthRem: 72,
    paddingBiasSteps: 0,
    servicesPattern: "numbered-editorial-index",
    credibilityPattern: "divided-rows",
    footerPattern: "minimal-centered",
  },
  "image-full-bleed": {
    navStyle: "cta-prominent",
    ctaVariant: "filled",
    contentWidthRem: 72,
    paddingBiasSteps: -1,
    servicesPattern: "grid-cards",
    credibilityPattern: "stat-strip",
    footerPattern: "multi-column",
  },
  "oversized-typographic": {
    navStyle: "minimal",
    ctaVariant: "text-link",
    contentWidthRem: 80,
    paddingBiasSteps: 2,
    servicesPattern: "numbered-editorial-index",
    credibilityPattern: "divided-rows",
    footerPattern: "minimal-centered",
  },
  "offset-overlap": {
    navStyle: "cta-prominent",
    ctaVariant: "filled",
    contentWidthRem: 72,
    paddingBiasSteps: -1,
    servicesPattern: "grid-cards",
    credibilityPattern: "stat-strip",
    footerPattern: "multi-column",
  },
};

/**
 * A grid of 1-2 cards reads as sparse/broken (the same "degrades honestly"
 * discipline section-patterns.ts's module comment already names) —
 * grid-cards is only reachable with enough real service/offering evidence to
 * fill it out.
 *
 * Exported so lib/design-intelligence/experience-planner.ts (Phase 6.1) can
 * gate its own service-density-dependent experience modes (e.g.
 * high-energy-retail) on this SAME real-offering-count bar rather than an
 * independently chosen number.
 */
export const MIN_SERVICES_FOR_GRID_CARDS = 3;

/**
 * The full spacing-nudge vocabulary — unchanged by Phase 11. "unpretentious"
 * stays here: for a low-stakes whitespace/density nudge, "this business's
 * real personality is unpretentious" honestly supports "give it a touch more
 * breathing room," and this exact word is what two existing tests
 * (composition-variants.test.ts, design-qa-service.test.ts) already prove
 * that with.
 */
const RESTRAINED_TONE_KEYWORDS = ["restrained", "quiet", "understate", "minimal", "refined", "subtle", "calm", "unpretentious"];

/**
 * Phase 11 fix: a business's own real personality/tone can independently
 * pull the resolved MotionBudget down a full tier (experience-planner.ts)
 * and veto shader-enhanced-hero outright (capability-selector.ts) — both
 * far higher-stakes than a spacing nudge, so this list is deliberately
 * narrower than RESTRAINED_TONE_KEYWORDS above. Confirmed root cause (Phase
 * 11 audit, docs/PHASE_11_RESTRAINED_TONE_AUDIT.md): "unpretentious"
 * describes a business's own character, not its website's visual register —
 * Dante's Trattoria's real, honestly-assigned brandPersonality
 * (["warm", "unpretentious", "rooted", "authentic"]) mechanically zeroed its
 * motion budget even though nothing about "unpretentious" is a claim that
 * the SITE should hold still. Every word kept here plausibly describes an
 * intended visual/experiential register directly, not merely a business's
 * character — and every one is already proven, by existing tests predating
 * this fix, to correctly express a real "the site itself should feel
 * restrained" signal (a genuinely formal/somber business — a funeral home,
 * a formal law firm — reaches this list via "restrained"/"quiet"/etc., the
 * same words those tests already use). Removing "unpretentious" from THIS
 * list only — never from RESTRAINED_TONE_KEYWORDS above — is a deliberate,
 * narrow fix: the mechanism that produced Dante's flat, motionless page
 * stops firing on mere warmth/humility, while a business whose real voice
 * calls for actual visual restraint is caught exactly as before.
 */
export const MOTION_RESTRAINED_TONE_KEYWORDS = ["restrained", "quiet", "understate", "minimal", "refined", "subtle", "calm"];

const BOLD_TONE_KEYWORDS = ["bold", "energetic", "vibrant", "loud", "punchy", "urgent", "playful", "high-energy"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Phase 11 fix: word-boundary-anchored match instead of a raw substring
 * test. A bare `haystack.includes(keyword)` matches a keyword fused onto a
 * negating prefix with no separator — "unrestrained" contains "restrained",
 * "unrefined" contains "refined", "disquiet" contains "quiet" — each with
 * the OPPOSITE meaning the keyword is supposed to detect. Anchored only at
 * the START of the keyword (`\b<keyword>`, no trailing `\b`) rather than
 * both ends deliberately preserves the list's existing stem-style matches —
 * "understate" is meant to also catch "understated"/"understatement", and a
 * trailing boundary would break that legitimate suffix — while a leading
 * boundary alone already can't fire in the middle of a fused token like
 * "unrestrained" (no non-word character sits between "un" and "restrained"
 * for `\b` to match against).
 */
function matchesAnyToneKeyword(haystack: string, keywords: string[]): boolean {
  return keywords.some((kw) => new RegExp(`\\b${kw}`).test(haystack));
}

/**
 * Real, named, checkable keyword match (mirroring genericity-rules.ts's own
 * banned-phrase-scanner discipline) rather than a vibe-based LLM re-judgment
 * — brandPersonality/contentTone are already real per-business Design
 * Intelligence output; this only decides which of two already-legitimate
 * spacing rhythms that real output leans toward, never invents new text.
 * Exported so design-qa-service.ts's brand-fit check can independently
 * re-verify brandPersonality is genuinely load-bearing (this exact bias
 * shows up in the persisted wireframe.compositionVariant.paddingBiasSteps)
 * rather than checking for brandPersonality's own adjectives inside real
 * body copy — which was never the right bar: rendering words like
 * "unpretentious" or "confident" verbatim as page copy is exactly the class
 * of hollow, could-paste-onto-any-business phrasing
 * BANNED_GENERIC_DESIGN_PHRASES (genericity-rules.ts) exists to keep off the
 * page, not something to aim for.
 *
 * Spacing-only (RESTRAINED_TONE_KEYWORDS, including "unpretentious") —
 * never used for motion/capability decisions; see isMotionRestrainedTone
 * below for that separate, narrower check.
 */
export function personalityPaddingBias(brandPersonality: string[] | undefined, contentTone: string | undefined): number {
  const haystack = [...(brandPersonality ?? []), contentTone ?? ""].join(" ").toLowerCase();
  if (!haystack.trim()) return 0;
  const restrained = matchesAnyToneKeyword(haystack, RESTRAINED_TONE_KEYWORDS);
  const bold = matchesAnyToneKeyword(haystack, BOLD_TONE_KEYWORDS);
  if (restrained && !bold) return 1;
  if (bold && !restrained) return -1;
  return 0;
}

/**
 * Phase 11: the motion/capability-specific restrained-tone check —
 * experience-planner.ts's resolveMotionBudget and capability-selector.ts's
 * shader-enhanced-hero gate both call this instead of personalityPaddingBias
 * now, so a real business's genuine warmth/humility (e.g. "unpretentious")
 * can no longer suppress motion or veto a capability, while a genuinely
 * restrained/formal register ("restrained", "quiet", "understated", ...)
 * still does, exactly as before. Same "restrained AND NOT bold" symmetry
 * personalityPaddingBias already applies, returned as the plain boolean
 * both call sites actually use (neither ever reads the bold/-1 case).
 */
export function isMotionRestrainedTone(brandPersonality: string[] | undefined, contentTone: string | undefined): boolean {
  const haystack = [...(brandPersonality ?? []), contentTone ?? ""].join(" ").toLowerCase();
  if (!haystack.trim()) return false;
  const restrained = matchesAnyToneKeyword(haystack, MOTION_RESTRAINED_TONE_KEYWORDS);
  const bold = matchesAnyToneKeyword(haystack, BOLD_TONE_KEYWORDS);
  return restrained && !bold;
}

export interface CompositionEvidenceDensity {
  /** Real service/offering count (DesignBrief.services.length). */
  services: number;
  /** Real certification count (DesignBrief.certifications.length). */
  certifications: number;
  /** True when a real, structured review count/rating was captured (DesignBrief.reviews). */
  hasReviews: boolean;
  /** Real captured photo count (DesignBrief.gallery.length) — resolveHeroPattern's Phase 5.4 evidence-amount signal, threaded through here rather than only the bare hasRealImagery boolean so a real photo library can actively earn a photo-forward hero pattern, not just avoid being excluded from one. Defaults to 0 (no preference boost) at every existing call site that predates this field. */
  galleryCount?: number;
}

export interface ResolveCompositionVariantInput {
  industryBucket: IndustryBucket;
  hasRealImagery: boolean;
  evidence: CompositionEvidenceDensity;
  brandPersonality?: string[];
  contentTone?: string;
}

/**
 * resolveCompositionVariant — one deterministic composition decision per
 * mission, propagating resolveHeroPattern's real visual-strategy choice
 * across every structural axis this pass now controls, then narrowing two of
 * them (servicesPattern, credibilityPattern) back down when this business's
 * real evidence can't honestly support the denser pattern, and nudging
 * spacing rhythm from Design Memory's own real brandPersonality/contentTone.
 * Never partial/undefined — every branch returns a complete, renderable
 * variant, matching resolveHeroPattern's own "always a real answer" contract.
 */
export function resolveCompositionVariant(input: ResolveCompositionVariantInput): CompositionVariant {
  const heroPattern = resolveHeroPattern(input.industryBucket, input.hasRealImagery, input.evidence.galleryCount ?? 0);
  const base = BASE_VARIANT_BY_HERO_PATTERN[heroPattern];

  const servicesPattern: ServicesPattern =
    base.servicesPattern === "grid-cards" && input.evidence.services < MIN_SERVICES_FOR_GRID_CARDS
      ? "numbered-editorial-index"
      : base.servicesPattern;

  const credibilityPattern: CredibilityPattern =
    base.credibilityPattern === "stat-strip" && input.evidence.certifications === 0 && !input.evidence.hasReviews
      ? "divided-rows"
      : base.credibilityPattern;

  const paddingBiasSteps = clamp(
    base.paddingBiasSteps + personalityPaddingBias(input.brandPersonality, input.contentTone),
    -2,
    2
  );

  return { ...base, heroPattern, servicesPattern, credibilityPattern, paddingBiasSteps };
}
