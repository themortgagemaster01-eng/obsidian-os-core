import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assembleOpportunityReport } from "@/lib/services/opportunity-report-service";
import { generateInsights } from "@/lib/services/insight-service";
import { computeOpportunityScore } from "@/lib/services/opportunity-scoring-service";
import type { NormalizedAnalysis } from "@/lib/services/analysis-types";

const BANNED_TERMS = [
  "lighthouse",
  "adapter",
  " h1",
  "viewport",
  "canonical",
  "json",
  "score:",
  "axe-core",
  "cheerio",
  "puppeteer",
];

function assertNoJargon(text: string, label: string) {
  const lower = text.toLowerCase();
  for (const term of BANNED_TERMS) {
    assert.ok(!lower.includes(term), `${label} leaked technical jargon "${term}": "${text}"`);
  }
}

const BAD_ANALYSIS: NormalizedAnalysis = {
  websiteUrl: "https://acme-plumbing.example",
  seoScore: 30,
  seoFindings: ["Missing <title> tag.", "Missing meta description.", "No H1 heading found."],
  mobileScore: 20,
  mobileFindings: ["No viewport meta tag found.", "No responsive breakpoints (media queries) detected."],
  accessibilityScore: 25,
  accessibilityFindings: [
    "[critical] Elements must have sufficient color contrast (4 element(s))",
    "[serious] Images must have alternate text (3 element(s))",
  ],
  technicalHealthScore: 40,
  technicalHealthFindings: ["No robots.txt file found.", "No sitemap.xml file found."],
  lighthouse: { performance: 35, accessibility: 40, bestPractices: 50, seo: 45 },
  technologyStack: ["WordPress"],
  measurementStatus: { crawl: true, mobile: true, seo: true, accessibility: true, lighthouse: true, techDetection: true },
};

const GOOD_ANALYSIS: NormalizedAnalysis = {
  websiteUrl: "https://acme-plumbing.example",
  seoScore: 95,
  seoFindings: [],
  mobileScore: 95,
  mobileFindings: [],
  accessibilityScore: 95,
  accessibilityFindings: [],
  technicalHealthScore: 95,
  technicalHealthFindings: [],
  lighthouse: { performance: 95, accessibility: 95, bestPractices: 95, seo: 95 },
  technologyStack: ["WordPress"],
  measurementStatus: { crawl: true, mobile: true, seo: true, accessibility: true, lighthouse: true, techDetection: true },
};

function buildReport(analysis: NormalizedAnalysis) {
  const insights = generateInsights(analysis);
  const scoreResult = computeOpportunityScore(analysis);
  return { report: assembleOpportunityReport(analysis, insights, scoreResult), insights, scoreResult };
}

describe("opportunity-report-service", () => {
  test("produces every §7 field", () => {
    const { report } = buildReport(BAD_ANALYSIS);
    assert.equal(typeof report.executiveSummary, "string");
    assert.ok(report.executiveSummary.length > 0);
    assert.ok("estimatedCustomerExperienceImpact" in report.businessOpportunity);
    assert.ok("estimatedLocalSeoImpact" in report.businessOpportunity);
    assert.ok("estimatedConversionImprovement" in report.businessOpportunity);
    assert.ok("estimatedBrandModernization" in report.businessOpportunity);
    assert.ok("potentialBusinessValue" in report.businessOpportunity);
    assert.ok("overall" in report.scores);
    assert.equal(report.findings.length, 5);
    assert.deepEqual(
      report.findings.map((f) => f.category),
      ["performance", "accessibility", "seo", "mobile", "technicalHealth"]
    );
    assert.deepEqual(report.technologyStack, ["WordPress"]);
    assert.ok(Array.isArray(report.evidence));
    assert.ok(Array.isArray(report.recommendations));
  });

  test("evidence has exactly one entry per insight, each with a claim and a source", () => {
    const { report, insights } = buildReport(BAD_ANALYSIS);
    assert.equal(report.evidence.length, insights.length);
    for (const entry of report.evidence) {
      assert.ok(entry.claim.length > 0);
      assert.ok(entry.source.length > 0);
    }
  });

  test("recommendations are sorted high severity first", () => {
    const { report } = buildReport(BAD_ANALYSIS);
    const order = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < report.recommendations.length; i++) {
      assert.ok(
        order[report.recommendations[i - 1].severity] <= order[report.recommendations[i].severity],
        "recommendations are not sorted by severity (high -> medium -> low)"
      );
    }
  });

  test("a category with no insights still reports a positive-empty finding, not an empty array", () => {
    const { report } = buildReport(GOOD_ANALYSIS);
    for (const finding of report.findings) {
      assert.ok(finding.statements.length > 0);
    }
  });

  test("an unmeasured category is reported as unmeasured, not silently as clean", () => {
    // Regression test for a real bug caught by the Phase 2 end-to-end demo:
    // a null performance score with no insights was rendering "No notable
    // issues were found" — indistinguishable from a genuinely good score —
    // instead of flagging that it couldn't be measured at all.
    const analysis: NormalizedAnalysis = {
      ...GOOD_ANALYSIS,
      lighthouse: { ...GOOD_ANALYSIS.lighthouse, performance: null },
    };
    const { report } = buildReport(analysis);
    const performanceFinding = report.findings.find((f) => f.category === "performance");
    assert.equal(performanceFinding?.score, null);
    assert.deepEqual(performanceFinding?.statements, [
      "This area couldn't be fully measured in this analysis.",
    ]);

    const seoFinding = report.findings.find((f) => f.category === "seo");
    assert.equal(seoFinding?.score, 95);
    assert.deepEqual(seoFinding?.statements, ["No notable issues were found in this area."]);
  });

  test("nothing customer-facing leaks adapter/tool names or raw technical jargon", () => {
    const { report } = buildReport(BAD_ANALYSIS);
    assertNoJargon(report.executiveSummary, "executiveSummary");
    for (const [key, value] of Object.entries(report.businessOpportunity)) {
      assertNoJargon(value, `businessOpportunity.${key}`);
    }
    for (const finding of report.findings) {
      for (const statement of finding.statements) {
        assertNoJargon(statement, `findings[${finding.category}].statements`);
      }
    }
    for (const rec of report.recommendations) {
      assertNoJargon(rec.title, "recommendations[].title");
      assertNoJargon(rec.detail, "recommendations[].detail");
    }
    // Evidence sources ARE allowed to name *which check* found something
    // (per §10, traceability is the whole point) but per the CTO note this
    // must still stay in plain language — no literal tool/vendor names.
    for (const entry of report.evidence) {
      assertNoJargon(entry.source, "evidence[].source");
    }
  });

  test("overall score in the report matches opportunity-scoring-service's output", () => {
    const { report, scoreResult } = buildReport(BAD_ANALYSIS);
    assert.equal(report.scores.overall, scoreResult.overallScore);
  });

  test("confidence is High across the board when every check succeeded", () => {
    const { report } = buildReport(GOOD_ANALYSIS);
    assert.equal(report.confidence.overall.level, "High");
    assert.equal(report.confidence.performance.level, "High");
    assert.equal(report.confidence.accessibility.level, "High");
    assert.equal(report.confidence.seo.level, "High");
    assert.equal(report.confidence.mobile.level, "High");
    assert.equal(report.confidence.technicalHealth.level, "High");
    assert.equal(report.confidence.businessOpportunity.level, "High");
    assert.equal(report.confidence.executiveSummary.level, "High");
    for (const entry of Object.values(report.confidence)) {
      assert.ok(entry.reason.length > 0);
    }
  });

  test("a category whose check failed reads Unavailable, not a confident-sounding score", () => {
    const analysis: NormalizedAnalysis = {
      ...GOOD_ANALYSIS,
      lighthouse: { performance: null, accessibility: null, bestPractices: null, seo: null },
      measurementStatus: {
        ...GOOD_ANALYSIS.measurementStatus,
        lighthouse: false,
        accessibility: false,
      },
    };
    const { report } = buildReport(analysis);
    assert.equal(report.confidence.performance.level, "Unavailable");
    assert.equal(report.confidence.accessibility.level, "Unavailable");
    // A category that WAS measured should be unaffected by another category's failure.
    assert.equal(report.confidence.seo.level, "High");
  });

  test("partial accessibility measurement (one of two checks) reads Medium, not High", () => {
    const analysis: NormalizedAnalysis = {
      ...GOOD_ANALYSIS,
      lighthouse: { ...GOOD_ANALYSIS.lighthouse, accessibility: null },
      measurementStatus: { ...GOOD_ANALYSIS.measurementStatus, lighthouse: false },
    };
    const { report } = buildReport(analysis);
    assert.equal(report.confidence.accessibility.level, "Medium");
  });

  test("overall confidence degrades as more categories become unavailable", () => {
    const oneDown: NormalizedAnalysis = {
      ...GOOD_ANALYSIS,
      lighthouse: { performance: null, accessibility: null, bestPractices: null, seo: null },
      measurementStatus: { ...GOOD_ANALYSIS.measurementStatus, lighthouse: false },
    };
    assert.equal(buildReport(oneDown).report.confidence.overall.level, "Medium");

    const threeDown: NormalizedAnalysis = {
      ...GOOD_ANALYSIS,
      lighthouse: { performance: null, accessibility: null, bestPractices: null, seo: null },
      measurementStatus: {
        ...GOOD_ANALYSIS.measurementStatus,
        lighthouse: false,
        accessibility: false,
        seo: false,
        crawl: false,
      },
    };
    assert.equal(buildReport(threeDown).report.confidence.overall.level, "Low");
  });

  test("confidence reasons don't leak technical/tool jargon either", () => {
    const { report } = buildReport(BAD_ANALYSIS);
    for (const [key, entry] of Object.entries(report.confidence)) {
      assertNoJargon(entry.reason, `confidence.${key}.reason`);
    }
  });
});
