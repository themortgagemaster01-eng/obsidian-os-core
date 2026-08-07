import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildDesignBrief, type BuildDesignBriefInput } from "@/lib/services/design-brief-service";
import type { NormalizedAnalysis } from "@/lib/services/analysis-types";
import type { Insight } from "@/lib/services/insight-service";

const CLEAN_ANALYSIS: NormalizedAnalysis = {
  websiteUrl: "https://example.com",
  seoScore: 92,
  seoFindings: [],
  mobileScore: 95,
  mobileFindings: [],
  accessibilityScore: 90,
  accessibilityFindings: [],
  technicalHealthScore: 95,
  technicalHealthFindings: [],
  lighthouse: { performance: 91, accessibility: 90, bestPractices: 95, seo: 92 },
  technologyStack: [],
  measurementStatus: { crawl: true, mobile: true, seo: true, accessibility: true, lighthouse: true, techDetection: true },
};

const POOR_ANALYSIS: NormalizedAnalysis = {
  ...CLEAN_ANALYSIS,
  seoScore: 40,
  mobileScore: 35,
  accessibilityScore: 50,
  technicalHealthScore: 60,
  lighthouse: { performance: 25, accessibility: 50, bestPractices: 60, seo: 40 },
};

const SOME_INSIGHTS: Insight[] = [
  { id: "slow-page-load", category: "performance", severity: "high", statement: "Pages load slowly.", source: "Page speed test" },
  { id: "mobile-experience-gap", category: "mobile", severity: "high", statement: "Mobile experience is rough.", source: "Mobile display check" },
];

function baseInput(overrides: Partial<BuildDesignBriefInput> = {}): BuildDesignBriefInput {
  return {
    missionId: "mission-1",
    businessName: "Katz's Delicatessen",
    websiteUrl: "https://example.com",
    industry: null,
    businessCategory: null,
    analysis: POOR_ANALYSIS,
    insights: SOME_INSIGHTS,
    ...overrides,
  };
}

describe("design-brief-service", () => {
  test("cites real insights when they exist", () => {
    const brief = buildDesignBrief(baseInput());
    assert.equal(brief.citedInsights.length, 2);
    assert.ok(brief.citedInsights.every((c) => !!c.insightId));
  });

  test("falls back to citing measured Normalized Analysis scores when there are no insights", () => {
    const brief = buildDesignBrief(baseInput({ analysis: CLEAN_ANALYSIS, insights: [] }));
    assert.ok(brief.citedInsights.length > 0);
    assert.ok(brief.citedInsights.every((c) => c.insightId === undefined));
    assert.ok(brief.citedInsights.every((c) => c.statement.includes("/100")));
  });

  test("resolves the industry bucket from freeform industry text", () => {
    const brief = buildDesignBrief(baseInput({ industry: "Italian Restaurant" }));
    assert.equal(brief.industryBucket, "restaurant");
    assert.equal(brief.direction.layoutFamily, "imagery-led");
  });

  test("falls back to the general bucket for unknown/null industry, never guessing a specific one", () => {
    const brief = buildDesignBrief(baseInput({ industry: null, businessCategory: "Widget Manufacturing" }));
    assert.equal(brief.industryBucket, "general");
    assert.equal(brief.direction.layoutFamily, "editorial");
  });

  test("motion intensity is 'energetic' only for the fitness bucket, 'restrained' otherwise", () => {
    const fitnessBrief = buildDesignBrief(baseInput({ industry: "Boutique Fitness Studio" }));
    assert.equal(fitnessBrief.direction.motionIntensity, "energetic");

    const lawBrief = buildDesignBrief(baseInput({ industry: "Law Firm" }));
    assert.equal(lawBrief.direction.motionIntensity, "restrained");
  });

  test("positioning cites the weakest measured category by name and score", () => {
    const brief = buildDesignBrief(baseInput({ analysis: POOR_ANALYSIS }));
    // POOR_ANALYSIS's weakest category is performance (lighthouse.performance = 25).
    assert.match(brief.positioning, /page speed/i);
    assert.match(brief.positioning, /25\/100/);
  });

  test("referencesConsidered includes every reference for the resolved bucket, cited as reasoning only", () => {
    const brief = buildDesignBrief(baseInput({ industry: "Law Firm" }));
    assert.ok(brief.referencesConsidered.length >= 2);
    for (const ref of brief.referencesConsidered) {
      assert.match(ref.reasoning, /not structurally copied/);
    }
  });

  test("targetAudience is drawn from the bucket-level lookup, not fabricated per business", () => {
    const brief = buildDesignBrief(baseInput({ industry: "Family Dental Clinic" }));
    assert.match(brief.targetAudience, /patients/i);
  });

  test("throws if there is truly nothing to cite (no insights and no measured categories)", () => {
    const emptyAnalysis: NormalizedAnalysis = {
      ...CLEAN_ANALYSIS,
      accessibilityScore: null as unknown as number,
      seoScore: null as unknown as number,
      mobileScore: null as unknown as number,
      technicalHealthScore: null as unknown as number,
      lighthouse: { performance: null, accessibility: null, bestPractices: null, seo: null },
    };
    assert.throws(
      () => buildDesignBrief(baseInput({ analysis: emptyAnalysis, insights: [] })),
      /shouldn't generate anything/
    );
  });

  test("preserves the mission/business identity fields verbatim", () => {
    const brief = buildDesignBrief(baseInput({ missionId: "m-42", businessName: "Acme", websiteUrl: "https://acme.test" }));
    assert.equal(brief.missionId, "m-42");
    assert.equal(brief.businessName, "Acme");
    assert.equal(brief.websiteUrl, "https://acme.test");
  });
});
