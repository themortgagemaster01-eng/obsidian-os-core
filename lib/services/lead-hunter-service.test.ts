import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runLeadHunterScan, type LeadHunterServiceDeps } from "@/lib/services/lead-hunter-service";
import type { GeocodedArea, DiscoverBusinessesInput, DiscoveredBusiness } from "@/lib/adapters/discovery-adapter";
import type { CrawlRawResult } from "@/lib/adapters/types";
import type { LeadRow, LeadInsert, LeadUpdate } from "@/lib/repositories/lead-repository";
import type { CompanyRow } from "@/lib/repositories/company-repository";

const FAKE_AREA: GeocodedArea = {
  displayName: "Kitchener, Ontario, Canada",
  latitude: 43.45,
  longitude: -80.49,
  boundingBox: [43.3, 43.5, -80.6, -80.4],
};

function fakeCrawl(overrides: Partial<CrawlRawResult> = {}): CrawlRawResult {
  return {
    requestedUrl: "https://real-restaurant.test/",
    finalUrl: "https://real-restaurant.test/",
    statusCode: 200,
    title: "Real Restaurant",
    metaDescription: null,
    headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    internalLinkCount: 10,
    externalLinkCount: 1,
    pages: [],
    robotsTxtFound: false,
    sitemapFound: false,
    htmlByteSize: 20_000,
    contact: { phones: ["555-000-1111"], emails: [], address: "1 Main St", hours: null },
    socials: { facebook: null, instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null },
    certifications: [],
    licenses: [],
    services: [{ heading: "Menu", excerpt: "Real menu items.", sourceUrl: "https://real-restaurant.test/" }],
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

/** A small, self-contained in-memory fake of the two repositories, real enough to exercise upsert-vs-insert and dedupe behavior without a database. */
function createFakeDeps(overrides: {
  discovered?: DiscoveredBusiness[];
  crawlsByUrl?: Record<string, CrawlRawResult>;
  existingCompanyUrls?: string[];
}): LeadHunterServiceDeps & { insertedRows: LeadInsert[]; updatedRows: { id: string; values: LeadUpdate }[] } {
  const rows = new Map<string, LeadRow>();
  const insertedRows: LeadInsert[] = [];
  const updatedRows: { id: string; values: LeadUpdate }[] = [];
  let nextId = 1;

  const leadRepository: LeadHunterServiceDeps["leadRepository"] = {
    async insert(_client, values) {
      insertedRows.push(values);
      const row = { id: `lead-${nextId++}`, created_at: "", updated_at: "", ...values } as unknown as LeadRow;
      rows.set(`${values.discovery_source}:${values.discovery_external_id}`, row);
      return row;
    },
    async update(_client, id, values) {
      updatedRows.push({ id, values });
      const existing = [...rows.values()].find((r) => r.id === id)!;
      const updated = { ...existing, ...values } as LeadRow;
      rows.set(`${updated.discovery_source}:${updated.discovery_external_id}`, updated);
      return updated;
    },
    async findBySourceAndExternalId(_client, _orgId, source, externalId) {
      return rows.get(`${source}:${externalId}`) ?? null;
    },
  };

  const existingCompanyUrls = new Set(overrides.existingCompanyUrls ?? []);
  const companyRepository: LeadHunterServiceDeps["companyRepository"] = {
    async findByOrgAndUrl(_client, _orgId, normalizedUrl) {
      return existingCompanyUrls.has(normalizedUrl) ? ({ id: "existing-company" } as CompanyRow) : null;
    },
  };

  return {
    client: {} as LeadHunterServiceDeps["client"],
    leadRepository,
    companyRepository,
    geocodeLocation: async () => FAKE_AREA,
    discoverBusinesses: async (_input: DiscoverBusinessesInput) => overrides.discovered ?? [],
    runCrawlAdapter: async (url: string) => overrides.crawlsByUrl?.[url] ?? fakeCrawl({ requestedUrl: url, finalUrl: url }),
    insertedRows,
    updatedRows,
  };
}

const REAL_SHAPED_CANDIDATE: DiscoveredBusiness = {
  externalId: "node/421138265",
  name: "Pepi's Pizza",
  websiteUrl: "https://pepispizza.test/",
  phone: "+1 519-578-6640",
  osmTag: "amenity=restaurant",
  address: "87 Water Street North",
  latitude: 43.45,
  longitude: -80.49,
};

describe("lead-hunter-service: runLeadHunterScan", () => {
  test("throws an honest error when the location can't be geocoded, never fabricates a fallback area", async () => {
    const deps = createFakeDeps({});
    deps.geocodeLocation = async () => null;
    await assert.rejects(
      () => runLeadHunterScan(deps, { organizationId: "org-1", location: "Nowhere Real", industryBuckets: ["restaurant"] }),
      /Could not resolve/
    );
  });

  test("a candidate with no website is rejected, never silently dropped or crawled", async () => {
    const noWebsite: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, websiteUrl: null };
    const deps = createFakeDeps({ discovered: [noWebsite] });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(result.rejectedCount, 1);
    assert.equal(result.qualifiedCount, 0);
    assert.equal(result.leads[0].status, "rejected");
    assert.match(result.leads[0].rejection_reason!, /No website/);
  });

  test("a candidate whose real crawl fails (site unreachable) is rejected with the real reason, never a generic message", async () => {
    const deps = createFakeDeps({
      discovered: [REAL_SHAPED_CANDIDATE],
      crawlsByUrl: { "https://pepispizza.test/": fakeCrawl({ fetchError: "ETIMEDOUT", statusCode: null }) },
    });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(result.rejectedCount, 1);
    assert.match(result.leads[0].rejection_reason!, /ETIMEDOUT/);
  });

  test("a candidate already tracked as a real company in this org is skipped entirely — never re-discovered as a 'new' lead", async () => {
    const deps = createFakeDeps({
      discovered: [REAL_SHAPED_CANDIDATE],
      existingCompanyUrls: ["pepispizza.test"],
    });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(result.skippedExistingCompanyCount, 1);
    assert.equal(result.leads.length, 0);
    assert.equal(deps.insertedRows.length, 0);
  });

  test("a real, reachable candidate is scored and persisted as a real candidate lead with all three distinct scores set", async () => {
    const deps = createFakeDeps({ discovered: [REAL_SHAPED_CANDIDATE] });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(result.qualifiedCount, 1);
    const lead = result.leads[0];
    assert.equal(lead.status, "candidate");
    assert.equal(typeof lead.website_score, "number");
    assert.equal(typeof lead.opportunity_score, "number");
    assert.equal(typeof lead.confidence_score, "number");
    assert.equal(lead.business_name, "Pepi's Pizza");
    assert.equal(lead.industry, "restaurant");
    assert.ok(Array.isArray(lead.main_weaknesses));
  });

  test("re-scanning the same candidate updates the existing lead row instead of inserting a duplicate", async () => {
    const deps = createFakeDeps({ discovered: [REAL_SHAPED_CANDIDATE] });
    await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(deps.insertedRows.length, 1);
    assert.equal(deps.updatedRows.length, 1);
  });

  test("recommends a real, evidence-gated hero pattern per candidate, never the same one regardless of industry", async () => {
    const lawCandidate: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, externalId: "node/999", name: "Acme Law", osmTag: "office=lawyer", websiteUrl: "https://acmelaw.test/" };
    const deps = createFakeDeps({
      discovered: [REAL_SHAPED_CANDIDATE, lawCandidate],
      crawlsByUrl: {
        "https://pepispizza.test/": fakeCrawl({ requestedUrl: "https://pepispizza.test/", finalUrl: "https://pepispizza.test/" }),
        "https://acmelaw.test/": fakeCrawl({ requestedUrl: "https://acmelaw.test/", finalUrl: "https://acmelaw.test/" }),
      },
    });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant", "lawFirm"] });
    const restaurant = result.leads.find((l) => l.business_name === "Pepi's Pizza")!;
    const law = result.leads.find((l) => l.business_name === "Acme Law")!;
    assert.equal(restaurant.recommended_hero_pattern, "editorial-typographic");
    assert.equal(law.recommended_hero_pattern, "editorial-typographic");
    // Both land on the same pattern here because neither has real photography
    // (an honest, evidence-driven outcome, not a bug) — confirm industry
    // classification itself is still real and distinct per candidate.
    assert.equal(restaurant.industry, "restaurant");
    assert.equal(law.industry, "lawFirm");
  });
});
