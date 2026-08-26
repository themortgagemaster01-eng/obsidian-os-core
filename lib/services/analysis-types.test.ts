import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizedAnalysisFromRow } from "@/lib/services/analysis-types";
import type { WebsiteAnalysisRow } from "@/lib/repositories/website-analysis-repository";

function fakeRow(overrides: Partial<WebsiteAnalysisRow> = {}): WebsiteAnalysisRow {
  return {
    id: "analysis-1",
    mission_id: "mission-1",
    organization_id: "org-1",
    company_id: null,
    status: "complete",
    crawl_result: {
      requestedUrl: "https://acme.test/",
      finalUrl: "https://acme.test/",
      statusCode: 200,
      title: "Acme Co",
      metaDescription: "Real description.",
      headingCounts: { h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
      internalLinkCount: 12,
      externalLinkCount: 3,
      pages: [],
      robotsTxtFound: true,
      sitemapFound: true,
      htmlByteSize: 45_000,
      contact: { phones: ["+15550001111"], emails: [], address: null, hours: null },
      socials: { facebook: null, instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null },
      certifications: [],
      licenses: [],
      services: [],
      products: [],
      team: [],
      faq: [],
      testimonials: [],
      reviews: { averageRating: null, count: null, source: null },
      gallery: [],
      menu: [],
      forms: [],
      maps: [],
    } as unknown as WebsiteAnalysisRow["crawl_result"],
    mobile_result: null,
    seo_result: null,
    accessibility_result: null,
    lighthouse_result: null,
    tech_detection_result: null,
    mobile_score: 50,
    mobile_findings: [],
    seo_score: 60,
    seo_findings: [],
    accessibility_score: 70,
    accessibility_findings: [],
    lighthouse_performance: 80,
    lighthouse_accessibility: 90,
    lighthouse_best_practices: 85,
    lighthouse_seo: 75,
    technology_stack: [],
    opportunity_score: 40,
    screenshot_url: null,
    above_fold_screenshot_url: null,
    error_message: null,
    started_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:05:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * lib/services/analysis-types.test.ts — normalizedAnalysisFromRow's own
 * crawl_result read boundary had zero direct unit coverage before Phase 9,
 * despite feeding createProposal (via computeTechnicalHealth) and three
 * other production services. Covers the same class of Phase 9 regression
 * (an incomplete/legacy-shaped persisted crawl_result) at this second real
 * call site of normalizeCrawlRawResult.
 */
describe("normalizedAnalysisFromRow", () => {
  test("a complete crawl_result computes Technical Health normally (95: no tech_detection_result in this fixture, -5 for that alone)", () => {
    const normalized = normalizedAnalysisFromRow(fakeRow(), "https://acme.test/");
    assert.equal(normalized.technicalHealthScore, 95);
    assert.deepEqual(normalized.technicalHealthFindings, ["Could not confidently detect the site's underlying technology."]);
  });

  test("Phase 9 regression: a crawl_result missing headingCounts and contact never throws — degrades to honest defaults, same score as the complete-fixture case above", () => {
    const incompleteCrawl = { statusCode: 200, robotsTxtFound: true, sitemapFound: true, internalLinkCount: 5 };
    const row = fakeRow({ crawl_result: incompleteCrawl as unknown as WebsiteAnalysisRow["crawl_result"] });
    const normalized = normalizedAnalysisFromRow(row, "https://acme.test/");
    assert.deepEqual(normalized.contactEvidence, { phones: [], emails: [], address: null, hours: null });
    assert.equal(normalized.technicalHealthScore, 95);
  });

  test("a null crawl_result (no crawl ever ran) still produces the existing honest zero-score fallback, unaffected by this fix", () => {
    const normalized = normalizedAnalysisFromRow(fakeRow({ crawl_result: null }), "https://acme.test/");
    assert.equal(normalized.technicalHealthScore, 0);
    assert.deepEqual(normalized.technicalHealthFindings, ["Could not analyze the site's basic structure."]);
  });
});
