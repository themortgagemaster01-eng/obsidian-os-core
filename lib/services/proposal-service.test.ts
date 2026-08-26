import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assembleProposalContent, type AssembleProposalContentInput } from "@/lib/services/proposal-service";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";
import type { DesignQaReport, QaCategoryId, QaCategoryReport } from "@/lib/services/design-qa-service";

const CONFIDENCE_ENTRY = { level: "High" as const, reason: "test" };

function buildReport(overrides: Partial<OpportunityReport> = {}): OpportunityReport {
  return {
    executiveSummary: "The current site loads slowly and has several accessibility gaps.",
    businessOpportunity: {
      estimatedCustomerExperienceImpact: "Meaningful — faster, clearer navigation.",
      estimatedLocalSeoImpact: "Meaningful — missing structured data today.",
      estimatedConversionImprovement: "Moderate — no clear call to action currently.",
      estimatedBrandModernization: "High — the current design reads as dated.",
      potentialBusinessValue: "A modernized site could meaningfully improve first impressions.",
    },
    scores: { overall: 62, performance: 55, accessibility: 60, seo: 70, mobile: 58, technicalHealth: 65 },
    findings: [
      { category: "performance", score: 55, statements: ["Largest Contentful Paint is slow on mobile."] },
      { category: "accessibility", score: 60, statements: ["Several images are missing alt text."] },
    ],
    technologyStack: ["WordPress"],
    evidence: [{ claim: "Slow mobile load", source: "Lighthouse" }],
    recommendations: [
      { title: "Improve mobile load time", detail: "Compress images and defer non-critical scripts.", severity: "high" },
      { title: "Add missing alt text", detail: "Several real images have no alt text today.", severity: "medium" },
    ],
    executiveConclusion: "This business has real, evidenced room for a modernized, faster website.",
    confidence: {
      overall: CONFIDENCE_ENTRY,
      performance: CONFIDENCE_ENTRY,
      accessibility: CONFIDENCE_ENTRY,
      seo: CONFIDENCE_ENTRY,
      mobile: CONFIDENCE_ENTRY,
      technicalHealth: CONFIDENCE_ENTRY,
      businessOpportunity: CONFIDENCE_ENTRY,
      executiveSummary: CONFIDENCE_ENTRY,
    },
    ...overrides,
  };
}

function buildQaCategoryResult(verdict: "PASS" | "WARN" | "FAIL"): QaCategoryReport {
  return {
    category: "typography",
    deterministic: { verdict, confidence: "High", evidenceSource: "structured", findings: [], evidence: [] },
  };
}

function buildQaReport(verdicts: Partial<Record<QaCategoryId, "PASS" | "WARN" | "FAIL" | "UNAVAILABLE">> = {}): DesignQaReport {
  const categoryIds: QaCategoryId[] = [
    "typography", "spacing", "layout", "motion", "mobile", "accessibility",
    "performance", "trust", "conversion", "brandFit", "genericTemplate", "narrativeConsistency",
  ];
  const categories = {} as Record<QaCategoryId, QaCategoryReport>;
  for (const id of categoryIds) {
    const verdict = verdicts[id] ?? "PASS";
    categories[id] = { category: id, deterministic: { verdict, confidence: "High", evidenceSource: "structured", findings: [], evidence: [] } };
  }
  return {
    missionId: "mission-1",
    websiteDesignId: "design-1",
    businessName: "Acme Co",
    generatedAt: new Date().toISOString(),
    categories,
    overallVerdict: "PASS",
    renderedQaAvailable: false,
  };
}

function buildInput(overrides: Partial<AssembleProposalContentInput> = {}): AssembleProposalContentInput {
  return {
    businessName: "Acme Restaurant",
    websiteUrl: "https://acme-restaurant.test",
    missionId: "mission-1",
    report: buildReport(),
    qaReport: buildQaReport(),
    businessIntelligence: null,
    ...overrides,
  };
}

describe("proposal-service: assembleProposalContent", () => {
  test("assembles real business identity, demo URL, and QA summary from the given inputs", () => {
    const content = assembleProposalContent(buildInput());
    assert.equal(content.businessName, "Acme Restaurant");
    assert.equal(content.websiteUrl, "https://acme-restaurant.test");
    assert.equal(content.demoUrl, "/missions/mission-1/preview");
    assert.equal(content.qaSummary.overallVerdict, "PASS");
    assert.equal(content.qaSummary.totalCategories, 12);
    assert.equal(content.qaSummary.passedCategories, 12);
  });

  test("currentWebsiteObservations includes the executive summary and every finding statement, never fabricated", () => {
    const content = assembleProposalContent(buildInput());
    assert.ok(content.currentWebsiteObservations.includes("The current site loads slowly and has several accessibility gaps."));
    assert.ok(content.currentWebsiteObservations.includes("Largest Contentful Paint is slow on mobile."));
    assert.ok(content.currentWebsiteObservations.includes("Several images are missing alt text."));
  });

  test("keyOpportunities is a direct, unmodified pass-through of OpportunityReport.recommendations", () => {
    const input = buildInput();
    const content = assembleProposalContent(input);
    assert.deepEqual(content.keyOpportunities, input.report.recommendations);
  });

  test("whyQualified is honestly empty when this mission did not originate from a promoted lead", () => {
    const content = assembleProposalContent(buildInput({ businessIntelligence: null }));
    assert.deepEqual(content.whyQualified, []);
  });

  test("whyQualified reuses the real qualification evidence when this mission came from a promoted lead", () => {
    const content = assembleProposalContent(
      buildInput({ businessIntelligence: { opportunityReasons: ["Real, evidenced weak mobile experience.", "No structured review data captured yet."] } })
    );
    assert.deepEqual(content.whyQualified, ["Real, evidenced weak mobile experience.", "No structured review data captured yet."]);
  });

  test("valueProposition combines the executive conclusion and the potential business value, never invents new text", () => {
    const content = assembleProposalContent(buildInput());
    assert.ok(content.valueProposition.includes("real, evidenced room for a modernized"));
    assert.ok(content.valueProposition.includes("meaningfully improve first impressions"));
  });

  test("qaSummary correctly counts a mixed PASS/WARN/FAIL report", () => {
    const content = assembleProposalContent(
      buildInput({ qaReport: buildQaReport({ motion: "WARN", trust: "FAIL" }) })
    );
    assert.equal(content.qaSummary.passedCategories, 10);
    assert.equal(content.qaSummary.totalCategories, 12);
  });

  test("proposedNextStep is a fixed, business-agnostic instruction, never a fabricated claim about this specific business", () => {
    const content = assembleProposalContent(buildInput());
    assert.equal(content.proposedNextStep, "Review the attached demo and QA results, then reply to schedule a short call to discuss next steps.");
  });
});
