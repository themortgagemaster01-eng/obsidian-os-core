import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolveCompositionVariant,
  resolveCompositionArchetype,
  resolveHeroPatternArchetypeOverride,
  personalityPaddingBias,
  isMotionRestrainedTone,
} from "@/lib/design-intelligence/composition-variants";
import { resolveHeroPattern } from "@/lib/design-intelligence/section-patterns";

const NO_EVIDENCE = { services: 0, certifications: 0, hasReviews: false };

describe("composition-variants: resolveCompositionVariant", () => {
  test("propagates the same hero pattern resolveHeroPattern would choose for this bucket/imagery pair", () => {
    const variant = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
    });
    assert.equal(variant.heroPattern, "image-full-bleed");
  });

  test("Service/Product and Bold Commerce strategies get a conversion-forward profile: cta-prominent nav, filled CTA, tighter spacing", () => {
    const variant = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: { services: 5, certifications: 2, hasReviews: false },
    });
    assert.equal(variant.navStyle, "cta-prominent");
    assert.equal(variant.ctaVariant, "filled");
    assert.equal(variant.paddingBiasSteps, -1);
  });

  test("Luxury Minimal (no photography, non-restaurant/lawFirm bucket via dentistMedical/luxuryServices) gets restrained profile: minimal nav, text-link CTA, wide content, generous spacing", () => {
    const variant = resolveCompositionVariant({
      industryBucket: "luxuryServices",
      hasRealImagery: false,
      evidence: NO_EVIDENCE,
    });
    assert.equal(variant.heroPattern, "oversized-typographic");
    assert.equal(variant.navStyle, "minimal");
    assert.equal(variant.ctaVariant, "text-link");
    assert.equal(variant.contentWidthRem, 80);
    assert.equal(variant.paddingBiasSteps, 2);
  });

  test("grid-cards downgrades to numbered-editorial-index when real service evidence is too thin to fill a grid honestly", () => {
    const thin = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: { services: 1, certifications: 0, hasReviews: false },
    });
    assert.equal(thin.servicesPattern, "numbered-editorial-index");

    const rich = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: { services: 3, certifications: 0, hasReviews: false },
    });
    assert.equal(rich.servicesPattern, "grid-cards");
  });

  test("stat-strip downgrades to divided-rows when neither real certifications nor a real review count back it", () => {
    const thin = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
    });
    assert.equal(thin.credibilityPattern, "divided-rows");

    const withCerts = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: { services: 0, certifications: 1, hasReviews: false },
    });
    assert.equal(withCerts.credibilityPattern, "stat-strip");

    const withReviews = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: { services: 0, certifications: 0, hasReviews: true },
    });
    assert.equal(withReviews.credibilityPattern, "stat-strip");
  });

  test("a restrained brandPersonality/contentTone nudges spacing more generous, within the clamped range", () => {
    const base = resolveCompositionVariant({ industryBucket: "homeService", hasRealImagery: true, evidence: NO_EVIDENCE });
    const restrained = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
      brandPersonality: ["unpretentious", "confident"],
    });
    assert.equal(restrained.paddingBiasSteps, base.paddingBiasSteps + 1);
  });

  test("a bold contentTone nudges spacing tighter", () => {
    const base = resolveCompositionVariant({ industryBucket: "lawFirm", hasRealImagery: false, evidence: NO_EVIDENCE });
    const bold = resolveCompositionVariant({
      industryBucket: "lawFirm",
      hasRealImagery: false,
      evidence: NO_EVIDENCE,
      contentTone: "energetic and playful",
    });
    assert.equal(bold.paddingBiasSteps, base.paddingBiasSteps - 1);
  });

  test("two businesses in the same bucket with genuinely different real evidence density diverge structurally, not just in color", () => {
    const thinEvidence = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
    });
    const richEvidence = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: { services: 6, certifications: 2, hasReviews: true },
    });
    assert.notEqual(thinEvidence.servicesPattern, richEvidence.servicesPattern);
    assert.notEqual(thinEvidence.credibilityPattern, richEvidence.credibilityPattern);
  });
});

describe("composition-variants: personalityPaddingBias", () => {
  test("returns 0 for no signal, or when both restrained and bold terms are present (ambiguous, never guessed)", () => {
    assert.equal(personalityPaddingBias(undefined, undefined), 0);
    assert.equal(personalityPaddingBias([], ""), 0);
    assert.equal(personalityPaddingBias(["neutral-tone"], undefined), 0);
    assert.equal(personalityPaddingBias(["restrained", "bold"], undefined), 0);
  });

  test("Phase 11: 'unpretentious' still nudges spacing — the spacing list is deliberately unchanged", () => {
    assert.equal(personalityPaddingBias(["unpretentious"], undefined), 1);
  });

  test("Phase 11 word-boundary fix: a keyword fused onto a negating prefix with no separator no longer false-positives", () => {
    // Before the fix, plain substring .includes() matched "restrained" inside
    // "unrestrained", "refined" inside "unrefined", and "quiet" inside
    // "disquiet" — each the OPPOSITE of what the keyword is meant to detect.
    assert.equal(personalityPaddingBias(["unrestrained"], undefined), 0, "unrestrained must not match restrained");
    assert.equal(personalityPaddingBias(["unrefined"], undefined), 0, "unrefined must not match refined");
    assert.equal(personalityPaddingBias(["disquiet"], undefined), 0, "disquiet must not match quiet");
  });

  test("Phase 11 word-boundary fix: legitimate stem/suffix matches are preserved — the fix only anchors the leading edge", () => {
    // "understate" is deliberately a stem so it also catches "understated"/
    // "understatement"; a trailing \b would have broken this legitimate case.
    assert.equal(personalityPaddingBias(["understated"], undefined), 1);
    assert.equal(personalityPaddingBias(undefined, "an understated, elegant space"), 1);
    assert.equal(personalityPaddingBias(["calm"], undefined), 1);
    assert.equal(personalityPaddingBias(undefined, "calmly confident"), 1);
  });
});

/**
 * Gap Map Fix #2 (composition-variant differentiation). Real,
 * already-persisted DesignMemory.photographyStyle/componentVariants/
 * preferredLayouts text — confirmed unused anywhere in the pipeline before
 * this fix — can now pull a mission's composition toward one of 4 closed
 * archetypes, independent of (never changing) resolveHeroPattern's own real
 * hero-pattern choice.
 */
describe("composition-variants: resolveCompositionArchetype / archetype-driven composition (Gap Map Fix #2)", () => {
  test("different real reasoning produces genuinely different composition (nav/CTA/width/spacing), never just color", () => {
    const withoutSignal = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
    });
    const withEditorialSignal = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
      componentVariants: ["An editorial layout built on an asymmetric grid for the story sections"],
    });

    // heroPattern itself is untouched by Fix #2 — only the resolveHeroPattern
    // seam owns that decision, exactly as before.
    assert.equal(withoutSignal.heroPattern, withEditorialSignal.heroPattern);

    // But the structural composition axes genuinely diverge.
    assert.notEqual(withoutSignal.navStyle, withEditorialSignal.navStyle);
    assert.notEqual(withoutSignal.ctaVariant, withEditorialSignal.ctaVariant);
    assert.notEqual(withoutSignal.contentWidthRem, withEditorialSignal.contentWidthRem);
    assert.equal(withEditorialSignal.navStyle, "minimal");
    assert.equal(withEditorialSignal.ctaVariant, "outline");
    assert.equal(withEditorialSignal.contentWidthRem, 60);
  });

  test("the same real reasoning resolves to the identical composition every time — deterministic, never random or ID-keyed", () => {
    const input = {
      industryBucket: "restaurant" as const,
      hasRealImagery: true,
      evidence: { services: 5, certifications: 1, hasReviews: true },
      photographyStyle: "Full-bleed photography carries the hero and the gallery",
    };
    const first = resolveCompositionVariant(input);
    const second = resolveCompositionVariant(input);
    const third = resolveCompositionVariant({ ...input });
    assert.deepEqual(first, second);
    assert.deepEqual(first, third);
  });

  test("missing reasoning resolves to today's exact legacy composition — the mandatory safe fallback", () => {
    const legacy = resolveCompositionVariant({ industryBucket: "homeService", hasRealImagery: true, evidence: NO_EVIDENCE });
    const explicitlyAbsent = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
      photographyStyle: undefined,
      componentVariants: undefined,
      preferredLayouts: undefined,
    });
    const explicitlyEmpty = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
      photographyStyle: "",
      componentVariants: [],
      preferredLayouts: [],
    });
    assert.deepEqual(legacy, explicitlyAbsent);
    assert.deepEqual(legacy, explicitlyEmpty);
    assert.equal(legacy.navStyle, "cta-prominent");
    assert.equal(legacy.ctaVariant, "filled");
    assert.equal(legacy.contentWidthRem, 72);

    assert.equal(resolveCompositionArchetype("editorial-typographic", null), "editorial");
    assert.equal(resolveCompositionArchetype("oversized-typographic", undefined), "minimal-formal");
  });

  test("malformed/ambiguous reasoning resolves to today's exact legacy composition, never a guess", () => {
    const legacy = resolveCompositionVariant({ industryBucket: "homeService", hasRealImagery: true, evidence: NO_EVIDENCE });

    // Matches BOTH photo-led ("full-bleed") and editorial ("editorial layout")
    // keyword sets at once — genuinely ambiguous, must not pick either.
    const ambiguous = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
      componentVariants: ["A full-bleed photo hero paired with an editorial layout for the story section"],
    });
    assert.deepEqual(ambiguous, legacy);

    // Whitespace-only / non-matching text carries no real signal either.
    const blank = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
      photographyStyle: "   ",
      componentVariants: ["", "   "],
      preferredLayouts: ["A perfectly normal layout with cards and buttons"],
    });
    assert.deepEqual(blank, legacy);
  });
});

/**
 * Gap Map Fix #3 (hero pattern override via composition archetype). A
 * genuine, unambiguous archetype signal can now move heroPattern itself, not
 * just the peripheral nav/CTA/footer chrome — but only to a hero pattern
 * that's both industry-sanctioned (already present in that industryBucket's
 * own INDUSTRY_HERO_PREFERENCE list) and evidence-eligible
 * (PHOTO_DEPENDENT_HERO_PATTERNS unchanged). Every other case preserves
 * today's exact resolveHeroPattern() result.
 */
describe("composition-variants: resolveHeroPatternArchetypeOverride (Gap Map Fix #3)", () => {
  test("unambiguous signal + industry-sanctioned + evidence-eligible candidate -> hero pattern actually changes", () => {
    const defaultHeroPattern = resolveHeroPattern("homeService", true, 0);
    assert.equal(defaultHeroPattern, "image-full-bleed"); // today's real default for this input

    const variant = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
      componentVariants: ["A side-by-side split-screen layout for the story section"],
    });
    assert.equal(variant.heroPattern, "centered-cinematic");
    assert.notEqual(variant.heroPattern, defaultHeroPattern);

    // Same result via the resolver directly, at the exact seam.
    assert.equal(
      resolveHeroPatternArchetypeOverride(defaultHeroPattern, "split-focus", "homeService", true),
      "centered-cinematic"
    );
  });

  test("the same input resolves to the identical hero pattern every time — deterministic, never random", () => {
    const input = {
      industryBucket: "homeService" as const,
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
      componentVariants: ["A side-by-side split-screen layout for the story section"],
    };
    const first = resolveCompositionVariant(input);
    const second = resolveCompositionVariant({ ...input });
    assert.equal(first.heroPattern, "centered-cinematic");
    assert.equal(first.heroPattern, second.heroPattern);
  });

  test("missing archetype signal resolves to byte-identical resolveHeroPattern() output", () => {
    const legacy = resolveHeroPattern("homeService", true, 0);
    const variant = resolveCompositionVariant({ industryBucket: "homeService", hasRealImagery: true, evidence: NO_EVIDENCE });
    assert.equal(variant.heroPattern, legacy);
  });

  test("ambiguous signal (matches 2+ archetypes) -> today's hero pattern wins, no override", () => {
    const legacy = resolveHeroPattern("homeService", true, 0);
    const variant = resolveCompositionVariant({
      industryBucket: "homeService",
      hasRealImagery: true,
      evidence: NO_EVIDENCE,
      componentVariants: ["A full-bleed photo hero paired with an editorial layout for the story section"],
    });
    assert.equal(variant.heroPattern, legacy);
  });

  test("no industry-sanctioned candidate for the resolved archetype -> today's hero pattern wins", () => {
    // Hero Archetype Bottleneck fix (2026-09-12): restaurant's list now
    // includes image-full-bleed (see section-patterns.ts's own comment), so
    // a photo-led signal CAN reach it now — but only under real evidence.
    // This test's own input has hasRealImagery: false, which still fails
    // the override's evidence gate (line ~475 of composition-variants.ts)
    // regardless of list membership — offset-overlap remains excluded from
    // restaurant's list either way, so it's never a candidate here at all.
    const legacy = resolveHeroPattern("restaurant", false, 0);
    assert.equal(legacy, "editorial-typographic");

    const variant = resolveCompositionVariant({
      industryBucket: "restaurant",
      hasRealImagery: false,
      evidence: NO_EVIDENCE,
      componentVariants: ["Full-bleed photography carries the hero"],
    });
    assert.equal(variant.heroPattern, legacy);

    assert.equal(resolveHeroPatternArchetypeOverride(legacy, "photo-led", "restaurant", false), legacy);
  });

  test("industry-sanctioned candidate exists but fails the evidence gate -> today's hero pattern wins, never a forced/broken substitution", () => {
    // realEstate ranks both of split-focus's candidates (centered-cinematic,
    // split-media-text) but BOTH are photo-dependent — with no real imagery,
    // neither is eligible, so the override must not fire at all.
    const legacy = resolveHeroPattern("realEstate", false, 0);
    assert.equal(legacy, "editorial-typographic"); // resolveHeroPattern's own final fallback once every real-estate candidate is photo-gated out

    const variant = resolveCompositionVariant({
      industryBucket: "realEstate",
      hasRealImagery: false,
      evidence: NO_EVIDENCE,
      componentVariants: ["A side-by-side split-screen layout for listings"],
    });
    assert.equal(variant.heroPattern, legacy);

    assert.equal(resolveHeroPatternArchetypeOverride(legacy, "split-focus", "realEstate", false), legacy);
  });
});

/**
 * Hero Archetype Bottleneck fix (2026-09-12): restaurant's own real
 * production data showed 7 of 7 photo-rich restaurant missions ever
 * completed converging on the identical split-media-text hero pattern,
 * traced to INDUSTRY_HERO_PREFERENCE.restaurant never listing
 * image-full-bleed at all — even though 3 of those real missions'
 * Design Intelligence output already said "full-bleed" in their own real,
 * persisted photographyStyle text. Fix: add image-full-bleed to
 * restaurant's list (section-patterns.ts) so the ALREADY-EXISTING Gap Map
 * Fix #2/#3 archetype-override machinery — which was already correctly
 * detecting the "photo-led" signal — has an industry-sanctioned candidate
 * to apply it to. No new keyword list, no new resolver function; this
 * suite proves the existing machinery now does the right thing with real
 * input, and that every other bucket/behavior is untouched.
 */
describe("composition-variants: Hero Archetype Bottleneck fix — restaurant image-full-bleed reachability", () => {
  // Verbatim real photographyStyle text pulled from production (design_briefs.design_memory), 2026-09-12/13.
  const DANTES_PHOTOGRAPHY_STYLE =
    "Real, unedited-feeling trattoria photography — food, interior, room atmosphere — treated large and full-bleed as the primary visual voice of the site.";
  const CARRIAGE_HOUSE_PHOTOGRAPHY_STYLE =
    "Use the business's own 11 real photos full-bleed and large — warm, ambient, unretouched-feeling interior/atmosphere shots; never generic stock or illustration.";
  const FREIGHT_HOUSE_PHOTOGRAPHY_STYLE =
    "Full-bleed, natural-light interior/exterior shots of the actual freight house building and food, unretouched-feeling, no stock or AI imagery";
  const COUNTRYSIDE_KITCHEN_PHOTOGRAPHY_STYLE =
    "The business's own real, unstaged photos of food and interior, cropped generously and warmly lit — no stock or AI-generated imagery";

  test("real case: Dante's Trattoria (20 real photos, real 'full-bleed' photographyStyle) now resolves image-full-bleed", () => {
    const variant = resolveCompositionVariant({
      industryBucket: "restaurant",
      hasRealImagery: true,
      evidence: { services: 0, certifications: 0, hasReviews: false, galleryCount: 20 },
      photographyStyle: DANTES_PHOTOGRAPHY_STYLE,
    });
    assert.equal(variant.heroPattern, "image-full-bleed");
  });

  test("real case: Carriage House Mahopac (11 real photos, real 'full-bleed' photographyStyle) now resolves image-full-bleed", () => {
    const variant = resolveCompositionVariant({
      industryBucket: "restaurant",
      hasRealImagery: true,
      evidence: { services: 0, certifications: 0, hasReviews: false, galleryCount: 11 },
      photographyStyle: CARRIAGE_HOUSE_PHOTOGRAPHY_STYLE,
    });
    assert.equal(variant.heroPattern, "image-full-bleed");
  });

  test("real case: The Freight House Cafe (19 real photos, real 'full-bleed' photographyStyle) now resolves image-full-bleed", () => {
    const variant = resolveCompositionVariant({
      industryBucket: "restaurant",
      hasRealImagery: true,
      evidence: { services: 0, certifications: 0, hasReviews: false, galleryCount: 19 },
      photographyStyle: FREIGHT_HOUSE_PHOTOGRAPHY_STYLE,
    });
    assert.equal(variant.heroPattern, "image-full-bleed");
  });

  test("real case: Countryside Kitchen (17 real photos, real photographyStyle with NO full-bleed/photo-led signal) stays split-media-text, unchanged", () => {
    const variant = resolveCompositionVariant({
      industryBucket: "restaurant",
      hasRealImagery: true,
      evidence: { services: 0, certifications: 0, hasReviews: false, galleryCount: 17 },
      photographyStyle: COUNTRYSIDE_KITCHEN_PHOTOGRAPHY_STYLE,
    });
    assert.equal(variant.heroPattern, "split-media-text");
  });

  test("regression: restaurant with no real imagery still resolves editorial-typographic, exactly as before this fix", () => {
    const variant = resolveCompositionVariant({
      industryBucket: "restaurant",
      hasRealImagery: false,
      evidence: { services: 0, certifications: 0, hasReviews: false, galleryCount: 0 },
      photographyStyle: DANTES_PHOTOGRAPHY_STYLE, // even a strong signal can't override the evidence gate
    });
    assert.equal(variant.heroPattern, "editorial-typographic");
  });

  test("regression: restaurant with real imagery but thin evidence (below the 3-photo bar) and no signal still resolves split-media-text's own bucket default path unchanged", () => {
    // galleryCount below MIN_GALLERY_FOR_PHOTO_HERO_PREFERENCE (3) — resolveHeroPattern's
    // own Stage-3 bump never fires, so the plain fallback loop still returns
    // editorial-typographic (first non-photo-dependent candidate), exactly as
    // before this fix. Unaffected by the list widening.
    const legacy = resolveHeroPattern("restaurant", true, 1);
    assert.equal(legacy, "editorial-typographic");
  });

  test("offset-overlap is never introduced for restaurant, even with a strong photo-led signal — scope discipline (only image-full-bleed was added)", () => {
    const variant = resolveCompositionVariant({
      industryBucket: "restaurant",
      hasRealImagery: true,
      evidence: { services: 0, certifications: 0, hasReviews: false, galleryCount: 20 },
      photographyStyle: DANTES_PHOTOGRAPHY_STYLE,
    });
    assert.notEqual(variant.heroPattern, "offset-overlap");
  });

  test("centered-cinematic remains structurally unreachable for restaurant after this fix — unchanged, not manufactured", () => {
    // centered-cinematic shares "split-focus" archetype with split-media-text
    // (ARCHETYPE_BY_HERO_PATTERN), so no real DesignMemory signal can make the
    // override mechanism treat reaching it as a genuine archetype change from
    // split-media-text's own default — this fix does not attempt to change that.
    const variant = resolveCompositionVariant({
      industryBucket: "restaurant",
      hasRealImagery: true,
      evidence: { services: 0, certifications: 0, hasReviews: false, galleryCount: 20 },
      componentVariants: ["A side-by-side split-screen, dual-focus layout for the story section"],
    });
    assert.notEqual(variant.heroPattern, "centered-cinematic");
  });

  test("no randomness: the same real input resolves to the identical hero pattern across repeated, independent calls", () => {
    const input = {
      industryBucket: "restaurant" as const,
      hasRealImagery: true,
      evidence: { services: 0, certifications: 0, hasReviews: false, galleryCount: 20 },
      photographyStyle: DANTES_PHOTOGRAPHY_STYLE,
    };
    const results = Array.from({ length: 5 }, () => resolveCompositionVariant({ ...input }));
    for (const result of results) {
      assert.equal(result.heroPattern, "image-full-bleed");
      assert.deepEqual(result, results[0]);
    }
  });

  test("every other industry bucket's reachable/unreachable hero patterns are unaffected by this restaurant-only change", () => {
    assert.equal(resolveHeroPattern("homeService", true, 5), "image-full-bleed");
    assert.equal(resolveHeroPattern("lawFirm", true, 5), "editorial-typographic");
    assert.equal(resolveHeroPattern("dentistMedical", true, 5), "oversized-typographic");
    assert.equal(resolveHeroPattern("realEstate", true, 5), "split-media-text");
    assert.equal(resolveHeroPattern("fitness", true, 5), "centered-cinematic");
    assert.equal(resolveHeroPattern("luxuryServices", true, 5), "oversized-typographic");
    assert.equal(resolveHeroPattern("general", true, 5), "image-full-bleed");
  });
});

describe("composition-variants: isMotionRestrainedTone (Phase 11)", () => {
  test("'unpretentious' alone no longer reads as a motion-restraining tone — the confirmed Dante's Trattoria root cause", () => {
    assert.equal(isMotionRestrainedTone(["unpretentious"], undefined), false);
    assert.equal(isMotionRestrainedTone(["warm", "unpretentious", "rooted", "authentic"], "Warm, direct, unpretentious neighborhood voice."), false);
  });

  test("genuinely register-restrained words still read as motion-restraining, unchanged", () => {
    assert.equal(isMotionRestrainedTone(["restrained"], undefined), true);
    assert.equal(isMotionRestrainedTone(["quiet"], undefined), true);
    assert.equal(isMotionRestrainedTone(undefined, "an understated, refined register"), true);
  });

  test("a formal/somber business's real register-restrained words (e.g. a funeral home or formal law firm) are unaffected by this fix", () => {
    assert.equal(isMotionRestrainedTone(["dignified", "restrained", "solemn"], "A quiet, understated register befitting the occasion."), true);
  });

  test("no signal, or a bold+restrained mix, reads as false (ambiguous, never guessed) — same symmetry as personalityPaddingBias", () => {
    assert.equal(isMotionRestrainedTone(undefined, undefined), false);
    assert.equal(isMotionRestrainedTone(["restrained", "bold"], undefined), false);
  });

  test("word-boundary fix applies here too", () => {
    assert.equal(isMotionRestrainedTone(["unrestrained"], undefined), false);
    assert.equal(isMotionRestrainedTone(["disquiet"], undefined), false);
  });
});
