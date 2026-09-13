import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { checkManualLeadDuplicate, runManualLeadQualification, MANUAL_DISCOVERY_SOURCE } from "@/lib/services/manual-lead-service";
import type { GeocodedArea } from "@/lib/adapters/discovery-adapter";
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
    menu: [],
    forms: [],
    maps: [],
    ...overrides,
  };
}

function fakeDeps(overrides: {
  companyByUrl?: Record<string, CompanyRow>;
  companyByName?: Record<string, CompanyRow>;
  leadByUrl?: Record<string, LeadRow>;
  leadByName?: Record<string, LeadRow>;
  crawlsByUrl?: Record<string, CrawlRawResult>;
} = {}) {
  const insertedRows: LeadInsert[] = [];
  const updatedRows: { id: string; values: LeadUpdate }[] = [];
  let nextId = 1;

  const leadRepository = {
    async insert(_client: unknown, values: LeadInsert) {
      insertedRows.push(values);
      return { id: `lead-${nextId++}`, created_at: "", updated_at: "", ...values } as unknown as LeadRow;
    },
    async update(_client: unknown, id: string, values: LeadUpdate) {
      updatedRows.push({ id, values });
      return { id, ...values } as unknown as LeadRow;
    },
    async findBySourceAndExternalId(_client: unknown, _orgId: string, _source: string, _externalId: string) {
      return null; // manual entries use a fresh random externalId every time — never an existing row to update
    },
    async findByOrgAndWebsiteUrl(_client: unknown, _orgId: string, normalizedUrl: string) {
      return overrides.leadByUrl?.[normalizedUrl] ?? null;
    },
    async findByOrgAndBusinessName(_client: unknown, _orgId: string, businessName: string) {
      return overrides.leadByName?.[businessName.toLowerCase()] ?? null;
    },
  };

  const companyRepository = {
    async findByOrgAndUrl(_client: unknown, _orgId: string, normalizedUrl: string) {
      return overrides.companyByUrl?.[normalizedUrl] ?? null;
    },
    async findByOrgAndBusinessName(_client: unknown, _orgId: string, businessName: string) {
      return overrides.companyByName?.[businessName.toLowerCase()] ?? null;
    },
  };

  const runCrawlAdapter = async (url: string) => overrides.crawlsByUrl?.[url] ?? fakeCrawl({ requestedUrl: url, finalUrl: url });

  return { client: {} as never, leadRepository, companyRepository, runCrawlAdapter, insertedRows, updatedRows };
}

describe("manual-lead-service: checkManualLeadDuplicate", () => {
  test("no website, no name match — new", async () => {
    const deps = fakeDeps();
    const result = await checkManualLeadDuplicate(deps, "org-1", { businessName: "Totally New Place", websiteUrl: null });
    assert.deepEqual(result, { kind: "new" });
  });

  test("website URL matches an existing real company — duplicate, blocks", async () => {
    const deps = fakeDeps({ companyByUrl: { "existing.test": { id: "company-1", business_name: "Existing Co" } as CompanyRow } });
    const result = await checkManualLeadDuplicate(deps, "org-1", { businessName: "New Name Same Site", websiteUrl: "https://existing.test/" });
    assert.deepEqual(result, { kind: "duplicate", match: { matchedOn: "website_url", type: "company", id: "company-1", name: "Existing Co" } });
  });

  test("website URL matches an existing lead (not yet promoted to a company) — duplicate, blocks", async () => {
    const deps = fakeDeps({ leadByUrl: { "existing-lead.test": { id: "lead-9", business_name: "Existing Lead Co" } as LeadRow } });
    const result = await checkManualLeadDuplicate(deps, "org-1", { businessName: "New Name Same Site", websiteUrl: "https://existing-lead.test/" });
    assert.deepEqual(result, { kind: "duplicate", match: { matchedOn: "website_url", type: "lead", id: "lead-9", name: "Existing Lead Co" } });
  });

  test("business name matches an existing company, case-insensitively — duplicate, blocks even with no website given", async () => {
    const deps = fakeDeps({ companyByName: { "pepi's pizza": { id: "company-2", business_name: "Pepi's Pizza" } as CompanyRow } });
    const result = await checkManualLeadDuplicate(deps, "org-1", { businessName: "PEPI'S PIZZA", websiteUrl: null });
    assert.deepEqual(result, { kind: "duplicate", match: { matchedOn: "business_name", type: "company", id: "company-2", name: "Pepi's Pizza" } });
  });

  test("business name matches an existing lead — duplicate, blocks", async () => {
    const deps = fakeDeps({ leadByName: { "broken site": { id: "lead-3", business_name: "Broken Site" } as LeadRow } });
    const result = await checkManualLeadDuplicate(deps, "org-1", { businessName: "Broken Site", websiteUrl: null });
    assert.deepEqual(result, { kind: "duplicate", match: { matchedOn: "business_name", type: "lead", id: "lead-3", name: "Broken Site" } });
  });

  test("website given but unmatched, and name unmatched too — new, never a false positive", async () => {
    const deps = fakeDeps({ companyByUrl: { "unrelated.test": { id: "company-9" } as CompanyRow } });
    const result = await checkManualLeadDuplicate(deps, "org-1", { businessName: "Genuinely New Place", websiteUrl: "https://genuinely-new.test/" });
    assert.deepEqual(result, { kind: "new" });
  });
});

describe("manual-lead-service: runManualLeadQualification (reuses the exact same qualifyCandidate/scoring/upsertLead pipeline)", () => {
  test("qualification overhaul (2026-09-14): no website URL supplied — a real new-build opportunity, never a rejection", async () => {
    // Robert's own business builds brand-new sites for businesses without
    // one — the best lead category, not a rejection (confirmed live:
    // Balsamo-Codovano Funeral Home was being auto-rejected for this alone
    // before this fix, same real bug on the OSM path).
    const deps = fakeDeps();
    const lead = await runManualLeadQualification(deps, "org-1", { businessName: "No Website Yet", address: "1 Main St, Kitchener, ON" }, FAKE_AREA);
    assert.equal(lead.status, "candidate");
    assert.equal(lead.makeover_potential, "new_build");
    assert.equal(lead.rejection_reason, null);
    assert.equal(lead.website_score, null, "honestly un-scoreable — there is no site to score");
    assert.equal(lead.opportunity_score, null);
    assert.equal(lead.confidence_score, null);
    assert.match(lead.main_opportunity!, /new/i);
    assert.equal(deps.insertedRows[0].discovery_source, MANUAL_DISCOVERY_SOURCE);
    assert.equal(deps.insertedRows[0].location, FAKE_AREA.displayName);
    assert.equal(deps.insertedRows[0].latitude, FAKE_AREA.latitude);
    assert.equal(deps.insertedRows[0].longitude, FAKE_AREA.longitude);
  });

  test("qualification overhaul (2026-09-14): a real phone captured for a no-website business still produces an honest, non-fabricated conversion recommendation", async () => {
    const deps = fakeDeps();
    const lead = await runManualLeadQualification(
      deps,
      "org-1",
      { businessName: "No Website But Real Phone", address: "1 Main St, Kitchener, ON", phone: "555-999-0000" },
      FAKE_AREA
    );
    assert.equal(lead.makeover_potential, "new_build");
    assert.match(lead.recommended_conversion_goal!, /phone/i);
  });

  test("website URL supplied, real crawl fails — rejected with the real reason, never a generic message", async () => {
    const deps = fakeDeps({
      crawlsByUrl: { "https://broken-manual.test/": fakeCrawl({ fetchError: "ETIMEDOUT", statusCode: null }) },
    });
    const lead = await runManualLeadQualification(
      deps,
      "org-1",
      { businessName: "Broken Manual Entry", address: "1 Main St, Kitchener, ON", websiteUrl: "https://broken-manual.test/" },
      FAKE_AREA
    );
    assert.equal(lead.status, "rejected");
    assert.match(lead.rejection_reason!, /ETIMEDOUT/);
  });

  test("website URL supplied, real crawl succeeds — qualified with real scores, hero pattern, and discovery_source: 'manual'", async () => {
    const deps = fakeDeps();
    const lead = await runManualLeadQualification(
      deps,
      "org-1",
      { businessName: "Real Manual Entry", address: "1 Main St, Kitchener, ON", websiteUrl: "https://real-restaurant.test/", phone: "555-123-4567" },
      FAKE_AREA
    );
    assert.equal(lead.status, "candidate");
    assert.equal(deps.insertedRows[0].discovery_source, MANUAL_DISCOVERY_SOURCE);
    // No OSM tag for a manual entry — industryBucketFromOsmTag's own documented safe default applies.
    assert.equal(deps.insertedRows[0].industry, "general");
    assert.ok(typeof deps.insertedRows[0].website_score === "number");
    assert.ok(typeof deps.insertedRows[0].opportunity_score === "number");
    assert.ok(typeof deps.insertedRows[0].confidence_score === "number");
    assert.ok(deps.insertedRows[0].recommended_hero_pattern);
    assert.equal(deps.insertedRows[0].discovery_phone, "555-123-4567");
    assert.equal(deps.insertedRows[0].discovery_address, "1 Main St, Kitchener, ON");
  });

  test("qualification overhaul (2026-09-14): a manually-added business whose website already scores 100/100 gets status: 'rejected', not 'candidate' — the same real bug confirmed live on Pulse-MD Urgent Care and Stop & Shop", async () => {
    const deps = fakeDeps({
      crawlsByUrl: {
        "https://great-existing-site.test/": fakeCrawl({
          requestedUrl: "https://great-existing-site.test/",
          finalUrl: "https://great-existing-site.test/",
          metaDescription: "A genuinely great, complete site.",
          headingCounts: { h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
          robotsTxtFound: true,
          sitemapFound: true,
          htmlByteSize: 45_000,
          contact: { phones: ["555-0001"], emails: ["hi@great-existing-site.test"], address: "1 Main St", hours: null },
          internalLinkCount: 12,
        }),
      },
    });
    const lead = await runManualLeadQualification(
      deps,
      "org-1",
      { businessName: "Already Great Manual Entry", address: "1 Main St, Kitchener, ON", websiteUrl: "https://great-existing-site.test/" },
      FAKE_AREA
    );
    assert.equal(lead.makeover_potential, "reject");
    assert.equal(lead.status, "rejected", "status must respect makeover_potential's own reject verdict, not hardcode 'candidate' regardless");
    assert.match(lead.rejection_reason ?? "", /no real upside/i);
    assert.doesNotMatch(lead.main_opportunity ?? "", /real upside for a redesign/, "must never claim upside exists when the score says it doesn't");
  });

  test("each manual entry gets a fresh, unique discovery_external_id — never collides with, or reuses, another manual entry's row", async () => {
    const deps = fakeDeps();
    await runManualLeadQualification(deps, "org-1", { businessName: "First", address: "1 Main St", websiteUrl: "https://real-restaurant.test/" }, FAKE_AREA);
    await runManualLeadQualification(deps, "org-1", { businessName: "Second", address: "2 Main St", websiteUrl: "https://real-restaurant.test/" }, FAKE_AREA);
    assert.equal(deps.insertedRows.length, 2);
    assert.notEqual(deps.insertedRows[0].discovery_external_id, deps.insertedRows[1].discovery_external_id);
  });
});
