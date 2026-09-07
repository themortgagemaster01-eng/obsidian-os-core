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
    // restaurant's own INDUSTRY_HERO_PREFERENCE never ranks image-full-bleed
    // or offset-overlap (photo-led's only candidates) at all — a real signal
    // toward photo-led must not introduce either pattern for this industry.
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
