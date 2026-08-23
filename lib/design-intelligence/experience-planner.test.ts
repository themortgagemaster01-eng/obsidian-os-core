import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolveExperienceMode,
  resolveMotionBudget,
  resolveExperiencePlan,
  type ExperiencePlanEvidenceDensity,
} from "@/lib/design-intelligence/experience-planner";

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
