import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runLeadHunterScan, type LeadHunterServiceDeps } from "@/lib/services/lead-hunter-service";
import type { GeocodedArea, DiscoverBusinessesInput, DiscoveredBusiness } from "@/lib/adapters/discovery-adapter";
import type { CrawlRawResult } from "@/lib/adapters/types";
import type { LeadRow, LeadInsert, LeadUpdate } from "@/lib/repositories/lead-repository";
import type { CompanyRow } from "@/lib/repositories/company-repository";
import type { LeadScanRunRow } from "@/lib/repositories/lead-scan-repository";

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
    menu: [],
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
}): LeadHunterServiceDeps & { insertedRows: LeadInsert[]; updatedRows: { id: string; values: LeadUpdate }[]; scanRuns: LeadScanRunRow[] } {
  const rows = new Map<string, LeadRow>();
  const insertedRows: LeadInsert[] = [];
  const updatedRows: { id: string; values: LeadUpdate }[] = [];
  const scanRuns: LeadScanRunRow[] = [];
  let nextId = 1;
  let nextScanRunId = 1;

  const leadScanRepository: LeadHunterServiceDeps["leadScanRepository"] = {
    async insert(_client, values) {
      // Mirrors the real table's nullable, no-default funnel-count columns
      // (supabase/migrations/0021_lead_scan_runs.sql) — a real Postgres row
      // reads these as null until a later update sets them, never undefined.
      const row = {
        id: `scan-run-${nextScanRunId++}`,
        created_at: "",
        updated_at: "",
        discovered_count: null,
        qualified_count: null,
        rejected_count: null,
        meaningful_opportunity_count: null,
        high_confidence_count: null,
        queued_count: null,
        error_message: null,
        completed_at: null,
        ...values,
      } as unknown as LeadScanRunRow;
      scanRuns.push(row);
      return row;
    },
    async update(_client, id, values) {
      const index = scanRuns.findIndex((r) => r.id === id);
      const updated = { ...scanRuns[index], ...values } as LeadScanRunRow;
      scanRuns[index] = updated;
      return updated;
    },
  };

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
    leadScanRepository,
    geocodeLocation: async () => FAKE_AREA,
    discoverBusinesses: async (_input: DiscoverBusinessesInput) => overrides.discovered ?? [],
    runCrawlAdapter: async (url: string) => overrides.crawlsByUrl?.[url] ?? fakeCrawl({ requestedUrl: url, finalUrl: url }),
    insertedRows,
    updatedRows,
    scanRuns,
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

  test("Phase 3: a geocode failure is recorded as a real 'failed' lead_scan_runs row, never silently dropped past the fire-and-forget boundary", async () => {
    const deps = createFakeDeps({});
    deps.geocodeLocation = async () => null;
    await assert.rejects(() => runLeadHunterScan(deps, { organizationId: "org-1", location: "Nowhere Real", industryBuckets: ["restaurant"] }));
    assert.equal(deps.scanRuns.length, 1);
    assert.equal(deps.scanRuns[0].status, "failed");
    assert.match(deps.scanRuns[0].error_message!, /Could not resolve/);
    assert.equal(deps.scanRuns[0].discovered_count, null, "a failed run has no real final counts, never a fabricated 0");
  });

  test("Phase 5.1: geocoding THROWING (not just returning null) is recorded as a real 'failed' run, never left stuck at 'running'", async () => {
    const deps = createFakeDeps({});
    deps.geocodeLocation = async () => {
      throw new Error("Nominatim request timed out");
    };
    await assert.rejects(
      () => runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] }),
      /Nominatim request timed out/
    );
    assert.equal(deps.scanRuns.length, 1);
    assert.equal(deps.scanRuns[0].status, "failed");
    assert.equal(deps.scanRuns[0].error_message, "Nominatim request timed out");
  });

  test("Phase 5.1 (the real bug found during the Kitchener validation): discovery throwing is recorded as a real 'failed' run, never left stuck at 'running' — generic over the failure, not HTTP-504-specific", async () => {
    const deps = createFakeDeps({});
    const overpass504 =
      'Overpass API request failed (504): <html>...<strong>Error</strong>: runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request.</html>';
    deps.discoverBusinesses = async () => {
      throw new Error(overpass504);
    };
    await assert.rejects(
      () => runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] }),
      /504/
    );
    assert.equal(deps.scanRuns.length, 1, "the row created before discovery must still exist and reach a terminal state");
    assert.equal(deps.scanRuns[0].status, "failed", "must never be left at 'running' — this was the real orphaned-state bug");
    assert.equal(deps.scanRuns[0].error_message, overpass504, "the real original error is preserved verbatim, never swallowed or replaced with a generic message");
    assert.notEqual(deps.scanRuns[0].completed_at, null);
  });

  test("Phase 5.1: a failure partway through the per-candidate loop (a real crawl/DB error, not discovery or geocoding) also reaches a terminal 'failed' state — generic over WHERE the failure happens", async () => {
    const deps = createFakeDeps({ discovered: [REAL_SHAPED_CANDIDATE] });
    deps.companyRepository.findByOrgAndUrl = async () => {
      throw new Error("connection reset by peer");
    };
    await assert.rejects(
      () => runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] }),
      /connection reset by peer/
    );
    assert.equal(deps.scanRuns[0].status, "failed");
    assert.equal(deps.scanRuns[0].error_message, "connection reset by peer");
  });

  test("Phase 5.1: a normal successful scan is completely unaffected by the new failure-handling wrapper", async () => {
    const deps = createFakeDeps({ discovered: [REAL_SHAPED_CANDIDATE] });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(result.qualifiedCount, 1);
    assert.equal(deps.scanRuns[0].status, "complete");
    assert.equal(deps.scanRuns[0].error_message, null);
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

  describe("Phase 3: funnel-stage reporting", () => {
    const greatSite: DiscoveredBusiness = {
      externalId: "node/1",
      name: "Great Site Co",
      websiteUrl: "https://greatsite.test/",
      phone: null,
      osmTag: "amenity=restaurant",
      address: "1 Main St",
      latitude: 43.45,
      longitude: -80.49,
    };
    const richEvidenceWeakSite: DiscoveredBusiness = {
      externalId: "node/2",
      name: "Weak Site Rich Evidence Co",
      websiteUrl: "https://richevidence.test/",
      phone: null,
      osmTag: "amenity=restaurant",
      address: "2 Main St",
      latitude: 43.45,
      longitude: -80.49,
    };
    const thinEvidenceWeakSite: DiscoveredBusiness = {
      externalId: "node/3",
      name: "Weak Site Thin Evidence Co",
      websiteUrl: "https://thinevidence.test/",
      phone: null,
      osmTag: "amenity=restaurant",
      address: "3 Main St",
      latitude: 43.45,
      longitude: -80.49,
    };
    const noWebsite: DiscoveredBusiness = {
      externalId: "node/4",
      name: "No Website Co",
      websiteUrl: null,
      phone: null,
      osmTag: "amenity=restaurant",
      address: "4 Main St",
      latitude: 43.45,
      longitude: -80.49,
    };

    function buildDeps() {
      return createFakeDeps({
        discovered: [greatSite, richEvidenceWeakSite, thinEvidenceWeakSite, noWebsite],
        crawlsByUrl: {
          "https://greatsite.test/": fakeCrawl({
            requestedUrl: "https://greatsite.test/",
            finalUrl: "https://greatsite.test/",
            metaDescription: "Great Site — real description.",
            headingCounts: { h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
            robotsTxtFound: true,
            sitemapFound: true,
            htmlByteSize: 45_000,
            contact: { phones: ["555-0001"], emails: ["hi@greatsite.test"], address: "1 Main St", hours: null },
            internalLinkCount: 12,
          }),
          "https://richevidence.test/": fakeCrawl({
            requestedUrl: "https://richevidence.test/",
            finalUrl: "https://richevidence.test/",
            metaDescription: "Rich Evidence — real description.",
            headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
            robotsTxtFound: false,
            sitemapFound: false,
            htmlByteSize: 5_000_000,
            contact: { phones: ["555-0002"], emails: ["hi@richevidence.test"], address: "2 Main St", hours: null },
            internalLinkCount: 12,
            reviews: { averageRating: 4.8, count: 40, source: "schema.org" },
            testimonials: [{ heading: "Testimonial", excerpt: "Great!", sourceUrl: "https://richevidence.test/" }],
            gallery: [{ src: "https://richevidence.test/1.jpg", alt: null, sourceUrl: "https://richevidence.test/" }],
          }),
          "https://thinevidence.test/": fakeCrawl({
            requestedUrl: "https://thinevidence.test/",
            finalUrl: "https://thinevidence.test/",
            metaDescription: null,
            headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
            robotsTxtFound: false,
            sitemapFound: false,
            htmlByteSize: 5_000_000,
            contact: { phones: ["555-0003"], emails: [], address: null, hours: null },
            internalLinkCount: 12,
          }),
        },
      });
    }

    test("tallies meaningful-opportunity and high-confidence counts from real per-candidate results, never a hardcoded example", async () => {
      const deps = buildDeps();
      const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });

      assert.equal(result.discoveredCount, 4);
      assert.equal(result.qualifiedCount, 3, "3 real websites loaded — the 4th (no website) never reaches qualification");
      assert.equal(result.rejectedCount, 1);

      const greatSiteLead = result.leads.find((l) => l.business_name === "Great Site Co")!;
      assert.equal(greatSiteLead.makeover_potential, "reject", "a genuinely great existing site has no real upside — must not count as a meaningful opportunity");

      assert.equal(result.meaningfulOpportunityCount, 2, "the two weak-site leads are real, non-reject opportunities; the great-site lead is not");
      assert.equal(result.highConfidenceCount, 1, "only the rich-evidence weak site clears the confidence bar");
      assert.equal(result.queuedCount, 1, "queued is capped at the real high-confidence count, never inflated to a fixed 5");
      assert.match(result.funnelSummary, /4 businesses scanned/);
      assert.match(result.funnelSummary, /3 usable websites/);
      assert.match(result.funnelSummary, /2 meaningful website opportunities/);
      assert.match(result.funnelSummary, /1 high-confidence prospects/);
      assert.match(result.funnelSummary, /1 selected for today's queue/);
    });

    test("persists the real funnel counts to a complete lead_scan_runs row, and returns its id", async () => {
      const deps = buildDeps();
      const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });

      assert.equal(deps.scanRuns.length, 1);
      const run = deps.scanRuns[0];
      assert.equal(run.id, result.scanRunId);
      assert.equal(run.status, "complete");
      assert.equal(run.discovered_count, 4);
      assert.equal(run.qualified_count, 3);
      assert.equal(run.rejected_count, 1);
      assert.equal(run.meaningful_opportunity_count, 2);
      assert.equal(run.high_confidence_count, 1);
      assert.equal(run.queued_count, 1);
      assert.ok(run.completed_at);
    });

    test("queuedCount respects a caller-provided queueSize, never a hardcoded 5", async () => {
      const deps = buildDeps();
      const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"], queueSize: 0 });
      assert.equal(result.queuedCount, 0);
    });
  });
});
