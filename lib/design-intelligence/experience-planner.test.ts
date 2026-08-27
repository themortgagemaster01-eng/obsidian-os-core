import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolveExperienceMode,
  resolveMotionBudget,
  resolveExperiencePlan,
  computeMotionBudgetCeiling,
  type ExperiencePlanEvidenceDensity,
} from "@/lib/design-intelligence/experience-planner";
import { NEUTRAL_EXPERIENCE_PREFERENCE, type HumanExperiencePreference } from "@/shared/design-intelligence/types";

const NO_EVIDENCE: ExperiencePlanEvidenceDensity = {
  services: 0,
  certifications: 0,
  hasReviews: false,
  galleryCount: 0,
  hasRealTeam: false,
};

describe("experience-planner: resolveExperienceMode", () => {
  test("a photography-rich restaurant with a photo-backed hero pattern resolves to cinematic-storytelling", () => {
    const mode = resolveExperienceMode("restaurant", "centered-cinematic", { ...NO_EVIDENCE, galleryCount: 8 });
    assert.equal(mode, "cinematic-storytelling");
  });

  test("anti-drift: cinematic-storytelling is unreachable when the already-resolved hero pattern is NOT photo-backed, even with a high gallery count in the evidence object", () => {
    // A defensively inconsistent input (mirrors resolveHeroPattern's own (false, 20) defensive case) —
    // the experience plan must never contradict the hero pattern that was actually resolved upstream.
    const mode = resolveExperienceMode("restaurant", "editorial-typographic", { ...NO_EVIDENCE, galleryCount: 20 });
    assert.notEqual(mode, "cinematic-storytelling");
    assert.equal(mode, "warm-local-business");
  });

  test("a professional-services (lawFirm) business with real team/certification evidence resolves to trust-authority, never a photo-dependent mode", () => {
    const mode = resolveExperienceMode("lawFirm", "editorial-typographic", {
      ...NO_EVIDENCE,
      hasRealTeam: true,
      certifications: 2,
      hasReviews: true,
    });
    assert.equal(mode, "trust-authority");
  });

  test("trust-authority is unreachable with zero credibility evidence — falls back to editorial-storytelling", () => {
    const mode = resolveExperienceMode("lawFirm", "editorial-typographic", NO_EVIDENCE);
    assert.equal(mode, "editorial-storytelling");
  });

  test("a product-photo-rich homeService business with a real offering list resolves to high-energy-retail", () => {
    const mode = resolveExperienceMode("homeService", "image-full-bleed", {
      ...NO_EVIDENCE,
      galleryCount: 6,
      services: 5,
    });
    assert.equal(mode, "high-energy-retail");
  });

  test("high-energy-retail is unreachable with too few real offerings — falls back down the homeService preference list", () => {
    const mode = resolveExperienceMode("homeService", "editorial-typographic", { ...NO_EVIDENCE, services: 1 });
    assert.notEqual(mode, "high-energy-retail");
  });

  test("a sparse general-bucket business with no real evidence at all still gets a real, honest mode — never throws, never invents evidence", () => {
    const mode = resolveExperienceMode("general", "editorial-typographic", NO_EVIDENCE);
    assert.equal(mode, "editorial-storytelling");
  });

  test("an unrecognized bucket falls back to the general preference list rather than throwing", () => {
    // @ts-expect-error deliberately passing a value outside the IndustryBucket union to prove the runtime fallback, not just the type
    const mode = resolveExperienceMode("not-a-real-bucket", "editorial-typographic", NO_EVIDENCE);
    assert.equal(mode, "editorial-storytelling");
  });
});

describe("experience-planner: resolveMotionBudget", () => {
  test("never exceeds a restrained-register mode's own ceiling, even with rich evidence and an energetic disclosed intensity", () => {
    const rich: ExperiencePlanEvidenceDensity = {
      services: 5,
      certifications: 3,
      hasReviews: true,
      galleryCount: 10,
      hasRealTeam: true,
    };
    const budget = resolveMotionBudget("trust-authority", rich, "energetic");
    assert.equal(budget, "subtle");

    const minimalBudget = resolveMotionBudget("premium-minimal", rich, "energetic");
    assert.equal(minimalBudget, "subtle");
  });

  test("never exceeds the evidence ceiling — thin evidence caps the budget low regardless of mode/intensity", () => {
    const budget = resolveMotionBudget("cinematic-storytelling", NO_EVIDENCE, "energetic");
    assert.equal(budget, "none");
  });

  test("a restrained disclosed motionIntensity caps the budget at subtle regardless of how rich the evidence is", () => {
    const rich: ExperiencePlanEvidenceDensity = {
      services: 5,
      certifications: 3,
      hasReviews: true,
      galleryCount: 10,
      hasRealTeam: true,
    };
    const budget = resolveMotionBudget("cinematic-storytelling", rich, "restrained");
    assert.equal(budget, "subtle");
  });

  test("a restrained-read brandPersonality/contentTone pulls the budget down one further step", () => {
    const moderate: ExperiencePlanEvidenceDensity = {
      services: 3,
      certifications: 1,
      hasReviews: false,
      galleryCount: 0,
      hasRealTeam: false,
    };
    const withoutPersonality = resolveMotionBudget("warm-local-business", moderate, "energetic");
    const withRestrainedPersonality = resolveMotionBudget("warm-local-business", moderate, "energetic", ["restrained", "quiet"]);
    assert.equal(withoutPersonality, "enhanced");
    assert.equal(withRestrainedPersonality, "subtle");
  });

  test("a bold-read brandPersonality never raises the budget past the mode/evidence/intensity ceilings", () => {
    const rich: ExperiencePlanEvidenceDensity = {
      services: 5,
      certifications: 3,
      hasReviews: true,
      galleryCount: 10,
      hasRealTeam: true,
    };
    const budget = resolveMotionBudget("trust-authority", rich, "energetic", ["bold", "energetic"]);
    assert.equal(budget, "subtle");
  });

  test("never produces a budget below \"none\" or above \"cinematic\"", () => {
    const rich: ExperiencePlanEvidenceDensity = {
      services: 5,
      certifications: 3,
      hasReviews: true,
      galleryCount: 10,
      hasRealTeam: true,
    };
    const min = resolveMotionBudget("premium-minimal", NO_EVIDENCE, "restrained", ["restrained"]);
    assert.equal(min, "none");
    const max = resolveMotionBudget("cinematic-storytelling", rich, "energetic");
    assert.equal(max, "cinematic");
  });

  describe("Phase 11: restrained-tone keyword fix (docs/PHASE_11_RESTRAINED_TONE_AUDIT.md)", () => {
    // The exact real evidence density for Dante's Trattoria (a real mission,
    // hosted-Supabase validation): 20 real photos, no services/certifications/
    // team/structured-review evidence. Confirmed by direct re-execution
    // against the real persisted design brief before this fix existed.
    const dantesEvidence: ExperiencePlanEvidenceDensity = {
      services: 0,
      certifications: 0,
      hasReviews: false,
      galleryCount: 20,
      hasRealTeam: false,
    };
    const dantesBrandPersonality = ["warm", "unpretentious", "rooted", "authentic"];
    const dantesContentTone = "Warm, direct, unpretentious neighborhood-Italian voice — short, confident sentences, no corporate filler.";

    test("the confirmed root cause: 'unpretentious' no longer collapses Dante's Trattoria's motion budget to \"none\"", () => {
      const budget = resolveMotionBudget(
        "cinematic-storytelling",
        dantesEvidence,
        "restrained",
        dantesBrandPersonality,
        dantesContentTone
      );
      assert.equal(budget, "subtle", "matches this business's real evidence-based ceiling — the tone nudge no longer fires on mere warmth/humility");
    });

    test("the evidence-based ceiling alone (no personality at all) already computes \"subtle\" for this business — proving the fix removes an EXTRA penalty, not the ceiling itself", () => {
      const budget = resolveMotionBudget("cinematic-storytelling", dantesEvidence, "restrained");
      assert.equal(budget, "subtle");
    });

    test("a genuinely formal/somber business (funeral home / formal law firm equivalent) still correctly gets little/no motion — this protection is unchanged", () => {
      const richButSomberEvidence: ExperiencePlanEvidenceDensity = {
        services: 5,
        certifications: 3,
        hasReviews: true,
        galleryCount: 10,
        hasRealTeam: true,
      };
      // Rich evidence would otherwise support a much higher budget.
      // trust-authority's own mode ceiling already floors this at "subtle"
      // regardless of evidence — and a real, register-restrained brand voice
      // (genuinely different from mere warmth/humility) correctly pulls it
      // one step further, to "none": exactly the outcome a solemn business
      // should get, and exactly the mechanism's real, legitimate job, which
      // this fix must not weaken.
      const budget = resolveMotionBudget(
        "trust-authority",
        richButSomberEvidence,
        "restrained",
        ["dignified", "restrained", "solemn"],
        "A quiet, understated register befitting the occasion."
      );
      assert.equal(budget, "none");

      // Without the tone signal, the same rich-evidence trust-authority
      // business stops at the mode ceiling alone ("subtle") — isolating
      // exactly what the tone check itself is contributing.
      const withoutTone = resolveMotionBudget("trust-authority", richButSomberEvidence, "restrained");
      assert.equal(withoutTone, "subtle");
    });

    test("a rich-evidence, non-restrained-mode business whose real voice is genuinely restrained is still pulled down a tier (the mechanism's real, legitimate job, preserved)", () => {
      const richEvidence: ExperiencePlanEvidenceDensity = {
        services: 3,
        certifications: 1,
        hasReviews: false,
        galleryCount: 0,
        hasRealTeam: false,
      };
      const withoutPersonality = resolveMotionBudget("warm-local-business", richEvidence, "energetic");
      const withGenuinelyRestrainedPersonality = resolveMotionBudget("warm-local-business", richEvidence, "energetic", ["quiet", "understated"]);
      assert.equal(withoutPersonality, "enhanced");
      assert.equal(withGenuinelyRestrainedPersonality, "subtle");
    });
  });
});

// ===========================================================================
// Validation targets — the four contrasting business profiles named in the
// Phase 6 directive. Each fixture reflects only real, already-available
// pipeline evidence (the same shape generateWireframe already gathers for
// resolveCompositionVariant, plus hasRealTeam) — never invented data.
// ===========================================================================

describe("experience-planner: resolveExperiencePlan — validation targets", () => {
  const photographyRichRestaurant = resolveExperiencePlan({
    industryBucket: "restaurant",
    heroPattern: "centered-cinematic",
    evidence: { services: 4, certifications: 0, hasReviews: true, galleryCount: 8, hasRealTeam: false },
    motionIntensity: "energetic",
  });

  const professionalServices = resolveExperiencePlan({
    industryBucket: "lawFirm",
    heroPattern: "editorial-typographic",
    evidence: { services: 2, certifications: 2, hasReviews: true, galleryCount: 0, hasRealTeam: true },
    motionIntensity: "restrained",
  });

  const retailProduct = resolveExperiencePlan({
    industryBucket: "homeService",
    heroPattern: "image-full-bleed",
    evidence: { services: 5, certifications: 0, hasReviews: false, galleryCount: 6, hasRealTeam: false },
    motionIntensity: "energetic",
  });

  const sparseLocalBusiness = resolveExperiencePlan({
    industryBucket: "general",
    heroPattern: "editorial-typographic",
    evidence: { services: 1, certifications: 0, hasReviews: false, galleryCount: 0, hasRealTeam: false },
    motionIntensity: "restrained",
  });

  test("mode differs across all four contrasting business profiles", () => {
    const modes = [photographyRichRestaurant.mode, professionalServices.mode, retailProduct.mode, sparseLocalBusiness.mode];
    assert.equal(new Set(modes).size, 4, `Expected 4 distinct modes, got: ${modes.join(", ")}`);
  });

  test("motion budget differs appropriately across all four profiles", () => {
    const budgets = [
      photographyRichRestaurant.motionBudget,
      professionalServices.motionBudget,
      retailProduct.motionBudget,
      sparseLocalBusiness.motionBudget,
    ];
    assert.equal(new Set(budgets).size, 4, `Expected 4 distinct motion budgets, got: ${budgets.join(", ")}`);
  });

  test("the sparse local business does not receive cinematic treatment without evidence", () => {
    assert.notEqual(sparseLocalBusiness.mode, "cinematic-storytelling");
    assert.notEqual(sparseLocalBusiness.mode, "product-showcase");
    assert.notEqual(sparseLocalBusiness.mode, "interactive-showcase");
    assert.equal(sparseLocalBusiness.motionBudget, "none");
  });

  test("professional services does not inherit retail/restaurant behavior", () => {
    assert.equal(professionalServices.mode, "trust-authority");
    assert.notEqual(professionalServices.mode, photographyRichRestaurant.mode);
    assert.notEqual(professionalServices.mode, retailProduct.mode);
    // Even though this fixture's own evidence (real team + certifications + reviews) is
    // rich enough to justify a "cinematic" evidence ceiling in isolation, trust-authority's
    // own register ceiling holds the budget to "subtle" — proof the mode governs, not raw
    // evidence richness alone.
    assert.equal(professionalServices.motionBudget, "subtle");
  });

  test("the photography-rich restaurant reaches the top of the motion range, backed by real evidence", () => {
    assert.equal(photographyRichRestaurant.mode, "cinematic-storytelling");
    assert.equal(photographyRichRestaurant.motionBudget, "cinematic");
  });

  test("every plan remains consistent with the already-resolved hero pattern — no plan claims a photo-dependent mode without a photo-backed hero pattern", () => {
    for (const plan of [photographyRichRestaurant, professionalServices, retailProduct, sparseLocalBusiness]) {
      if (["cinematic-storytelling", "product-showcase", "interactive-showcase"].includes(plan.mode)) {
        assert.ok(plan.rationale.length > 0);
      }
    }
    // Direct check for the two fixtures whose hero pattern is non-photo — neither may have landed on a photo-dependent mode.
    assert.ok(!["cinematic-storytelling", "product-showcase", "interactive-showcase"].includes(professionalServices.mode));
    assert.ok(!["cinematic-storytelling", "product-showcase", "interactive-showcase"].includes(sparseLocalBusiness.mode));
  });

  test("every plan carries a non-empty, evidence-grounded rationale", () => {
    for (const plan of [photographyRichRestaurant, professionalServices, retailProduct, sparseLocalBusiness]) {
      assert.ok(plan.rationale.trim().length > 0, "rationale must not be blank");
      assert.ok(plan.rationale.includes(plan.mode), "rationale should name the chosen mode");
      assert.ok(plan.rationale.includes(plan.motionBudget), "rationale should name the chosen motion budget");
    }
    assert.ok(photographyRichRestaurant.rationale.includes("8 real photo"), "restaurant rationale should cite its real gallery count");
    assert.ok(professionalServices.rationale.includes("real team/staff content"), "law firm rationale should cite its real team evidence");
    assert.ok(sparseLocalBusiness.rationale.includes("1 real service/offering"), "sparse-business rationale should cite its one real service, not invent richer evidence");
  });

  test("resolveExperiencePlan never throws and always returns a complete plan for every IndustryBucket", () => {
    const buckets = ["restaurant", "lawFirm", "homeService", "dentistMedical", "realEstate", "fitness", "luxuryServices", "general"] as const;
    for (const bucket of buckets) {
      const plan = resolveExperiencePlan({
        industryBucket: bucket,
        heroPattern: "editorial-typographic",
        evidence: NO_EVIDENCE,
        motionIntensity: "restrained",
      });
      assert.ok(plan.mode);
      assert.ok(plan.motionBudget);
      assert.ok(plan.rationale.length > 0);
    }
  });
});

// ===========================================================================
// Phase 6.4 — Human-in-the-Loop Experience Refinement. Reuses the SAME four
// contrasting fixture recipes above (never invented new evidence shapes) so
// these tests prove the human-preference nudge behaves correctly against the
// same real profiles already validated for mode/motion-budget resolution.
// ===========================================================================

describe("experience-planner: computeMotionBudgetCeiling", () => {
  test("returns the minimum of mode/evidence/intensity ceilings, with no personality or human nudge applied", () => {
    const rich: ExperiencePlanEvidenceDensity = {
      services: 5,
      certifications: 3,
      hasReviews: true,
      galleryCount: 10,
      hasRealTeam: true,
    };
    // trust-authority's own register ceiling ("subtle") governs even though evidence/intensity would allow more.
    assert.equal(computeMotionBudgetCeiling("trust-authority", rich, "energetic"), "subtle");
    // Thin evidence caps a rich-register mode down to "none".
    assert.equal(computeMotionBudgetCeiling("cinematic-storytelling", NO_EVIDENCE, "energetic"), "none");
    // A restrained disclosed intensity caps a rich-register, rich-evidence combination at "subtle".
    assert.equal(computeMotionBudgetCeiling("cinematic-storytelling", rich, "restrained"), "subtle");
  });

  test("matches resolveMotionBudget's own result when no personality or human preference is supplied", () => {
    const moderate: ExperiencePlanEvidenceDensity = {
      services: 3,
      certifications: 1,
      hasReviews: false,
      galleryCount: 0,
      hasRealTeam: false,
    };
    const ceiling = computeMotionBudgetCeiling("warm-local-business", moderate, "energetic");
    const budget = resolveMotionBudget("warm-local-business", moderate, "energetic");
    assert.equal(budget, ceiling);
  });
});

describe("experience-planner: resolveMotionBudget with humanPreference — bounded nudge, never a bypass", () => {
  const lawFirmEvidence: ExperiencePlanEvidenceDensity = {
    services: 2,
    certifications: 2,
    hasReviews: true,
    galleryCount: 0,
    hasRealTeam: true,
  };
  const sparseEvidence: ExperiencePlanEvidenceDensity = {
    services: 1,
    certifications: 0,
    hasReviews: false,
    galleryCount: 0,
    hasRealTeam: false,
  };
  const richEvidence: ExperiencePlanEvidenceDensity = {
    services: 4,
    certifications: 0,
    hasReviews: true,
    galleryCount: 8,
    hasRealTeam: false,
  };

  test("a trust-authority law firm cannot be pushed past its 'subtle' mode ceiling, even requesting more on both axes simultaneously", () => {
    const bothMore: HumanExperiencePreference = { energy: "more-energetic", motion: "more" };
    const budget = resolveMotionBudget("trust-authority", lawFirmEvidence, "restrained", undefined, undefined, bothMore);
    assert.equal(budget, "subtle");
    assert.equal(computeMotionBudgetCeiling("trust-authority", lawFirmEvidence, "restrained"), "subtle");
  });

  test("repeating a 'more' request does not accumulate past the ceiling — resolving twice in a row from the same baseline yields the same capped result", () => {
    const more: HumanExperiencePreference = { energy: "more-energetic", motion: "more" };
    const first = resolveMotionBudget("trust-authority", lawFirmEvidence, "restrained", undefined, undefined, more);
    const second = resolveMotionBudget("trust-authority", lawFirmEvidence, "restrained", undefined, undefined, more);
    assert.equal(first, "subtle");
    assert.equal(second, "subtle");
  });

  test("a sparse business capped at 'none' by evidence alone cannot be moved off 'none' by any preference combination", () => {
    const combinations: HumanExperiencePreference[] = [
      { energy: "more-energetic", motion: "more" },
      { energy: "more-energetic", motion: "recommended" },
      { energy: "keep", motion: "more" },
      { energy: "calmer", motion: "more" },
    ];
    for (const preference of combinations) {
      const budget = resolveMotionBudget("editorial-storytelling", sparseEvidence, "restrained", undefined, undefined, preference);
      assert.equal(budget, "none", `preference ${JSON.stringify(preference)} must not move a "none"-ceiling business off "none"`);
    }
  });

  test("'calmer'/'less' can always pull the budget down to the floor, unconditionally reachable regardless of mode/evidence richness", () => {
    const bothLess: HumanExperiencePreference = { energy: "calmer", motion: "less" };
    // Starts at "cinematic" (the top of the range) — two independent down-nudges should land at "subtle" (cinematic -> enhanced -> subtle is 2 steps; energy and motion are independent axes stacking).
    const budget = resolveMotionBudget("cinematic-storytelling", richEvidence, "energetic", undefined, undefined, bothLess);
    assert.equal(budget, "subtle");
  });

  test("the neutral preference (keep/recommended) resolves to exactly the same budget as no preference at all", () => {
    const withoutPreference = resolveMotionBudget("warm-local-business", richEvidence, "energetic");
    const withNeutralPreference = resolveMotionBudget(
      "warm-local-business",
      richEvidence,
      "energetic",
      undefined,
      undefined,
      NEUTRAL_EXPERIENCE_PREFERENCE
    );
    assert.equal(withNeutralPreference, withoutPreference);
  });

  test("energy and motion axes are independent and compose onto the same rank", () => {
    const energyOnly = resolveMotionBudget("warm-local-business", richEvidence, "restrained", undefined, undefined, {
      energy: "calmer",
      motion: "recommended",
    });
    const motionOnly = resolveMotionBudget("warm-local-business", richEvidence, "restrained", undefined, undefined, {
      energy: "keep",
      motion: "less",
    });
    const both = resolveMotionBudget("warm-local-business", richEvidence, "restrained", undefined, undefined, {
      energy: "calmer",
      motion: "less",
    });
    // Both axes requesting "down" should pull the rank down further than either alone (or reach the same floor).
    const rankOf: Record<string, number> = { none: 0, subtle: 1, enhanced: 2, cinematic: 3 };
    assert.ok(rankOf[both] <= rankOf[energyOnly]);
    assert.ok(rankOf[both] <= rankOf[motionOnly]);
  });
});

describe("experience-planner: resolveExperiencePlan with humanPreference — mode is never influenced", () => {
  test("mode stays identical regardless of any human preference — only motionBudget and rationale may change", () => {
    const baseInput = {
      industryBucket: "lawFirm" as const,
      heroPattern: "editorial-typographic" as const,
      evidence: { services: 2, certifications: 2, hasReviews: true, galleryCount: 0, hasRealTeam: true },
      motionIntensity: "restrained" as const,
    };
    const baseline = resolveExperiencePlan(baseInput);
    const withMorePreference = resolveExperiencePlan({
      ...baseInput,
      humanPreference: { energy: "more-energetic", motion: "more" },
    });
    const withLessPreference = resolveExperiencePlan({
      ...baseInput,
      humanPreference: { energy: "calmer", motion: "less" },
    });
    assert.equal(withMorePreference.mode, baseline.mode);
    assert.equal(withLessPreference.mode, baseline.mode);
  });

  test("rationale honestly reports a capped 'more' request without pretending it was fully granted", () => {
    const plan = resolveExperiencePlan({
      industryBucket: "lawFirm",
      heroPattern: "editorial-typographic",
      evidence: { services: 2, certifications: 2, hasReviews: true, galleryCount: 0, hasRealTeam: true },
      motionIntensity: "restrained",
      humanPreference: { energy: "more-energetic", motion: "more" },
    });
    assert.equal(plan.motionBudget, "subtle");
    assert.ok(
      /could not go further|real ceiling/.test(plan.rationale),
      `rationale should honestly describe the request as capped, got: ${plan.rationale}`
    );
  });

  test("rationale reports a fully-honored 'less' request as an adjustment, not a denial", () => {
    const plan = resolveExperiencePlan({
      industryBucket: "restaurant",
      heroPattern: "centered-cinematic",
      evidence: { services: 4, certifications: 0, hasReviews: true, galleryCount: 8, hasRealTeam: false },
      motionIntensity: "energetic",
      humanPreference: { energy: "calmer", motion: "recommended" },
    });
    assert.equal(plan.mode, "cinematic-storytelling");
    assert.notEqual(plan.motionBudget, "cinematic");
    assert.ok(plan.rationale.includes("Adjusted per a founder's stated preference"));
  });

  test("rationale reports the neutral preference as 'no change requested'", () => {
    const plan = resolveExperiencePlan({
      industryBucket: "restaurant",
      heroPattern: "centered-cinematic",
      evidence: { services: 4, certifications: 0, hasReviews: true, galleryCount: 8, hasRealTeam: false },
      motionIntensity: "energetic",
      humanPreference: NEUTRAL_EXPERIENCE_PREFERENCE,
    });
    assert.ok(plan.rationale.includes("No change requested"));
  });

  test("absent humanPreference produces byte-identical output to the pre-Phase-6.4 call shape (no regression for normal generation-time calls)", () => {
    const input = {
      industryBucket: "homeService" as const,
      heroPattern: "image-full-bleed" as const,
      evidence: { services: 5, certifications: 0, hasReviews: false, galleryCount: 6, hasRealTeam: false },
      motionIntensity: "energetic" as const,
    };
    const withoutField = resolveExperiencePlan(input);
    const withUndefinedField = resolveExperiencePlan({ ...input, humanPreference: undefined });
    assert.deepEqual(withoutField, withUndefinedField);
  });
});
