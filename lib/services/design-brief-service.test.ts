import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildCitations,
  findWeakestMeasuredCategory,
  applyDesignBriefEdits,
  type DesignBrief,
} from "@/lib/services/design-brief-service";
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

describe("design-brief-service: buildCitations", () => {
  test("cites real insights when they exist", () => {
    const citations = buildCitations(POOR_ANALYSIS, SOME_INSIGHTS);
    assert.equal(citations.length, 2);
    assert.ok(citations.every((c) => !!c.insightId));
  });

  test("falls back to citing measured Normalized Analysis scores when there are no insights", () => {
    const citations = buildCitations(CLEAN_ANALYSIS, []);
    assert.ok(citations.length > 0);
    assert.ok(citations.every((c) => c.insightId === undefined));
    assert.ok(citations.every((c) => c.statement.includes("/100")));
  });

  test("returns an empty array when there are no insights and nothing measured", () => {
    const emptyAnalysis: NormalizedAnalysis = {
      ...CLEAN_ANALYSIS,
      accessibilityScore: null as unknown as number,
      seoScore: null as unknown as number,
      mobileScore: null as unknown as number,
      technicalHealthScore: null as unknown as number,
      lighthouse: { performance: null, accessibility: null, bestPractices: null, seo: null },
    };
    assert.deepEqual(buildCitations(emptyAnalysis, []), []);
  });
});

describe("design-brief-service: findWeakestMeasuredCategory", () => {
  test("finds the lowest-scoring measured category", () => {
    const weakest = findWeakestMeasuredCategory(POOR_ANALYSIS);
    assert.equal(weakest?.category, "performance");
    assert.equal(weakest?.score, 25);
  });

  test("returns null when nothing is measured", () => {
    const emptyAnalysis: NormalizedAnalysis = {
      ...CLEAN_ANALYSIS,
      accessibilityScore: null as unknown as number,
      seoScore: null as unknown as number,
      mobileScore: null as unknown as number,
      technicalHealthScore: null as unknown as number,
      lighthouse: { performance: null, accessibility: null, bestPractices: null, seo: null },
    };
    assert.equal(findWeakestMeasuredCategory(emptyAnalysis), null);
  });
});

function fixtureBrief(overrides: Partial<DesignBrief> = {}): DesignBrief {
  return {
    missionId: "mission-1",
    businessName: "Acme Law",
    websiteUrl: "https://acme-law.test",
    industry: "Law Firm",
    industryBucket: "lawFirm",
    citedInsights: [{ category: "performance", insightId: "slow-page-load", statement: "Pages load slowly." }],
    targetAudience: "Prospective clients evaluating credibility.",
    positioning: "Lead with credibility and outcomes.",
    direction: {
      layoutFamily: "credibility-led",
      typographicMood: "measured serif",
      colorDirection: "deep calm neutrals",
      motionIntensity: "restrained",
    },
    referencesConsidered: [{ referenceId: "lawfirm-credibility-led", reasoning: "Informed by ... — not structurally copied (§8)." }],
    ...overrides,
  };
}

describe("design-brief-service: applyDesignBriefEdits (Founder Approval Gate)", () => {
  test("returns the brief unchanged and wasEdited: false when no edits are supplied", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief);
    assert.deepEqual(result.brief, brief);
    assert.equal(result.wasEdited, false);
  });

  test("returns the brief unchanged and wasEdited: false for an empty edits object", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief, {});
    assert.deepEqual(result.brief, brief);
    assert.equal(result.wasEdited, false);
  });

  test("overrides targetAudience and positioning when supplied", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief, {
      targetAudience: "Custom audience the founder typed in",
      positioning: "Custom positioning override",
    });
    assert.equal(result.wasEdited, true);
    assert.equal(result.brief.targetAudience, "Custom audience the founder typed in");
    assert.equal(result.brief.positioning, "Custom positioning override");
  });

  test("merges partial direction edits without discarding untouched direction fields", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief, { direction: { typographicMood: "bolder serif" } });
    assert.equal(result.brief.direction.typographicMood, "bolder serif");
    assert.equal(result.brief.direction.layoutFamily, brief.direction.layoutFamily);
    assert.equal(result.brief.direction.colorDirection, brief.direction.colorDirection);
  });

  test("never touches citedInsights or referencesConsidered — those are not editable", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief, { targetAudience: "Something else" });
    assert.deepEqual(result.brief.citedInsights, brief.citedInsights);
    assert.deepEqual(result.brief.referencesConsidered, brief.referencesConsidered);
  });
});
