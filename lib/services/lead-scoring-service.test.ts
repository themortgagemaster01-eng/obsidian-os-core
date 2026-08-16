import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeWebsiteScore,
  computeConfidenceScore,
  computeLeadOpportunityScore,
  computeMakeoverPotential,
  rankLeads,
} from "@/lib/services/lead-scoring-service";
import type { CrawlRawResult } from "@/lib/adapters/types";

function crawlFor(overrides: Partial<CrawlRawResult> = {}): CrawlRawResult {
  return {
    requestedUrl: "https://acme.test/",
    finalUrl: "https://acme.test/",
    statusCode: 200,
    title: "Acme Co",
    metaDescription: "Acme Co — real business description.",
    headingCounts: { h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
    internalLinkCount: 12,
    externalLinkCount: 3,
    pages: [],
    robotsTxtFound: true,
    sitemapFound: true,
    htmlByteSize: 45_000,
    contact: { phones: ["555-000-1111"], emails: ["hi@acme.test"], address: "1 Main St", hours: null },
    socials: { facebook: null, instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null },
    certifications: [],
    licenses: [],
    services: [{ heading: "Services", excerpt: "Real services offered.", sourceUrl: "https://acme.test/" }],
    products: [],
    team: [],
    faq: [],
    testimonials: [],
    reviews: { averageRating: null, count: null, source: null },
    gallery: [],
    forms: [],
    maps: [],
    ...overrides,
  };
}

describe("lead-scoring-service: computeWebsiteScore", () => {
  test("scores 0 with an honest single signal when the crawl failed outright — never a partial confident score for data that was never fetched", () => {
    const result = computeWebsiteScore(crawlFor({ fetchError: "ETIMEDOUT", statusCode: null }));
    assert.equal(result.score, 0);
    assert.equal(result.signals.length, 1);
    assert.equal(result.signals[0].passed, false);
  });

  test("scores 0 for a real, reachable site returning a 404/500 status — real evidence the site is broken, not fabricated", () => {
    const result = computeWebsiteScore(crawlFor({ statusCode: 404 }));
    assert.equal(result.score, 0);
  });

  test("scores 100 when every cheap structural signal passes", () => {
    const result = computeWebsiteScore(crawlFor());
    assert.equal(result.score, 100);
    assert.ok(result.signals.every((s) => s.passed));
  });

  test("scores partially and names exactly which real signals failed", () => {
    const result = computeWebsiteScore(crawlFor({ metaDescription: null, robotsTxtFound: false }));
    assert.ok(result.score > 0 && result.score < 100);
    const failed = result.signals.filter((s) => !s.passed).map((s) => s.label);
    assert.deepEqual(failed.sort(), ["Has a meta description", "robots.txt present"]);
  });

  test("penalizes a badly bloated page (real performance-adjacent signal)", () => {
    const result = computeWebsiteScore(crawlFor({ htmlByteSize: 5_000_000 }));
    assert.ok(!result.signals.find((s) => s.label.includes("bloated"))!.passed);
  });
});

describe("lead-scoring-service: computeConfidenceScore", () => {
  test("scores 0 with no evidence found when the crawl failed outright", () => {
    const result = computeConfidenceScore(crawlFor({ fetchError: "ETIMEDOUT" }));
    assert.equal(result.score, 0);
    assert.deepEqual(result.evidenceFound, []);
  });

  test("reflects exactly how many real evidence categories were actually captured, named honestly", () => {
    const result = computeConfidenceScore(
      crawlFor({
        contact: { phones: ["555-0000"], emails: [], address: null, hours: null },
        services: [],
        testimonials: [],
        gallery: [],
        reviews: { averageRating: null, count: null, source: null },
      })
    );
    assert.ok(result.evidenceFound.includes("phone"));
    assert.ok(result.evidenceFound.includes("meta description"));
    assert.ok(!result.evidenceFound.includes("services"));
    assert.ok(!result.evidenceFound.includes("address"));
  });
});

describe("lead-scoring-service: computeLeadOpportunityScore (distinct from Website Score — CTO directive §2)", () => {
  test("a legitimate business with a weak website scores HIGH opportunity — real upside, real evidence", () => {
    const weakSiteRealBusiness = crawlFor({
      metaDescription: null,
      robotsTxtFound: false,
      sitemapFound: false,
      headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    });
    const result = computeLeadOpportunityScore(weakSiteRealBusiness);
    assert.ok(result.websiteScore < 50, "fixture must actually have a weak website score");
    assert.ok(result.legitimacyScore >= 40, "fixture must actually be legitimate");
    assert.ok(result.score > 50, `expected high opportunity for a weak-site-but-legitimate business, got ${result.score}`);
  });

  test("a thin/unverifiable candidate does NOT score high opportunity just because its website is bad — 'do not rank businesses solely because their website looks old' (CTO directive §1)", () => {
    const thinEvidenceBadSite = crawlFor({
      metaDescription: null,
      robotsTxtFound: false,
      sitemapFound: false,
      headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      contact: { phones: [], emails: [], address: null, hours: null },
      services: [],
      internalLinkCount: 1,
      title: null,
    });
    const result = computeLeadOpportunityScore(thinEvidenceBadSite);
    assert.ok(result.websiteScore < 50, "fixture must actually have a weak website score");
    assert.ok(result.legitimacyScore < 40, "fixture must actually be thin/unverifiable");
    assert.ok(result.score < 50, `expected a discounted opportunity score for a thin, unverifiable candidate, got ${result.score}`);
  });

  test("a legitimate business with an already-great website scores LOW opportunity — little real upside left", () => {
    const result = computeLeadOpportunityScore(crawlFor());
    assert.equal(result.websiteScore, 100);
    assert.ok(result.score < 50, `expected low opportunity when the site is already strong, got ${result.score}`);
  });

  test("scores 0 for a site that never loaded at all", () => {
    const result = computeLeadOpportunityScore(crawlFor({ fetchError: "ENOTFOUND" }));
    assert.equal(result.score, 0);
  });
});

describe("lead-scoring-service: computeMakeoverPotential (Phase 2, CTO directive §2)", () => {
  function potentialFor(crawl: CrawlRawResult) {
    return computeMakeoverPotential(computeWebsiteScore(crawl), computeLeadOpportunityScore(crawl), computeConfidenceScore(crawl));
  }

  test("Reject: no real, verifiable evidence of an operating business — same gate as opportunity score's legitimacy check", () => {
    const thinEvidenceBadSite = crawlFor({
      metaDescription: null,
      contact: { phones: [], emails: [], address: null, hours: null },
      services: [],
      internalLinkCount: 1,
      title: null,
    });
    const result = potentialFor(thinEvidenceBadSite);
    assert.equal(result.potential, "reject");
    assert.ok(result.reasons[0].includes("No real, verifiable evidence"));
  });

  test("Reject: a real, legitimate business with an already-great website — the Subway case, no real upside to sell", () => {
    const result = potentialFor(crawlFor());
    assert.equal(result.potential, "reject");
    assert.ok(result.reasons[0].includes("no real upside left"));
  });

  test("Low: legitimate but thin real opportunity", () => {
    const lowCrawl = crawlFor({
      metaDescription: null,
      contact: { phones: ["555-0001"], emails: [], address: null, hours: null },
      internalLinkCount: 2,
    });
    const result = potentialFor(lowCrawl);
    assert.equal(result.potential, "low");
  });

  test("Medium: a real, moderate opportunity", () => {
    const mediumCrawl = crawlFor({
      metaDescription: null,
      headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      robotsTxtFound: false,
      title: null,
    });
    const result = potentialFor(mediumCrawl);
    assert.equal(result.potential, "medium");
  });

  test("High: strong opportunity backed by real, reasonably rich evidence", () => {
    const highCrawl = crawlFor({
      metaDescription: null,
      headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      robotsTxtFound: false,
      htmlByteSize: 5_000_000,
    });
    const result = potentialFor(highCrawl);
    assert.equal(result.potential, "high");
  });

  test("Very High: strong opportunity, strong confidence, and rich real evidence", () => {
    const veryHighCrawl = crawlFor({
      metaDescription: null,
      headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      robotsTxtFound: false,
      sitemapFound: false,
      htmlByteSize: 5_000_000,
      reviews: { averageRating: 4.5, count: 12, source: "schema.org structured data" },
    });
    const result = potentialFor(veryHighCrawl);
    assert.equal(result.potential, "very_high");
  });

  test("reasons always cite real evidence, never just the bare verdict", () => {
    const result = potentialFor(crawlFor({ metaDescription: null, robotsTxtFound: false }));
    assert.ok(result.reasons.length > 0);
    assert.ok(result.reasons.every((r) => r.length > 0));
  });
});

describe("lead-scoring-service: rankLeads", () => {
  test("sorts highest opportunityScore first", () => {
    const ranked = rankLeads([
      { id: "a", opportunityScore: 40 },
      { id: "b", opportunityScore: 90 },
      { id: "c", opportunityScore: 65 },
    ]);
    assert.deepEqual(ranked.map((l) => l.id), ["b", "c", "a"]);
  });

  test("Phase 3: ties on opportunityScore break on confidenceScore next — 'ranking-by-opportunity-then-confidence'", () => {
    const ranked = rankLeads([
      { id: "a", opportunityScore: 60, confidenceScore: 30 },
      { id: "b", opportunityScore: 60, confidenceScore: 80 },
      { id: "c", opportunityScore: 60, confidenceScore: 55 },
    ]);
    assert.deepEqual(ranked.map((l) => l.id), ["b", "c", "a"]);
  });

  test("a tied lead with no confidenceScore at all (an older caller that never opts into the tie-break) sorts last among the tie, never treated as a real 0", () => {
    const ranked = rankLeads([
      { id: "a", opportunityScore: 60, confidenceScore: 50 },
      { id: "b", opportunityScore: 60 },
    ]);
    assert.deepEqual(ranked.map((l) => l.id), ["a", "b"]);
  });

  test("callers who omit confidenceScore entirely keep the original opportunity-only ranking behavior unchanged", () => {
    const ranked = rankLeads([
      { id: "a", opportunityScore: 60 },
      { id: "b", opportunityScore: 60 },
      { id: "c", opportunityScore: 90 },
    ]);
    assert.deepEqual(ranked.map((l) => l.id), ["c", "a", "b"]);
  });

  test("a lead with no score yet sorts last, never treated as a real 0", () => {
    const ranked = rankLeads([
      { id: "a", opportunityScore: null },
      { id: "b", opportunityScore: 10 },
    ]);
    assert.deepEqual(ranked.map((l) => l.id), ["b", "a"]);
  });

  test("does not mutate the input array", () => {
    const input = [
      { id: "a", opportunityScore: 10 },
      { id: "b", opportunityScore: 90 },
    ];
    const ranked = rankLeads(input);
    assert.notEqual(ranked, input);
    assert.equal(input[0].id, "a");
  });
});
