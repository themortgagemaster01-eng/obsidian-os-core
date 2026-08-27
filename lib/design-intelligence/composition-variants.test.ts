import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveCompositionVariant, personalityPaddingBias, isMotionRestrainedTone } from "@/lib/design-intelligence/composition-variants";

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
