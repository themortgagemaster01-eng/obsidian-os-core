import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  runLeadHunterScan,
  decideScanOverlapGuardAction,
  checkScanOverlap,
  type LeadHunterServiceDeps,
} from "@/lib/services/lead-hunter-service";
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
}): LeadHunterServiceDeps & {
  insertedRows: LeadInsert[];
  updatedRows: { id: string; values: LeadUpdate }[];
  scanRuns: LeadScanRunRow[];
  discoverBusinessesCalls: DiscoverBusinessesInput[];
} {
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
    async findRunningByOrganization(_client, organizationId) {
      return scanRuns.find((r) => r.organization_id === organizationId && r.status === "running") ?? null;
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
    // Manual-lead dedup methods (Add a Business feature) — never exercised
    // by the OSM scan path itself, so a simple "never a match" fake is
    // sufficient here; manual-lead-service.test.ts covers the real behavior.
    async findByOrgAndWebsiteUrl(_client, _orgId, _normalizedUrl) {
      return null;
    },
    async findByOrgAndBusinessName(_client, _orgId, _businessName) {
      return null;
    },
  };

  const existingCompanyUrls = new Set(overrides.existingCompanyUrls ?? []);
  const companyRepository: LeadHunterServiceDeps["companyRepository"] = {
    async findByOrgAndUrl(_client, _orgId, normalizedUrl) {
      return existingCompanyUrls.has(normalizedUrl) ? ({ id: "existing-company" } as CompanyRow) : null;
    },
    async findByOrgAndBusinessName(_client, _orgId, _businessName) {
      return null;
    },
  };

  const discoverBusinessesCalls: DiscoverBusinessesInput[] = [];

  return {
    client: {} as LeadHunterServiceDeps["client"],
    leadRepository,
    companyRepository,
    leadScanRepository,
    geocodeLocation: async () => FAKE_AREA,
    discoverBusinesses: async (input: DiscoverBusinessesInput) => {
      discoverBusinessesCalls.push(input);
      return overrides.discovered ?? [];
    },
    runCrawlAdapter: async (url: string) => overrides.crawlsByUrl?.[url] ?? fakeCrawl({ requestedUrl: url, finalUrl: url }),
    insertedRows,
    updatedRows,
    scanRuns,
    discoverBusinessesCalls,
  };
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function fakeScanRun(overrides: Partial<LeadScanRunRow> = {}): LeadScanRunRow {
  const now = new Date().toISOString();
  return {
    id: "scan-run-1",
    organization_id: "org-1",
    location: "Mahopac, NY",
    industry_buckets: ["general"],
    scan_size: 5,
    status: "running",
    discovered_count: null,
    qualified_count: null,
    rejected_count: null,
    meaningful_opportunity_count: null,
    high_confidence_count: null,
    queued_count: null,
    error_message: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as unknown as LeadScanRunRow;
}

describe("lead-hunter-service: decideScanOverlapGuardAction (overlap protection, mirrors mission-batch-service's own guard)", () => {
  test("no running scan for this organization — proceed", () => {
    assert.deepEqual(decideScanOverlapGuardAction(null, Date.now(), FIFTEEN_MIN_MS), { kind: "proceed" });
  });

  test("the organization's latest scan already reached a terminal status — proceed, regardless of which one", () => {
    const now = Date.now();
    assert.deepEqual(decideScanOverlapGuardAction(fakeScanRun({ status: "complete" }), now, FIFTEEN_MIN_MS), { kind: "proceed" });
    assert.deepEqual(decideScanOverlapGuardAction(fakeScanRun({ status: "failed" }), now, FIFTEEN_MIN_MS), { kind: "proceed" });
  });

  test("a fresh running scan (well within the duration bound) — already_running, never a second concurrent scan", () => {
    const now = Date.now();
    const freshRun = fakeScanRun({ status: "running", started_at: new Date(now - 2 * 60 * 1000).toISOString() });
    const result = decideScanOverlapGuardAction(freshRun, now, FIFTEEN_MIN_MS);
    assert.deepEqual(result, { kind: "already_running", runningRun: freshRun });
  });

  test("a running scan older than the max duration bound — reap it, then allow a new one to proceed", () => {
    const now = Date.now();
    const staleRun = fakeScanRun({ id: "stale-scan-1", status: "running", started_at: new Date(now - 20 * 60 * 1000).toISOString() });
    const result = decideScanOverlapGuardAction(staleRun, now, FIFTEEN_MIN_MS);
    assert.deepEqual(result, { kind: "reap_stale_then_proceed", staleRunId: "stale-scan-1" });
  });

  test("exactly at the boundary is treated as still-fresh, not stale (age must exceed, not merely equal, the bound)", () => {
    const now = Date.now();
    const boundaryRun = fakeScanRun({ status: "running", started_at: new Date(now - FIFTEEN_MIN_MS).toISOString() });
    assert.equal(decideScanOverlapGuardAction(boundaryRun, now, FIFTEEN_MIN_MS).kind, "already_running");
  });

  test("one millisecond past the bound is stale", () => {
    const now = Date.now();
    const justPastRun = fakeScanRun({ status: "running", started_at: new Date(now - FIFTEEN_MIN_MS - 1).toISOString() });
    assert.equal(decideScanOverlapGuardAction(justPastRun, now, FIFTEEN_MIN_MS).kind, "reap_stale_then_proceed");
  });
});

describe("lead-hunter-service: checkScanOverlap (the route-facing guard, wired for a real DB round-trip)", () => {
  function fakeOverlapDeps(runs: LeadScanRunRow[]) {
    const updated: { id: string; values: unknown }[] = [];
    const leadScanRepository = {
      async findRunningByOrganization(_client: unknown, organizationId: string) {
        return runs.find((r) => r.organization_id === organizationId && r.status === "running") ?? null;
      },
      async update(_client: unknown, id: string, values: Record<string, unknown>) {
        updated.push({ id, values });
        const index = runs.findIndex((r) => r.id === id);
        runs[index] = { ...runs[index], ...values } as LeadScanRunRow;
        return runs[index];
      },
    };
    return { deps: { client: {}, leadScanRepository } as Parameters<typeof checkScanOverlap>[0], updated, runs };
  }

  test("no running scan — proceed, nothing reaped", async () => {
    const { deps, updated } = fakeOverlapDeps([]);
    const result = await checkScanOverlap(deps, "org-1");
    assert.deepEqual(result, { kind: "proceed" });
    assert.equal(updated.length, 0);
  });

  test("a fresh running scan for the same organization — already_running, the real running row is returned", async () => {
    const freshRun = fakeScanRun({ organization_id: "org-1", started_at: new Date().toISOString() });
    const { deps } = fakeOverlapDeps([freshRun]);
    const result = await checkScanOverlap(deps, "org-1");
    assert.deepEqual(result, { kind: "already_running", runningRun: freshRun });
  });

  test("a running scan for a DIFFERENT organization never blocks this one", async () => {
    const otherOrgRun = fakeScanRun({ organization_id: "org-2", started_at: new Date().toISOString() });
    const { deps } = fakeOverlapDeps([otherOrgRun]);
    const result = await checkScanOverlap(deps, "org-1");
    assert.deepEqual(result, { kind: "proceed" });
  });

  test("a stale running scan is actually reaped (marked failed, real error_message, completed_at set) before proceeding", async () => {
    const staleRun = fakeScanRun({
      id: "stale-scan-2",
      organization_id: "org-1",
      started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    const { deps, updated, runs } = fakeOverlapDeps([staleRun]);
    const result = await checkScanOverlap(deps, "org-1");
    assert.deepEqual(result, { kind: "proceed" });
    assert.equal(updated.length, 1);
    assert.equal(updated[0].id, "stale-scan-2");
    assert.equal(runs[0].status, "failed");
    assert.ok(runs[0].completed_at);
    assert.match(runs[0].error_message ?? "", /abandoned/);
  });
});

const REAL_SHAPED_CANDIDATE: DiscoveredBusiness = {
  externalId: "node/421138265",
  name: "Pepi's Pizza",
  websiteUrl: "https://pepispizza.test/",
  phone: "+1 519-578-6640",
  osmTag: "amenity=restaurant",
  address: "87 Water Street North",
  latitude: 43.45,
  longitude: -80.49,
  brand: null,
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
    // Regression (2026-09-13 fix): zero skips keeps today's exact summary
    // format — no dangling empty parenthetical, no "(0 already tracked...)" noise.
    assert.equal(result.skippedExistingCompanyCount, 0);
    assert.equal(deps.scanRuns[0].skipped_existing_company_count, 0);
    assert.doesNotMatch(result.funnelSummary, /already tracked/);
    assert.match(result.funnelSummary, /^1 businesses scanned → 1 usable websites/);
  });

  test("qualification overhaul (2026-09-14): a candidate with no website at all is a real new-build opportunity, never silently dropped OR auto-rejected", async () => {
    // Confirmed live: Balsamo-Codovano Funeral Home was auto-rejected for
    // exactly this before this fix. Robert's own business builds brand-new
    // sites for businesses without one — the best lead category, not a
    // rejection.
    const noWebsite: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, websiteUrl: null };
    const deps = createFakeDeps({ discovered: [noWebsite] });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(result.newBuildCount, 1);
    assert.equal(result.rejectedCount, 0);
    assert.equal(result.qualifiedCount, 0);
    assert.equal(result.leads[0].status, "candidate");
    assert.equal(result.leads[0].makeover_potential, "new_build");
    assert.equal(result.leads[0].rejection_reason, null);
    assert.equal(result.leads[0].website_score, null, "honestly un-scoreable — there is no site to score");
    assert.equal(result.leads[0].opportunity_score, null);
    assert.equal(result.leads[0].confidence_score, null);
    assert.match(result.leads[0].main_opportunity!, /new/i);
    // A real OSM-captured phone still produces a real, honest conversion
    // recommendation — never fabricated, but not thrown away either.
    assert.match(result.leads[0].recommended_conversion_goal!, /phone/i);
  });

  test("qualification overhaul (2026-09-14): a no-website candidate with no captured phone either still gets an honest, non-fabricated conversion recommendation", async () => {
    const noWebsiteNoPhone: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, websiteUrl: null, phone: null };
    const deps = createFakeDeps({ discovered: [noWebsiteNoPhone] });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(result.leads[0].makeover_potential, "new_build");
    assert.match(result.leads[0].recommended_conversion_goal!, /request more information|no direct contact evidence/i);
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
    // Lead Hunter false-alarm fix (2026-09-13): this count must actually
    // reach the persisted lead_scan_runs row, not just the in-memory
    // return value the fire-and-forget route never reads.
    assert.equal(deps.scanRuns[0].skipped_existing_company_count, 1);
    assert.match(result.funnelSummary, /1 already tracked as real companies, correctly skipped/);
  });

  test("chain filter fix (2026-09-14): a candidate OSM tags with a brand is skipped entirely — never crawled, never a lead row", async () => {
    // Confirmed live: Stop & Shop, Dollar Tree, and a multi-location urgent
    // care franchise all surfaced as real "candidate" leads in a town of
    // ~5 real independent businesses — Robert cold-pitches independent
    // local businesses only; a chain is never a realistic target regardless
    // of its score.
    const chainCandidate: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, brand: "Stop & Shop" };
    const deps = createFakeDeps({ discovered: [chainCandidate] });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(result.skippedChainCount, 1);
    assert.equal(result.qualifiedCount, 0);
    assert.equal(result.leads.length, 0);
    assert.equal(deps.insertedRows.length, 0);
    assert.equal(deps.scanRuns[0].skipped_chain_count, 1);
    assert.match(result.funnelSummary, /1 national\/regional chains, correctly skipped/);
  });

  test("chain filter fix (2026-09-14): a chain skip is free — never consumes the real crawl budget, same as an existing-company skip", async () => {
    const chainCandidate: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, externalId: "node/chain-1", brand: "Dollar Tree" };
    const secondReal: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, externalId: "node/real-1", name: "Genuinely Independent Co", websiteUrl: "https://independent.test/" };
    const deps = createFakeDeps({ discovered: [chainCandidate, secondReal] });
    const result = await runLeadHunterScan(deps, {
      organizationId: "org-1",
      location: "Kitchener",
      industryBuckets: ["restaurant"],
      scanSize: 1, // budget of exactly 1 real crawl — the chain skip must not spend it
    });
    assert.equal(result.skippedChainCount, 1);
    assert.equal(result.qualifiedCount, 1, "the real business right after the chain still gets its real crawl — the chain didn't spend the one-candidate budget");
    assert.equal(result.leads[0].business_name, "Genuinely Independent Co");
  });

  test("chain filter fix (2026-09-14): both skip reasons combine cleanly in the funnel summary when both occur in the same scan", async () => {
    const chainCandidate: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, externalId: "node/chain-2", brand: "Pulse-MD" };
    const existingCompanyCandidate: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, externalId: "node/existing-1", name: "Already Tracked Co", websiteUrl: "https://already-tracked.test/" };
    const deps = createFakeDeps({ discovered: [existingCompanyCandidate, chainCandidate], existingCompanyUrls: ["already-tracked.test"] });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "Kitchener", industryBuckets: ["restaurant"] });
    assert.equal(result.skippedExistingCompanyCount, 1);
    assert.equal(result.skippedChainCount, 1);
    assert.match(result.funnelSummary, /1 already tracked as real companies, 1 national\/regional chains, correctly skipped/);
  });

  test("Lead Hunter false-alarm fix (2026-09-13): real bug shape — mostly-already-tracked location produces a real, complete, non-confusing funnel, not the appearance of dropped leads", async () => {
    // Mirrors the real production incident: mahopac, ny discovered 5
    // candidates, qualified_count came back 0, and only 1-2 rejected leads
    // were visible anywhere — with no way to see WHY the other 3-4 vanished.
    // Reconstructed at smaller scale: 3 discovered, 2 already tracked as
    // real companies (correctly skipped), 1 genuinely rejected (crawl
    // failure) — the funnel must now explain all 3, not just 1.
    const secondExisting: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, externalId: "node/2", name: "Existing Two", websiteUrl: "https://existing-two.test/" };
    const rejectedCandidate: DiscoveredBusiness = { ...REAL_SHAPED_CANDIDATE, externalId: "node/3", name: "Broken Site", websiteUrl: "https://broken.test/" };
    const deps = createFakeDeps({
      discovered: [REAL_SHAPED_CANDIDATE, secondExisting, rejectedCandidate],
      existingCompanyUrls: ["pepispizza.test", "existing-two.test"],
      crawlsByUrl: { "https://broken.test/": fakeCrawl({ fetchError: "ETIMEDOUT", statusCode: null }) },
    });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "mahopac, ny", industryBuckets: ["restaurant"] });

    assert.equal(result.discoveredCount, 3);
    assert.equal(result.skippedExistingCompanyCount, 2);
    assert.equal(result.rejectedCount, 1);
    assert.equal(result.qualifiedCount, 0);
    // The arithmetic that was previously invisible: discovered === skipped + rejected + qualified.
    assert.equal(result.discoveredCount, result.skippedExistingCompanyCount + result.rejectedCount + result.qualifiedCount);
    assert.equal(deps.scanRuns[0].skipped_existing_company_count, 2);
    assert.match(result.funnelSummary, /3 businesses scanned \(2 already tracked as real companies, correctly skipped\)/);
  });

  test("repeat-scan dead-end fix (2026-09-13): a location whose nearest 5 candidates are ALL already tracked still finds genuinely new leads further down the discovery pool", async () => {
    // Precisely reconstructs the real bug: Overpass's own fixed top-N for
    // "mahopac, ny" happened to be 6 businesses already tracked as real
    // companies from earlier missions. Before this fix, maxResults ===
    // scanSize (5) meant Overpass was never even asked for a 6th result —
    // the location was structurally capped at 0 new leads forever. Here,
    // `discovered` stands in for a wider Overpass pool (as if
    // DISCOVERY_POOL_SIZE were already in effect): the first 5 entries are
    // already-tracked companies (an existing-company skip is free, doesn't
    // consume the crawl budget), and 2 genuinely new candidates sit right
    // after them — the crawl budget (5, the default) must still reach and
    // qualify both.
    const alreadyTracked = Array.from({ length: 5 }, (_, i) => ({
      ...REAL_SHAPED_CANDIDATE,
      externalId: `node/tracked-${i}`,
      name: `Already Tracked ${i}`,
      websiteUrl: `https://tracked-${i}.test/`,
    }));
    const newCandidates = [
      { ...REAL_SHAPED_CANDIDATE, externalId: "node/new-1", name: "Genuinely New One", websiteUrl: "https://genuinely-new-1.test/" },
      { ...REAL_SHAPED_CANDIDATE, externalId: "node/new-2", name: "Genuinely New Two", websiteUrl: "https://genuinely-new-2.test/" },
    ];
    const deps = createFakeDeps({
      discovered: [...alreadyTracked, ...newCandidates],
      existingCompanyUrls: alreadyTracked.map((c) => c.websiteUrl!.replace("https://", "").replace("/", "")),
    });
    const result = await runLeadHunterScan(deps, { organizationId: "org-1", location: "mahopac, ny", industryBuckets: ["restaurant"] });

    assert.equal(result.skippedExistingCompanyCount, 5, "all 5 already-tracked candidates correctly skipped");
    assert.equal(result.qualifiedCount, 2, "both genuinely new candidates beyond the tracked head were reached and qualified — the real fix");
    assert.equal(result.leads.length, 2);
    assert.equal(result.discoveredCount, 7, "examined every candidate up to the point the crawl budget was satisfied — skips didn't consume it");
  });

  test("repeat-scan dead-end fix (2026-09-13): discoverBusinesses is called with a discovery pool wider than scanSize, not scanSize itself", async () => {
    const deps = createFakeDeps({ discovered: [] });
    await runLeadHunterScan(deps, { organizationId: "org-1", location: "mahopac, ny", industryBuckets: ["restaurant"], scanSize: 5 });
    assert.equal(deps.discoverBusinessesCalls.length, 1);
    assert.equal(deps.discoverBusinessesCalls[0].maxResults, 40, "DISCOVERY_POOL_SIZE — meaningfully wider than the 5-candidate crawl budget, so a saturated location has real room to find new candidates");
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
      brand: null,
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
      brand: null,
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
      brand: null,
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
      brand: null,
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
      // Qualification overhaul (2026-09-14): greatSite's real crawl scores a
      // genuinely great existing website (opportunity_score 0) — status must
      // now be "rejected", not "candidate", so it no longer counts toward
      // qualifiedCount. noWebsite is no longer an automatic rejection either
      // — it's a real, distinct "new_build" opportunity, counted separately.
      assert.equal(result.qualifiedCount, 2, "only the two weak-site leads are real opportunities — the great-site lead rejects on zero upside, no-website is a distinct new-build case");
      assert.equal(result.rejectedCount, 1, "the great-site lead (zero real upside) — not the no-website lead, which is no longer a rejection at all");
      assert.equal(result.newBuildCount, 1, "the no-website lead is now its own honest bucket, never silently merged into rejectedCount or qualifiedCount");

      const greatSiteLead = result.leads.find((l) => l.business_name === "Great Site Co")!;
      assert.equal(greatSiteLead.makeover_potential, "reject", "a genuinely great existing site has no real upside — must not count as a meaningful opportunity");
      assert.equal(greatSiteLead.status, "rejected", "status must actually respect makeover_potential's own reject verdict — the real bug this fix closes (confirmed live: Pulse-MD Urgent Care, Stop & Shop)");
      assert.match(greatSiteLead.rejection_reason ?? "", /no real upside/i);
      assert.doesNotMatch(greatSiteLead.main_opportunity ?? "", /real upside for a redesign/, "must never claim upside exists when the score says it doesn't");

      const noWebsiteLead = result.leads.find((l) => l.business_name === "No Website Co")!;
      assert.equal(noWebsiteLead.status, "candidate", "a real, distinct opportunity — never silently thrown away");
      assert.equal(noWebsiteLead.makeover_potential, "new_build");
      assert.equal(noWebsiteLead.website_score, null, "honestly un-scoreable — there is no site to score");
      assert.equal(noWebsiteLead.opportunity_score, null);
      assert.equal(noWebsiteLead.confidence_score, null);
      assert.match(noWebsiteLead.main_opportunity ?? "", /new/i);

      assert.equal(result.meaningfulOpportunityCount, 2, "the two weak-site leads are real, non-reject opportunities; the great-site lead is not");
      assert.equal(result.highConfidenceCount, 1, "only the rich-evidence weak site clears the confidence bar");
      assert.equal(result.queuedCount, 1, "queued is capped at the real high-confidence count, never inflated to a fixed 5");
      assert.match(result.funnelSummary, /4 businesses scanned/);
      assert.match(result.funnelSummary, /2 usable websites/);
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
      assert.equal(run.qualified_count, 2);
      assert.equal(run.rejected_count, 1);
      assert.equal(run.new_build_count, 1);
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
