import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeCrawlRawResult, type CrawlRawResult } from "@/lib/adapters/types";

function fullCrawl(): CrawlRawResult {
  return {
    requestedUrl: "https://acme.test/",
    finalUrl: "https://acme.test/",
    statusCode: 200,
    title: "Acme Co",
    metaDescription: "Real description.",
    jsonLdName: "Acme Co",
    jsonLdType: "LocalBusiness",
    headingCounts: { h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
    internalLinkCount: 12,
    externalLinkCount: 3,
    pages: [{ url: "https://acme.test/about", statusCode: 200, title: "About" }],
    robotsTxtFound: true,
    sitemapFound: true,
    htmlByteSize: 45_000,
    contact: { phones: ["+15550001111"], emails: ["hi@acme.test"], address: "1 Main St", hours: "9-5" },
    socials: { facebook: "https://facebook.com/acme", instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null },
    certifications: [],
    licenses: [],
    services: [{ heading: "Services", excerpt: "Real services.", sourceUrl: "https://acme.test/" }],
    products: [],
    team: [],
    faq: [],
    testimonials: [],
    reviews: { averageRating: 4.5, count: 20, source: "schema.org" },
    gallery: [],
    menu: [],
    forms: [],
    maps: [],
    unparsedDocuments: [],
  };
}

/**
 * lib/adapters/types.test.ts — normalizeCrawlRawResult, the read-boundary
 * fix for the Phase 9 real-validation crash ("Cannot read properties of
 * undefined (reading 'h1')" in lead-scoring-service.ts's computeWebsiteScore,
 * reached via business-intelligence-service.ts's buildBusinessIntelligenceProfile).
 * The real crawl adapter (runCrawlAdapter) always returns every field, so
 * these scenarios exercise data that never came from it — a hand-seeded row,
 * an older row predating a field, or any future non-adapter write path.
 */
describe("normalizeCrawlRawResult", () => {
  test("a complete, real crawl result passes through untouched — deterministic, no data loss", () => {
    const crawl = fullCrawl();
    const normalized = normalizeCrawlRawResult(crawl);
    assert.deepEqual(normalized, crawl);
  });

  test("the exact Phase 9 regression: headingCounts missing entirely defaults to all-zero, never throws", () => {
    const raw = fullCrawl() as unknown as Record<string, unknown>;
    delete raw.headingCounts;
    const normalized = normalizeCrawlRawResult(raw);
    assert.deepEqual(normalized.headingCounts, { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 });
  });

  test("headingCounts present but missing individual keys defaults only the missing ones, keeps the real ones", () => {
    const raw = fullCrawl() as unknown as Record<string, unknown>;
    raw.headingCounts = { h1: 3 };
    const normalized = normalizeCrawlRawResult(raw);
    assert.deepEqual(normalized.headingCounts, { h1: 3, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 });
  });

  test("contact missing entirely defaults to the honest empty ContactInfo, never throws on nested reads", () => {
    const raw = fullCrawl() as unknown as Record<string, unknown>;
    delete raw.contact;
    const normalized = normalizeCrawlRawResult(raw);
    assert.deepEqual(normalized.contact, { phones: [], emails: [], address: null, hours: null });
  });

  test("reviews missing entirely defaults to the honest empty ReviewsSummary", () => {
    const raw = fullCrawl() as unknown as Record<string, unknown>;
    delete raw.reviews;
    const normalized = normalizeCrawlRawResult(raw);
    assert.deepEqual(normalized.reviews, { averageRating: null, count: null, source: null });
  });

  test("socials missing entirely defaults every platform to null", () => {
    const raw = fullCrawl() as unknown as Record<string, unknown>;
    delete raw.socials;
    const normalized = normalizeCrawlRawResult(raw);
    assert.deepEqual(normalized.socials, { facebook: null, instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null });
  });

  test("array fields missing entirely default to empty arrays, never undefined", () => {
    const raw = fullCrawl() as unknown as Record<string, unknown>;
    delete raw.services;
    delete raw.gallery;
    delete raw.pages;
    const normalized = normalizeCrawlRawResult(raw);
    assert.deepEqual(normalized.services, []);
    assert.deepEqual(normalized.gallery, []);
    assert.deepEqual(normalized.pages, []);
  });

  test("a genuinely empty object normalizes to a fully honest empty CrawlRawResult, never throws", () => {
    const normalized = normalizeCrawlRawResult({});
    assert.equal(normalized.requestedUrl, "");
    assert.equal(normalized.statusCode, null);
    assert.deepEqual(normalized.headingCounts, { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 });
    assert.deepEqual(normalized.contact, { phones: [], emails: [], address: null, hours: null });
  });

  test("null and undefined input both normalize the same way a genuinely empty object does, never throw", () => {
    assert.deepEqual(normalizeCrawlRawResult(null), normalizeCrawlRawResult({}));
    assert.deepEqual(normalizeCrawlRawResult(undefined), normalizeCrawlRawResult({}));
  });

  test("a non-object primitive (a stray string/number stored where an object was expected) normalizes safely rather than throwing", () => {
    assert.deepEqual(normalizeCrawlRawResult("not an object"), normalizeCrawlRawResult({}));
    assert.deepEqual(normalizeCrawlRawResult(42), normalizeCrawlRawResult({}));
  });

  test("optional ContactInfo provenance fields (phoneEvidence/emailEvidence/addressSource/hoursByDay) pass through untouched when present — matches the existing older-row-compatibility convention", () => {
    const raw = fullCrawl();
    raw.contact.phoneEvidence = [{ phone: "555-000-1111", normalized: "+15550001111", sourceUrl: "https://acme.test/", source: "tel-link" }];
    const normalized = normalizeCrawlRawResult(raw);
    assert.deepEqual(normalized.contact.phoneEvidence, raw.contact.phoneEvidence);
  });

  test("Phase 13: unparsedDocuments missing entirely (an older persisted row, predating this field) defaults to an honest empty array, never throws", () => {
    const raw = fullCrawl() as unknown as Record<string, unknown>;
    delete raw.unparsedDocuments;
    const normalized = normalizeCrawlRawResult(raw);
    assert.deepEqual(normalized.unparsedDocuments, []);
  });

  test("Phase 13: unparsedDocuments present passes through untouched", () => {
    const raw = fullCrawl();
    raw.unparsedDocuments = [{ url: "https://acme.test/menu.pdf", reason: "no-text-layer" }];
    const normalized = normalizeCrawlRawResult(raw);
    assert.deepEqual(normalized.unparsedDocuments, raw.unparsedDocuments);
  });

  test("Phase 14: jsonLdName/jsonLdType missing entirely (an older persisted row, predating this field) default to null, never throw", () => {
    const raw = fullCrawl() as unknown as Record<string, unknown>;
    delete raw.jsonLdName;
    delete raw.jsonLdType;
    const normalized = normalizeCrawlRawResult(raw);
    assert.equal(normalized.jsonLdName, null);
    assert.equal(normalized.jsonLdType, null);
  });

  test("Phase 14: jsonLdName/jsonLdType present pass through untouched, including a string[] @type", () => {
    const raw = fullCrawl();
    raw.jsonLdName = "Acme Restaurant";
    raw.jsonLdType = ["LocalBusiness", "Restaurant"];
    const normalized = normalizeCrawlRawResult(raw);
    assert.equal(normalized.jsonLdName, "Acme Restaurant");
    assert.deepEqual(normalized.jsonLdType, ["LocalBusiness", "Restaurant"]);
  });
});
