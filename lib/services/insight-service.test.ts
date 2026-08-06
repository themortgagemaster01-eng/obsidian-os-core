import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { generateInsights } from "@/lib/services/insight-service";
import type { NormalizedAnalysis } from "@/lib/services/analysis-types";

const BANNED_TERMS = [
  "lighthouse",
  "adapter",
  " h1",
  "viewport",
  "canonical",
  "json",
  "axe-core",
  "cheerio",
  "puppeteer",
];

function assertNoJargon(text: string) {
  const lower = text.toLowerCase();
  for (const term of BANNED_TERMS) {
    assert.ok(!lower.includes(term), `statement leaked technical jargon "${term}": "${text}"`);
  }
}

const GOOD_ANALYSIS: NormalizedAnalysis = {
  websiteUrl: "https://example.com",
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

const BAD_ANALYSIS: NormalizedAnalysis = {
  websiteUrl: "https://example.com",
  seoScore: 30,
  seoFindings: [
    "Missing <title> tag.",
    "Missing meta description.",
    "No H1 heading found.",
    "3 of 10 images are missing alt text.",
    "No canonical URL specified.",
    "No structured data (JSON-LD) found.",
    "No Open Graph tags found.",
  ],
  mobileScore: 20,
  mobileFindings: [
    "No viewport meta tag found.",
    "Viewport disables user zoom (user-scalable=no).",
    "No responsive breakpoints (media queries) detected.",
    "2 font-size declaration(s) under 12px found.",
  ],
  accessibilityScore: 25,
  accessibilityFindings: [
    "[critical] Elements must have sufficient color contrast (4 element(s))",
    "[serious] Images must have alternate text (3 element(s))",
    "[minor] Some minor issue (1 element(s))",
  ],
  technicalHealthScore: 40,
  technicalHealthFindings: [
    "Homepage returned HTTP status 500 instead of a normal success response.",
    "No robots.txt file found.",
    "No sitemap.xml file found.",
    "No internal links found on the homepage.",
  ],
  lighthouse: { performance: 35, accessibility: 40, bestPractices: 50, seo: 45 },
  technologyStack: [],
  measurementStatus: { crawl: true, mobile: true, seo: true, accessibility: true, lighthouse: true, techDetection: true },
};

describe("insight-service", () => {
  test("a clean, high-scoring site produces no insights", () => {
    const insights = generateInsights(GOOD_ANALYSIS);
    assert.deepEqual(insights, []);
  });

  test("a poor-scoring site produces insights across every category", () => {
    const insights = generateInsights(BAD_ANALYSIS);
    const categories = new Set(insights.map((i) => i.category));
    assert.ok(categories.has("performance"), "expected a performance insight");
    assert.ok(categories.has("mobile"), "expected a mobile insight");
    assert.ok(categories.has("seo"), "expected an seo insight");
    assert.ok(categories.has("accessibility"), "expected an accessibility insight");
    assert.ok(categories.has("technicalHealth"), "expected a technicalHealth insight");
    assert.ok(insights.length >= 10, `expected many insights, got ${insights.length}`);
  });

  test("every insight has a non-empty statement and a plain-language source", () => {
    const insights = generateInsights(BAD_ANALYSIS);
    for (const insight of insights) {
      assert.ok(insight.statement.length > 20, `statement too short: "${insight.statement}"`);
      assert.ok(insight.source.length > 0);
      assert.ok(insight.id.length > 0);
    }
  });

  test("no insight statement leaks technical/tool jargon", () => {
    const insights = generateInsights(BAD_ANALYSIS);
    for (const insight of insights) {
      assertNoJargon(insight.statement);
    }
  });

  test("no insight source names an adapter or vendor tool", () => {
    const insights = generateInsights(BAD_ANALYSIS);
    for (const insight of insights) {
      assertNoJargon(insight.source);
    }
  });

  test("the noindex finding produces a high-severity insight", () => {
    const analysis: NormalizedAnalysis = {
      ...GOOD_ANALYSIS,
      seoScore: 0,
      seoFindings: ["Page is marked noindex — excluded from search results."],
    };
    const insights = generateInsights(analysis);
    const noindexInsight = insights.find((i) => i.id === "site-hidden-from-search");
    assert.ok(noindexInsight, "expected a site-hidden-from-search insight");
    assert.equal(noindexInsight?.severity, "high");
  });

  test("critical/serious accessibility violations produce a high-impact insight with the correct count", () => {
    const insights = generateInsights(BAD_ANALYSIS);
    const highImpact = insights.find((i) => i.id === "accessibility-high-impact-issues");
    assert.ok(highImpact, "expected an accessibility-high-impact-issues insight");
    assert.match(highImpact!.statement, /^2 of the issues/);
  });

  test("an unmeasured performance score (null) produces no performance insight", () => {
    const analysis: NormalizedAnalysis = {
      ...GOOD_ANALYSIS,
      lighthouse: { ...GOOD_ANALYSIS.lighthouse, performance: null },
    };
    const insights = generateInsights(analysis);
    assert.ok(!insights.some((i) => i.category === "performance"));
  });
});
