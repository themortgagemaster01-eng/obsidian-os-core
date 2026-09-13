import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { findOrCreateCompany, type CompanyServiceDeps } from "@/lib/services/company-service";
import type { CompanyRow } from "@/lib/repositories/company-repository";

function fakeCompany(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: "company-1",
    organization_id: "org-1",
    business_name: "Acme Diner",
    website_url: "acme-diner.test",
    industry: null,
    business_category: null,
    first_discovered_at: "2026-01-01T00:00:00Z",
    last_mission_id: null,
    total_missions_count: 0,
    last_contacted_at: null,
    last_proposal_amount: null,
    last_proposal_sent_at: null,
    follow_up_date: null,
    design_preferences: {},
    do_not_contact: false,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createFakeDeps(existingByUrl: CompanyRow | null, existingByName: CompanyRow | null) {
  const inserted: unknown[] = [];
  const updated: { id: string; values: unknown }[] = [];
  const urlLookups: string[] = [];
  const nameLookups: string[] = [];

  const deps: CompanyServiceDeps = {
    client: {} as never,
    companyRepository: {
      async findByOrgAndUrl(_client: unknown, _orgId: unknown, normalizedUrl: string) {
        urlLookups.push(normalizedUrl);
        return existingByUrl;
      },
      async findByOrgAndBusinessName(_client: unknown, _orgId: unknown, businessName: string) {
        nameLookups.push(businessName);
        return existingByName;
      },
      async insert(_client: unknown, values: Partial<CompanyRow>) {
        inserted.push(values);
        return fakeCompany(values);
      },
      async update(_client: unknown, id: string, values: Partial<CompanyRow>) {
        updated.push({ id, values });
        return fakeCompany({ id, ...values });
      },
    } as never,
  };

  return { deps, inserted, updated, urlLookups, nameLookups };
}

describe("company-service: findOrCreateCompany — no-website dedup fallback (Robert's locked spec, §4)", () => {
  test("a real website URL still dedups by (organization_id, normalized website_url) — unchanged existing-website behavior", async () => {
    const { deps, urlLookups, nameLookups } = createFakeDeps(null, null);
    await findOrCreateCompany(deps, { organizationId: "org-1", businessName: "Acme Diner", websiteUrl: "https://Acme-Diner.test/" });
    assert.deepEqual(urlLookups, ["acme-diner.test"]);
    assert.equal(nameLookups.length, 0, "must never fall back to name-based dedup when a website URL is present");
  });

  test("a null websiteUrl (confirmed no-website business) dedups by business_name instead — never a website_url lookup", async () => {
    const { deps, urlLookups, nameLookups } = createFakeDeps(null, null);
    await findOrCreateCompany(deps, { organizationId: "org-1", businessName: "Skyline Towing", websiteUrl: null });
    assert.equal(urlLookups.length, 0);
    assert.deepEqual(nameLookups, ["Skyline Towing"]);
  });

  test("a null websiteUrl finding an existing company by name bumps total_missions_count/last_mission_id instead of creating a duplicate", async () => {
    const { deps, inserted, updated } = createFakeDeps(null, fakeCompany({ id: "company-existing", website_url: null, total_missions_count: 2 }));
    const result = await findOrCreateCompany(deps, { organizationId: "org-1", businessName: "Skyline Towing", websiteUrl: null }, "mission-9");
    assert.equal(inserted.length, 0, "must never create a second company for the same no-website business");
    assert.equal(updated.length, 1);
    assert.equal(updated[0].id, "company-existing");
    assert.equal(result.id, "company-existing");
  });

  test("a null websiteUrl with no existing match creates a new company with website_url: null — never a fabricated URL", async () => {
    const { deps, inserted } = createFakeDeps(null, null);
    await findOrCreateCompany(deps, { organizationId: "org-1", businessName: "Frasers Hardware", websiteUrl: null });
    assert.equal(inserted.length, 1);
    assert.equal((inserted[0] as { website_url: string | null }).website_url, null);
  });
});
