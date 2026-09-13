import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { promoteLeadToMission, type LeadPromotionServiceDeps } from "@/lib/services/lead-promotion-service";
import type { LeadRow, LeadUpdate } from "@/lib/repositories/lead-repository";
import type { MissionRow } from "@/lib/repositories/mission-repository";
import type { CreateMissionRequest } from "@/lib/services/mission-service";

function fakeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    organization_id: "org-1",
    business_name: "Acme Diner",
    website_url: "https://acme-diner.test/",
    industry: "restaurant",
    business_category: "amenity=restaurant",
    location: "Kitchener, Ontario",
    latitude: 43.45,
    longitude: -80.49,
    discovery_source: "openstreetmap",
    discovery_external_id: "node/1",
    discovery_phone: null,
    discovery_address: null,
    status: "candidate",
    rejection_reason: null,
    website_score: 40,
    opportunity_score: 65,
    confidence_score: 60,
    main_weaknesses: [],
    main_opportunity: "Real upside.",
    recommended_hero_pattern: "editorial-typographic",
    recommended_design_strategy: "Editorial",
    recommended_conversion_goal: "Phone call",
    makeover_potential: "high",
    makeover_potential_reasons: ["Solid opportunity."],
    contact_evidence: null,
    social_links: null,
    crawl_result: null,
    company_id: null,
    mission_id: null,
    error_message: null,
    discovered_at: "2026-01-01T00:00:00Z",
    qualified_at: "2026-01-01T00:00:00Z",
    promoted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fakeMission(overrides: Partial<MissionRow> = {}): MissionRow {
  return {
    id: "mission-1",
    owner_id: "user-1",
    organization_id: "org-1",
    business_name: "Acme Diner",
    website_url: "https://acme-diner.test/",
    company_id: "company-1",
    state: "discovered",
    state_changed_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as MissionRow;
}

/** A small in-memory fake of the two injected dependencies — real enough to exercise eligibility guards, the createMission call shape, and the lead-row write-back without a database. */
function createFakeDeps(lead: LeadRow | null): LeadPromotionServiceDeps & { createMissionCalls: CreateMissionRequest[]; updatedValues: LeadUpdate[] } {
  const createMissionCalls: CreateMissionRequest[] = [];
  const updatedValues: LeadUpdate[] = [];

  return {
    client: {} as never,
    leadRepository: {
      async findById() {
        return lead;
      },
      async update(_client, _id, values) {
        updatedValues.push(values);
        return { ...(lead as LeadRow), ...values } as LeadRow;
      },
    },
    async createMission(_client, request) {
      createMissionCalls.push(request);
      return fakeMission();
    },
    createMissionCalls,
    updatedValues,
  };
}

describe("lead-promotion-service: promoteLeadToMission (CTO Phase 2 directive §6, Launch Makeover)", () => {
  test("creates a real mission seeded with the lead's own business_name/websiteUrl/industry/businessCategory — never a generic empty project", async () => {
    const deps = createFakeDeps(fakeLead());
    const { mission } = await promoteLeadToMission(deps, { leadId: "lead-1", ownerId: "user-1" });

    assert.equal(mission.id, "mission-1");
    assert.equal(deps.createMissionCalls.length, 1);
    assert.deepEqual(deps.createMissionCalls[0], {
      ownerId: "user-1",
      organizationId: "org-1",
      businessName: "Acme Diner",
      websiteUrl: "https://acme-diner.test/",
      industry: "restaurant",
      businessCategory: "amenity=restaurant",
    });
  });

  test("writes the lead row back to promoted, with real company_id/mission_id/promoted_at — the only place a lead is ever set to promoted", async () => {
    const deps = createFakeDeps(fakeLead());
    await promoteLeadToMission(deps, { leadId: "lead-1", ownerId: "user-1" });

    assert.equal(deps.updatedValues.length, 1);
    const values = deps.updatedValues[0];
    assert.equal(values.status, "promoted");
    assert.equal(values.company_id, "company-1");
    assert.equal(values.mission_id, "mission-1");
    assert.ok(typeof values.promoted_at === "string" && values.promoted_at.length > 0);
  });

  test("throws for a lead that was never qualified (status 'pending') — never launches a makeover on an unqualified candidate", async () => {
    const deps = createFakeDeps(fakeLead({ status: "pending" }));
    await assert.rejects(() => promoteLeadToMission(deps, { leadId: "lead-1", ownerId: "user-1" }), /not "candidate"/);
    assert.equal(deps.createMissionCalls.length, 0);
  });

  test("throws for a lead that was rejected during qualification", async () => {
    const deps = createFakeDeps(fakeLead({ status: "rejected" }));
    await assert.rejects(() => promoteLeadToMission(deps, { leadId: "lead-1", ownerId: "user-1" }), /not "candidate"/);
  });

  test("throws rather than silently creating a second mission for an already-promoted lead", async () => {
    const deps = createFakeDeps(fakeLead({ status: "promoted", mission_id: "mission-existing" }));
    await assert.rejects(() => promoteLeadToMission(deps, { leadId: "lead-1", ownerId: "user-1" }), /already been promoted/);
    assert.equal(deps.createMissionCalls.length, 0);
  });

  test("throws for a missing lead id", async () => {
    const deps = createFakeDeps(null);
    await assert.rejects(() => promoteLeadToMission(deps, { leadId: "lead-404", ownerId: "user-1" }), /not found/);
  });

  describe("no-website evidence gate (Robert's locked spec, §1/§3)", () => {
    test("throws for a no-website lead with no phone or address on record (UNCERTAIN) — never generates a customer-facing preview from name/category/town alone", async () => {
      const deps = createFakeDeps(fakeLead({ website_url: null, discovery_phone: null, discovery_address: null }));
      await assert.rejects(
        () => promoteLeadToMission(deps, { leadId: "lead-1", ownerId: "user-1" }),
        /does not clear the no-website evidence gate \(UNCERTAIN\)/
      );
      assert.equal(deps.createMissionCalls.length, 0);
    });

    test("succeeds (CONFIRMED) for a no-website lead with a verified phone number, even with no address", async () => {
      const deps = createFakeDeps(fakeLead({ website_url: null, discovery_phone: "555-0100", discovery_address: null }));
      const { mission } = await promoteLeadToMission(deps, { leadId: "lead-1", ownerId: "user-1" });
      assert.equal(mission.id, "mission-1");
      assert.equal(deps.createMissionCalls.length, 1);
      assert.equal(deps.createMissionCalls[0].websiteUrl, null);
    });

    test("succeeds (CONFIRMED) for a no-website lead with a specific street address, even with no phone", async () => {
      const deps = createFakeDeps(fakeLead({ website_url: null, discovery_phone: null, discovery_address: "123 Main St, Mahopac NY" }));
      const { mission } = await promoteLeadToMission(deps, { leadId: "lead-1", ownerId: "user-1" });
      assert.equal(deps.createMissionCalls.length, 1);
      assert.equal(deps.createMissionCalls[0].websiteUrl, null);
    });

    test("real, currently-discovered no-website leads (Skyline Towing / Frasers Hardware / Keller William Realty Partners' actual evidence profile: name + category + town-level geocode only, no phone, no address) are correctly rejected, not fabricated around", async () => {
      const deps = createFakeDeps(
        fakeLead({
          business_name: "Skyline Towing And Auto Repair",
          website_url: null,
          discovery_phone: null,
          discovery_address: null,
          location: "Mahopac, Mahopac Falls, Town of Carmel, Putnam County, New York, United States",
        })
      );
      await assert.rejects(() => promoteLeadToMission(deps, { leadId: "lead-1", ownerId: "user-1" }), /UNCERTAIN/);
    });
  });
});
