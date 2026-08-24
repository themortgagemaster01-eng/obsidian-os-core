import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolveRefinement,
  refineExperience,
  type ExperienceRefinementServiceDeps,
} from "@/lib/services/experience-refinement-service";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import type { IndustryBucket } from "@/lib/design-references/reference-library";
import type { ContactInfo } from "@/lib/adapters/types";
import type { WebsiteDesignRow } from "@/lib/repositories/website-design-repository";
import type { DesignBriefRow } from "@/lib/repositories/design-brief-repository";
import type { MissionRow } from "@/lib/repositories/mission-repository";
import type { ExperienceRefinementRow, ExperienceRefinementInsert } from "@/lib/repositories/experience-refinement-repository";
import type { HumanExperiencePreference } from "@/shared/design-intelligence/types";
import type { DomainEvent } from "@/lib/events/types";

const NO_CONTACT_EVIDENCE: ContactInfo = { phones: [], emails: [], address: null, hours: null };

// Reuses design-generation-service.test.ts's briefFor shape so this fixture
// never independently invents field names design-brief-service.ts's real
// DesignBrief type could reject.
function briefFor(industryBucket: IndustryBucket, overrides: Partial<DesignBrief> = {}): DesignBrief {
  return {
    missionId: "mission-1",
    businessName: "Acme Co",
    websiteUrl: "https://acme.test",
    industry: null,
    industryBucket,
    citedInsights: [{ category: "performance", insightId: "slow-page-load", statement: "Pages load slowly." }],
    contactEvidence: NO_CONTACT_EVIDENCE,
    targetAudience: "Test audience",
    positioning: "Test positioning",
    direction: {
      layoutFamily: "editorial",
      typographicMood: "test mood",
      colorDirection: "test color direction",
      motionIntensity: "restrained",
    },
    heroThesis: "Test hero thesis grounded in real evidence.",
    signatureElement: { element: "service-list-editorial-treatment", justification: "Test justification." },
    contentEmphasis: [],
    referencesConsidered: [{ referenceId: "test-ref", reasoning: "test reasoning" }],
    ...overrides,
  };
}

// A law-firm/trust-authority profile: real team + certifications + reviews —
// rich enough evidence in isolation, but trust-authority's own mode ceiling
// ("subtle") should still govern, exactly like experience-planner.test.ts's
// "professionalServices" validation fixture.
const LAW_FIRM_BRIEF = briefFor("lawFirm", {
  team: [{ heading: "Our Team", excerpt: "Real team bio.", sourceUrl: "https://acme.test/team" }],
  certifications: [{ heading: "Bar Certified", excerpt: "Licensed.", sourceUrl: "https://acme.test/about" }],
  reviews: { count: 12, averageRating: 4.8, source: "schema.org structured data" },
});

// A sparse general-bucket profile with no real evidence beyond one service —
// mirrors experience-planner.test.ts's "sparseLocalBusiness" fixture, whose
// evidence ceiling alone is already "none".
const SPARSE_BRIEF = briefFor("general", {
  services: [{ heading: "Service", excerpt: "One real service.", sourceUrl: "https://acme.test" }],
});

const NO_DESIGN_MEMORY: DesignMemory | null = null;

function fakeWireframe(heroPattern: string) {
  return {
    layoutFamily: "editorial",
    sections: [{ type: "hero", rationale: "test" }],
    signatureElement: { element: "service-list-editorial-treatment", justification: "test" },
    compositionVariant: {
      heroPattern,
      contentWidth: "standard",
      spacingRhythm: "standard",
      servicesPattern: "list",
      credibilityPattern: "inline",
      paddingBiasSteps: 0,
    },
  };
}

function fakeWebsiteDesign(overrides: Partial<WebsiteDesignRow> = {}): WebsiteDesignRow {
  return {
    id: "design-1",
    design_brief_id: "brief-1",
    mission_id: "mission-1",
    organization_id: "org-1",
    status: "complete",
    wireframe: fakeWireframe("editorial-typographic") as unknown as WebsiteDesignRow["wireframe"],
    components: [] as unknown as WebsiteDesignRow["components"],
    refined_design: null,
    qa_result: null,
    preview_screenshot_desktop_path: null,
    preview_screenshot_mobile_path: null,
    preview_screenshot_captured_at: null,
    preview_screenshot_error: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: "",
    ...overrides,
  };
}

function fakeDesignBriefRow(brief: DesignBrief, overrides: Partial<DesignBriefRow> = {}): DesignBriefRow {
  return {
    id: "brief-1",
    mission_id: "mission-1",
    organization_id: "org-1",
    company_id: null,
    status: "complete",
    industry_bucket: brief.industryBucket,
    brief: brief as unknown as DesignBriefRow["brief"],
    design_memory: NO_DESIGN_MEMORY as unknown as DesignBriefRow["design_memory"],
    reasoning: null,
    self_critique: null,
    reviewed_at: null,
    reviewed_by: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: "",
    ...overrides,
  };
}

function fakeMission(overrides: Partial<MissionRow> = {}): MissionRow {
  return {
    id: "mission-1",
    owner_id: "user-1",
    organization_id: "org-1",
    business_name: "Acme Co",
    website_url: "https://acme.test/",
    company_id: null,
    state: "qa",
    state_changed_at: "",
    created_at: "",
    updated_at: "",
    ...overrides,
  } as MissionRow;
}

/** In-memory fake of the whole dependency surface — no database, mirrors preview-capture-service.test.ts's createFakeDeps pattern. */
function createFakeDeps(overrides: {
  websiteDesign?: WebsiteDesignRow | null;
  designBriefRow?: DesignBriefRow | null;
  mission?: MissionRow | null;
}): ExperienceRefinementServiceDeps & { inserted: ExperienceRefinementInsert[]; publishedEvents: DomainEvent[] } {
  const websiteDesign = overrides.websiteDesign === undefined ? fakeWebsiteDesign() : overrides.websiteDesign;
  const designBriefRow = overrides.designBriefRow === undefined ? fakeDesignBriefRow(LAW_FIRM_BRIEF) : overrides.designBriefRow;
  const mission = overrides.mission === undefined ? fakeMission() : overrides.mission;
  const inserted: ExperienceRefinementInsert[] = [];
  const publishedEvents: DomainEvent[] = [];

  return {
    client: {} as ExperienceRefinementServiceDeps["client"],
    experienceRefinementRepository: {
      async insert(_client, values) {
        inserted.push(values);
        const row: ExperienceRefinementRow = {
          id: `refinement-${inserted.length}`,
          created_at: new Date().toISOString(),
          ...values,
        } as ExperienceRefinementRow;
        return row;
      },
      async findLatestByWebsiteDesign() {
        return null;
      },
      async findLatestByMission() {
        return null;
      },
      async listByMission() {
        return [];
      },
    },
    websiteDesignRepository: {
      async findLatestByMission() {
        return websiteDesign;
      },
    } as unknown as ExperienceRefinementServiceDeps["websiteDesignRepository"],
    designBriefRepository: {
      async findById() {
        return designBriefRow;
      },
    } as unknown as ExperienceRefinementServiceDeps["designBriefRepository"],
    missionRepository: {
      async findById() {
        return mission;
      },
    } as unknown as ExperienceRefinementServiceDeps["missionRepository"],
    eventBus: {
      async publish(event) {
        publishedEvents.push(event);
      },
      subscribe: () => () => {},
    },
    inserted,
    publishedEvents,
  };
}

describe("experience-refinement-service: resolveRefinement (pure)", () => {
  test("a law firm/trust-authority baseline cannot be exceeded even when both axes request more simultaneously", () => {
    const bothMore: HumanExperiencePreference = { energy: "more-energetic", motion: "more" };
    const { baseline, resolved } = resolveRefinement(LAW_FIRM_BRIEF, NO_DESIGN_MEMORY, "editorial-typographic", bothMore);
    assert.equal(baseline.mode, "trust-authority");
    assert.equal(resolved.mode, "trust-authority");
    assert.equal(resolved.motionBudget, "subtle");
  });

  test("a sparse business cannot be artificially made motion-rich by any preference combination", () => {
    const combos: HumanExperiencePreference[] = [
      { energy: "more-energetic", motion: "more" },
      { energy: "more-energetic", motion: "recommended" },
      { energy: "keep", motion: "more" },
    ];
    for (const preference of combos) {
      const { resolved } = resolveRefinement(SPARSE_BRIEF, NO_DESIGN_MEMORY, "editorial-typographic", preference);
      assert.equal(resolved.motionBudget, "none", `preference ${JSON.stringify(preference)} must not move a sparse business off "none"`);
    }
  });

  test("reset to AI recommendation: the neutral preference resolves to the exact same mode and motion budget as the baseline", () => {
    const neutral: HumanExperiencePreference = { energy: "keep", motion: "recommended" };
    const { baseline, resolved, wasConstrained } = resolveRefinement(LAW_FIRM_BRIEF, NO_DESIGN_MEMORY, "editorial-typographic", neutral);
    assert.equal(resolved.mode, baseline.mode);
    assert.equal(resolved.motionBudget, baseline.motionBudget);
    assert.equal(wasConstrained, false);
    // The rationale legitimately differs from the baseline's — it honestly notes
    // "no change requested" for the reset action itself, which the baseline
    // (computed without any preference at all) never mentions.
    assert.ok(resolved.rationale.includes("No change requested"));
  });

  test("wasConstrained is true only when a 'more' request actually hit the real ceiling", () => {
    const more: HumanExperiencePreference = { energy: "more-energetic", motion: "more" };
    const less: HumanExperiencePreference = { energy: "calmer", motion: "less" };
    const constrained = resolveRefinement(LAW_FIRM_BRIEF, NO_DESIGN_MEMORY, "editorial-typographic", more);
    const notConstrained = resolveRefinement(LAW_FIRM_BRIEF, NO_DESIGN_MEMORY, "editorial-typographic", less);
    assert.equal(constrained.wasConstrained, true);
    assert.equal(notConstrained.wasConstrained, false);
  });

  test("explanation honestly names the real ceiling when a request is constrained", () => {
    const more: HumanExperiencePreference = { energy: "more-energetic", motion: "more" };
    const { explanation } = resolveRefinement(LAW_FIRM_BRIEF, NO_DESIGN_MEMORY, "editorial-typographic", more);
    assert.match(explanation, /could not go further|real ceiling/);
  });
});

describe("experience-refinement-service: refineExperience (orchestration)", () => {
  test("always INSERTS a new row — never updates a previous one — matching the insert-only history requirement", async () => {
    const deps = createFakeDeps({});
    await refineExperience(deps, "mission-1", { energy: "keep", motion: "recommended" }, "founder-1");
    await refineExperience(deps, "mission-1", { energy: "calmer", motion: "less" }, "founder-1");
    assert.equal(deps.inserted.length, 2);
    // Each insert call carries its own distinct baseline/resolved/preference triple.
    assert.notDeepEqual(deps.inserted[0].preference, deps.inserted[1].preference);
  });

  test("persists all three distinct values: baseline, preference, and resolved plan", async () => {
    const deps = createFakeDeps({});
    const preference: HumanExperiencePreference = { energy: "more-energetic", motion: "more" };
    await refineExperience(deps, "mission-1", preference, "founder-1");
    const row = deps.inserted[0];
    assert.deepEqual(row.preference, preference);
    assert.ok(row.baseline_plan);
    assert.ok(row.resolved_plan);
    assert.notDeepEqual(row.baseline_plan, row.resolved_plan);
  });

  test("publishes ExperienceRefined with refinedBy, preference, baseline, and resolved plan", async () => {
    const deps = createFakeDeps({});
    await refineExperience(deps, "mission-1", { energy: "calmer", motion: "recommended" }, "founder-42");
    assert.equal(deps.publishedEvents.length, 1);
    const event = deps.publishedEvents[0];
    assert.equal(event.type, "ExperienceRefined");
    if (event.type === "ExperienceRefined") {
      assert.equal(event.payload.refinedBy, "founder-42");
      assert.equal(event.payload.preference.energy, "calmer");
    }
  });

  test("throws when no completed website design exists for the mission", async () => {
    const deps = createFakeDeps({ websiteDesign: null });
    await assert.rejects(
      () => refineExperience(deps, "mission-1", { energy: "keep", motion: "recommended" }, "founder-1"),
      /No completed website design/
    );
  });

  test("throws when the website design is not yet complete", async () => {
    const deps = createFakeDeps({ websiteDesign: fakeWebsiteDesign({ status: "running", wireframe: null }) });
    await assert.rejects(
      () => refineExperience(deps, "mission-1", { energy: "keep", motion: "recommended" }, "founder-1"),
      /No completed website design/
    );
  });

  test("throws when no completed design brief exists", async () => {
    const deps = createFakeDeps({ designBriefRow: null });
    await assert.rejects(
      () => refineExperience(deps, "mission-1", { energy: "keep", motion: "recommended" }, "founder-1"),
      /No completed Design Brief/
    );
  });

  test("throws a clear error for a pre-Phase-6.1 stored wireframe with no compositionVariant, rather than crashing or guessing a hero pattern", async () => {
    const bareWireframe = { layoutFamily: "editorial", sections: [], signatureElement: { element: "x", justification: "x" } };
    const deps = createFakeDeps({ websiteDesign: fakeWebsiteDesign({ wireframe: bareWireframe as unknown as WebsiteDesignRow["wireframe"] }) });
    await assert.rejects(
      () => refineExperience(deps, "mission-1", { energy: "keep", motion: "recommended" }, "founder-1"),
      /compositionVariant/
    );
  });

  test("evidence-change scenario: refining always resolves off the mission's CURRENT latest website_design, establishing a fresh baseline rather than reusing an older one's evidence", async () => {
    const olderDesign = fakeWebsiteDesign({ id: "design-old", design_brief_id: "brief-old" });
    const olderBrief = fakeDesignBriefRow(SPARSE_BRIEF, { id: "brief-old" });
    // findLatestByMission is the only lookup refineExperience performs — it
    // always reflects whatever the CURRENT latest run is, so a fresh
    // generation naturally produces a fresh baseline on the very next call
    // without refineExperience needing any special-cased "evidence changed" branch.
    const newerDesign = fakeWebsiteDesign({ id: "design-new", design_brief_id: "brief-new" });
    const newerBrief = fakeDesignBriefRow(LAW_FIRM_BRIEF, { id: "brief-new" });

    let callCount = 0;
    const deps = createFakeDeps({ websiteDesign: olderDesign, designBriefRow: olderBrief });
    deps.websiteDesignRepository.findLatestByMission = async () => {
      callCount += 1;
      return callCount === 1 ? olderDesign : newerDesign;
    };
    deps.designBriefRepository.findById = async (_client, id) => (id === "brief-old" ? olderBrief : newerBrief);

    const first = await refineExperience(deps, "mission-1", { energy: "keep", motion: "recommended" }, "founder-1");
    const second = await refineExperience(deps, "mission-1", { energy: "keep", motion: "recommended" }, "founder-1");

    assert.equal(first.website_design_id, "design-old");
    assert.equal(second.website_design_id, "design-new");
    assert.notDeepEqual(first.baseline_plan, second.baseline_plan);
  });
});
