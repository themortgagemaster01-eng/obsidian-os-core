import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeOpportunityScore,
  scoreForCategory,
  EQUAL_CATEGORY_WEIGHT,
} from "@/lib/services/opportunity-scoring-service";
import type { NormalizedAnalysis } from "@/lib/services/analysis-types";

const BASE: NormalizedAnalysis = {
  websiteUrl: "https://example.com",
  seoScore: 80,
  seoFindings: [],
  mobileScore: 60,
  mobileFindings: [],
  accessibilityScore: 70,
  accessibilityFindings: [],
  technicalHealthScore: 90,
  technicalHealthFindings: [],
  lighthouse: { performance: 40, accessibility: 50, bestPractices: 60, seo: 70 },
  technologyStack: [],
  measurementStatus: { crawl: true, mobile: true, seo: true, accessibility: true, lighthouse: true, techDetection: true },
  contactEvidence: { phones: [], emails: [], address: null, hours: null },
};

describe("opportunity-scoring-service", () => {
  test("equal weighting is 20% per category", () => {
    assert.equal(EQUAL_CATEGORY_WEIGHT, 0.2);
  });

  test("computes the overall score as an equal-weighted average of the five categories", () => {
    const result = computeOpportunityScore(BASE);
    // performance = 40 (lighthouse.performance)
    // accessibility = round(avg(70, 50)) = 60
    // seo = 80
    // mobile = 60
    // technicalHealth = 90
    // overall = round(avg(40, 60, 80, 60, 90)) = round(66) = 66
    assert.equal(result.overallScore, 66);
    assert.equal(result.categories.length, 5);
    assert.deepEqual(result.excludedCategories, []);
    for (const c of result.categories) {
      assert.equal(c.weight, EQUAL_CATEGORY_WEIGHT);
    }
  });

  test("blends accessibility from the accessibility score and lighthouse accessibility", () => {
    const result = computeOpportunityScore(BASE);
    assert.equal(scoreForCategory(result, "accessibility"), 60);
  });

  test("excludes an unmeasured category and renormalizes the remaining weights", () => {
    const analysis: NormalizedAnalysis = {
      ...BASE,
      lighthouse: { ...BASE.lighthouse, performance: null },
    };
    const result = computeOpportunityScore(analysis);
    assert.deepEqual(result.excludedCategories, ["performance"]);
    const perfCategory = result.categories.find((c) => c.category === "performance");
    assert.equal(perfCategory?.score, null);
    assert.equal(perfCategory?.weight, 0);

    // Remaining 4 categories should each carry 25% weight, not 20%.
    const seoCategory = result.categories.find((c) => c.category === "seo");
    assert.equal(seoCategory?.weight, 0.25);

    // overall = round(avg(60, 80, 60, 90)) = round(72.5) = 73 (banker's/half-up per Math.round)
    assert.equal(result.overallScore, 73);
  });

  test("accessibility is never excluded, even when its Lighthouse half is null", () => {
    // accessibilityScore is a real number by type (never null) — it's one
    // of the Accessibility category's two blended inputs, so the blend
    // always has at least that one input and can never resolve to null,
    // even when lighthouse.accessibility itself is unavailable.
    const analysis: NormalizedAnalysis = {
      ...BASE,
      lighthouse: { ...BASE.lighthouse, accessibility: null },
    };
    const result = computeOpportunityScore(analysis);
    assert.equal(scoreForCategory(result, "accessibility"), BASE.accessibilityScore);
    assert.ok(!result.excludedCategories.includes("accessibility"));
  });

  test("a real, honestly-measured 0 (not a failed check) across mobile/seo/accessibility is scored, never excluded", () => {
    // Distinct from the fetchError/null regression tests below: these are
    // real zeros (e.g. a genuinely maxed-out penalty, or robots noindex),
    // not an unmeasured check — technicalHealthScore is likewise never
    // null. Only an unmeasured Performance score is excluded here.
    const analysis: NormalizedAnalysis = {
      ...BASE,
      accessibilityScore: 0,
      seoScore: 0,
      mobileScore: 0,
      technicalHealthScore: 0,
      lighthouse: { performance: null, accessibility: null, bestPractices: null, seo: null },
    };
    const result = computeOpportunityScore(analysis);
    assert.notEqual(result.overallScore, null);
    assert.deepEqual(result.excludedCategories, ["performance"]);
  });

  // ===========================================================================
  // Bug fix — real production incident confirmed live on the Dante's
  // Trattoria mission: mobile/seo/accessibility's own normalizers used to
  // collapse a total adapter failure to a fake 0 rather than null, so this
  // exclusion/renormalization path could never trigger for them — a failed
  // accessibility-adapter Chrome launch fed a fake 0 into the accessibility
  // blend alongside a real Lighthouse-measured 87, producing a wrong ~44
  // instead of correctly using 87 directly. analysis-service.ts's three
  // normalizers now return null on a failed check (analysis-service.test.ts
  // covers that directly); these tests prove the fix all the way through
  // computeOpportunityScore, using the exact real numbers from that mission.
  // ===========================================================================
  test("Fix: an unmeasured accessibility check (null, not a fake 0) is excluded from the blend — uses the real Lighthouse half directly instead of averaging in a fake zero", () => {
    const analysis: NormalizedAnalysis = {
      ...BASE,
      accessibilityScore: null, // the accessibility-adapter's own Chrome launch failed
      lighthouse: { ...BASE.lighthouse, accessibility: 87 }, // Lighthouse's own launch succeeded — Dante's Trattoria's real number
    };
    const result = computeOpportunityScore(analysis);
    assert.equal(scoreForCategory(result, "accessibility"), 87, "should use the real 87 directly, not a wrong blend with a fake 0");
    assert.deepEqual(result.excludedCategories, []);
  });

  test("Fix: mobile/seo/accessibility can now all be genuinely excluded when unmeasured, not just Performance", () => {
    const analysis: NormalizedAnalysis = {
      ...BASE,
      accessibilityScore: null,
      seoScore: null,
      mobileScore: null,
      lighthouse: { performance: 40, accessibility: null, bestPractices: 60, seo: 70 },
    };
    const result = computeOpportunityScore(analysis);
    assert.deepEqual(result.excludedCategories.sort(), ["accessibility", "mobile", "seo"]);
    // Only performance (40) and technicalHealth (90) remain measured.
    assert.equal(result.overallScore, 65);
  });

  test("scoreForCategory returns null for a category not present", () => {
    const result = computeOpportunityScore(BASE);
    // @ts-expect-error - deliberately querying a bogus category to confirm the lookup is safe.
    assert.equal(scoreForCategory(result, "notACategory"), null);
  });
});
