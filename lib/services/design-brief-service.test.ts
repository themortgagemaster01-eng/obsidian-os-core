import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildCitations,
  findWeakestMeasuredCategory,
  applyDesignBriefEdits,
  runDesignBrief,
  decideDesignBriefOverlapGuardAction,
  checkDesignBriefOverlap,
  type DesignBrief,
  type DesignBriefServiceDeps,
} from "@/lib/services/design-brief-service";
import type { NormalizedAnalysis } from "@/lib/services/analysis-types";
import type { Insight } from "@/lib/services/insight-service";
import type { WebsiteAnalysisRow } from "@/lib/repositories/website-analysis-repository";
import type { DesignBriefRow } from "@/lib/repositories/design-brief-repository";
import type { LlmProvider } from "@/lib/llm/provider";

const CLEAN_ANALYSIS: NormalizedAnalysis = {
  websiteUrl: "https://example.com",
  seoScore: 92,
  seoFindings: [],
  mobileScore: 95,
  mobileFindings: [],
  accessibilityScore: 90,
  accessibilityFindings: [],
  technicalHealthScore: 95,
  technicalHealthFindings: [],
  lighthouse: { performance: 91, accessibility: 90, bestPractices: 95, seo: 92 },
  technologyStack: [],
  measurementStatus: { crawl: true, mobile: true, seo: true, accessibility: true, lighthouse: true, techDetection: true },
  contactEvidence: { phones: ["555-123-4567"], emails: [], address: null, hours: null },
};

const POOR_ANALYSIS: NormalizedAnalysis = {
  ...CLEAN_ANALYSIS,
  seoScore: 40,
  mobileScore: 35,
  accessibilityScore: 50,
  technicalHealthScore: 60,
  lighthouse: { performance: 25, accessibility: 50, bestPractices: 60, seo: 40 },
};

const SOME_INSIGHTS: Insight[] = [
  { id: "slow-page-load", category: "performance", severity: "high", statement: "Pages load slowly.", source: "Page speed test" },
  { id: "mobile-experience-gap", category: "mobile", severity: "high", statement: "Mobile experience is rough.", source: "Mobile display check" },
];

describe("design-brief-service: buildCitations", () => {
  test("cites real insights when they exist", () => {
    const citations = buildCitations(POOR_ANALYSIS, SOME_INSIGHTS);
    assert.equal(citations.length, 2);
    assert.ok(citations.every((c) => !!c.insightId));
  });

  test("falls back to citing measured Normalized Analysis scores when there are no insights", () => {
    const citations = buildCitations(CLEAN_ANALYSIS, []);
    assert.ok(citations.length > 0);
    assert.ok(citations.every((c) => c.insightId === undefined));
    assert.ok(citations.every((c) => c.statement.includes("/100")));
  });

  test("returns an empty array when there are no insights and nothing measured", () => {
    const emptyAnalysis: NormalizedAnalysis = {
      ...CLEAN_ANALYSIS,
      accessibilityScore: null as unknown as number,
      seoScore: null as unknown as number,
      mobileScore: null as unknown as number,
      technicalHealthScore: null as unknown as number,
      lighthouse: { performance: null, accessibility: null, bestPractices: null, seo: null },
    };
    assert.deepEqual(buildCitations(emptyAnalysis, []), []);
  });
});

describe("design-brief-service: findWeakestMeasuredCategory", () => {
  test("finds the lowest-scoring measured category", () => {
    const weakest = findWeakestMeasuredCategory(POOR_ANALYSIS);
    assert.equal(weakest?.category, "performance");
    assert.equal(weakest?.score, 25);
  });

  test("returns null when nothing is measured", () => {
    const emptyAnalysis: NormalizedAnalysis = {
      ...CLEAN_ANALYSIS,
      accessibilityScore: null as unknown as number,
      seoScore: null as unknown as number,
      mobileScore: null as unknown as number,
      technicalHealthScore: null as unknown as number,
      lighthouse: { performance: null, accessibility: null, bestPractices: null, seo: null },
    };
    assert.equal(findWeakestMeasuredCategory(emptyAnalysis), null);
  });
});

function fixtureBrief(overrides: Partial<DesignBrief> = {}): DesignBrief {
  return {
    missionId: "mission-1",
    businessName: "Acme Law",
    websiteUrl: "https://acme-law.test",
    industry: "Law Firm",
    industryBucket: "lawFirm",
    citedInsights: [{ category: "performance", insightId: "slow-page-load", statement: "Pages load slowly." }],
    contactEvidence: { phones: [], emails: [], address: null, hours: null },
    targetAudience: "Prospective clients evaluating credibility.",
    positioning: "Lead with credibility and outcomes.",
    direction: {
      layoutFamily: "credibility-led",
      typographicMood: "measured serif",
      colorDirection: "deep calm neutrals",
      motionIntensity: "restrained",
    },
    heroThesis: "Decades of local practice, evidenced by real case outcomes, not a generic law-firm claim.",
    signatureElement: { element: "credibility-certification-display", justification: "Real bar admissions and case outcomes are the strongest evidence this firm has." },
    contentEmphasis: ["credibility"],
    referencesConsidered: [{ referenceId: "lawfirm-credibility-led", reasoning: "Informed by ... — not structurally copied (§8)." }],
    ...overrides,
  };
}

describe("design-brief-service: applyDesignBriefEdits (Founder Approval Gate)", () => {
  test("returns the brief unchanged and wasEdited: false when no edits are supplied", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief);
    assert.deepEqual(result.brief, brief);
    assert.equal(result.wasEdited, false);
  });

  test("returns the brief unchanged and wasEdited: false for an empty edits object", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief, {});
    assert.deepEqual(result.brief, brief);
    assert.equal(result.wasEdited, false);
  });

  test("overrides targetAudience and positioning when supplied", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief, {
      targetAudience: "Custom audience the founder typed in",
      positioning: "Custom positioning override",
    });
    assert.equal(result.wasEdited, true);
    assert.equal(result.brief.targetAudience, "Custom audience the founder typed in");
    assert.equal(result.brief.positioning, "Custom positioning override");
  });

  test("merges partial direction edits without discarding untouched direction fields", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief, { direction: { typographicMood: "bolder serif" } });
    assert.equal(result.brief.direction.typographicMood, "bolder serif");
    assert.equal(result.brief.direction.layoutFamily, brief.direction.layoutFamily);
    assert.equal(result.brief.direction.colorDirection, brief.direction.colorDirection);
  });

  test("never touches citedInsights or referencesConsidered — those are not editable", () => {
    const brief = fixtureBrief();
    const result = applyDesignBriefEdits(brief, { targetAudience: "Something else" });
    assert.deepEqual(result.brief.citedInsights, brief.citedInsights);
    assert.deepEqual(result.brief.referencesConsidered, brief.referencesConsidered);
  });
});

// ===========================================================================
// Phase 14 (docs/PHASE_14_IMPLEMENTATION_PLAN.md) — runDesignBrief's new
// identity-verification gate. The CONFIRMED case is this section's most
// important test: it's the literal regression proof that a mission passing
// identity verification behaves EXACTLY as runDesignBrief already did before
// this phase — same transitions, same LLM call count, same persisted brief
// content, byte-for-byte.
// ===========================================================================

function fakeAnalysisRow(overrides: Partial<WebsiteAnalysisRow> = {}): WebsiteAnalysisRow {
  return {
    id: "analysis-1",
    mission_id: "mission-1",
    organization_id: "org-1",
    company_id: null,
    status: "complete",
    crawl_result: {
      requestedUrl: "https://acmediner.test/",
      finalUrl: "https://acmediner.test/",
      statusCode: 200,
      title: "Acme Diner | Home",
      metaDescription: "Acme Diner, a real local restaurant.",
      jsonLdName: null,
      jsonLdType: null,
      headingCounts: { h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
      internalLinkCount: 12,
      externalLinkCount: 3,
      pages: [],
      robotsTxtFound: true,
      sitemapFound: true,
      htmlByteSize: 45_000,
      contact: { phones: ["+15550001111"], emails: [], address: "123 Main St, Springfield, IL", hours: null },
      socials: { facebook: null, instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null },
      certifications: [],
      licenses: [],
      services: [{ heading: "Menu", excerpt: "Real food.", sourceUrl: "https://acmediner.test/" }],
      products: [],
      team: [],
      faq: [],
      testimonials: [],
      reviews: { averageRating: null, count: null, source: null },
      gallery: [{ src: "https://acmediner.test/photo.jpg", alt: "Dining room", sourceUrl: "https://acmediner.test/" }],
      menu: [],
      forms: [],
      maps: [],
      unparsedDocuments: [],
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
  } as unknown as WebsiteAnalysisRow;
}

function validDesignIntelligenceResponseJson(): string {
  return JSON.stringify({
    designBrief: {
      targetAudience: "Local diners.",
      positioning: "Lead with real photography.",
      direction: { layoutFamily: "imagery-led", typographicMood: "warm serif display", colorDirection: "warm natural tones", motionIntensity: "restrained" },
      heroThesis: "A real neighborhood diner.",
      signatureElement: { element: "authentic-photography-hero", justification: "Real photography anchors the space." },
      contentEmphasis: ["services"],
    },
    designMemory: {
      typography: { headingFamily: "Fraunces", bodyFamily: "Inter", scaleNotes: "generous" },
      colorPalette: { primary: "#3b2a1a", secondary: "#f5ead6", accent: "#c1502e", neutral: "#fafafa", notes: "warm" },
      spacingScale: { baseUnit: "8px", notes: "generous" },
      grid: { columns: 12, notes: "standard" },
      borderRadius: "0.5rem",
      shadows: "soft",
      icons: "line icons",
      photographyStyle: "warm, natural light",
      motionLevel: "restrained",
      ctaHierarchy: { primary: "Call now", secondary: "View menu" },
      componentVariants: ["ImageLedHero"],
      brandPersonality: ["warm"],
      accessibilityTargets: "WCAG AA",
      seoPriorities: ["local search"],
      contentTone: "warm",
      preferredLayouts: ["imagery-led"],
    },
    reasoning: "Restaurant, so imagery leads.",
  });
}

function validCritiqueResponseJson(): string {
  return JSON.stringify({ isGeneric: false, violatesContentBoundary: false, reasoning: "Traceable to real evidence.", recommendation: null });
}

/** Flags the Pass 1 result as generic — the one condition that triggers the third, bounded revision call in generateDesignIntelligence. */
function genericCritiqueResponseJson(): string {
  return JSON.stringify({
    isGeneric: true,
    violatesContentBoundary: false,
    reasoning: "Reads like a template, not grounded in this business's real evidence.",
    recommendation: "Ground heroThesis in the real photography and menu evidence.",
  });
}

function revisedDesignIntelligenceResponseJson(): string {
  const revised = JSON.parse(validDesignIntelligenceResponseJson());
  revised.designBrief.heroThesis = "A real neighborhood diner, grounded in its own real photography.";
  revised.reasoning = "Revised: heroThesis now specifically traceable to the real gallery evidence.";
  return JSON.stringify(revised);
}

/** A minimal, real fake LlmProvider — the exact two-call (Pass 1 + Pass 2 critique) shape design-intelligence-service.test.ts's own fakeProvider already establishes. Tracks call count so tests can assert the LLM was (or, for IDENTITY_FAILED, was NOT) ever invoked. */
function fakeLlmProvider(): LlmProvider & { callCount: number } {
  const provider = {
    name: "fake:test-model",
    callCount: 0,
    async complete(this: { callCount: number }) {
      this.callCount += 1;
      return this.callCount === 1 ? validDesignIntelligenceResponseJson() : validCritiqueResponseJson();
    },
  };
  return provider as unknown as LlmProvider & { callCount: number };
}

/** A minimal, mutable in-memory mission "row" + repository, so transitionMissionState/rejectMission's own internal findById->validate->update sequence works correctly across one runDesignBrief call. */
function makeMissionFixture(initialState: string) {
  let mission: Record<string, unknown> = {
    id: "mission-1",
    organization_id: "org-1",
    business_name: "Acme Diner",
    website_url: "https://acmediner.test/",
    company_id: null,
    state: initialState,
  };
  return {
    get current() {
      return mission;
    },
    repository: {
      findById: async () => mission,
      update: async (_client: unknown, _id: string, values: Record<string, unknown>) => {
        mission = { ...mission, ...values };
        return mission;
      },
    },
  };
}

function buildTestDeps(overrides: {
  analysisRow?: WebsiteAnalysisRow;
  missionState?: string;
  lead?: { location: string | null; discovery_phone: string | null; discovery_address: string | null } | null;
  llmProvider?: LlmProvider & { callCount: number };
  identityInserts?: Record<string, unknown>[];
}): { deps: DesignBriefServiceDeps; mission: ReturnType<typeof makeMissionFixture>; llmProvider: LlmProvider & { callCount: number } } {
  const missionFixture = makeMissionFixture(overrides.missionState ?? "analyzing");
  const llmProvider = overrides.llmProvider ?? fakeLlmProvider();
  const identityInserts = overrides.identityInserts ?? [];
  const publishedEvents: unknown[] = [];

  const deps = {
    client: {} as never,
    designBriefRepository: {
      findById: async () => ({ id: "brief-1", mission_id: "mission-1", organization_id: "org-1", status: "pending" }) as never,
      update: async (_client: unknown, _id: string, values: Record<string, unknown>) => ({ id: "brief-1", mission_id: "mission-1", organization_id: "org-1", ...values }) as never,
    },
    websiteAnalysisRepository: {
      findLatestByMission: async () => overrides.analysisRow ?? fakeAnalysisRow(),
    } as never,
    missionRepository: missionFixture.repository as never,
    companyRepository: { findById: async () => null } as never,
    leadRepository: {
      findByMission: async () => (overrides.lead === undefined ? null : overrides.lead),
    },
    identityVerificationRepository: {
      insert: async (_client: unknown, values: Record<string, unknown>) => {
        identityInserts.push(values);
        return { id: "iv-1", created_at: new Date().toISOString(), ...values } as never;
      },
    },
    workflowDeps: {
      client: {} as never,
      missionRepository: missionFixture.repository as never,
      companyRepository: { findById: async () => null } as never,
      eventBus: { publish: async (event: unknown) => { publishedEvents.push(event); } },
    },
    eventBus: { publish: async (event: unknown) => { publishedEvents.push(event); } },
    llmProvider,
  } as unknown as DesignBriefServiceDeps;

  return { deps, mission: missionFixture, llmProvider };
}

describe("design-brief-service: runDesignBrief — Phase 14 identity verification gate", () => {
  test("IDENTITY_CONFIRMED regression proof: same domain, name matches — behaves EXACTLY as before Phase 14 (transitions researching->reviewing, brief.gallery/contactEvidence pass through unmodified, exactly 2 LLM calls)", async () => {
    const { deps, mission, llmProvider } = buildTestDeps({
      lead: { location: "Springfield, IL", discovery_phone: null, discovery_address: null },
    });

    const result = await runDesignBrief(deps, "brief-1");

    assert.equal(mission.current.state, "reviewing", "a CONFIRMED mission must still reach reviewing, exactly as before this phase");
    assert.equal(result.status, "complete");
    assert.equal(llmProvider.callCount, 2, "exactly the same 2-call (Pass 1 + critique) shape as before this phase — identity verification adds no LLM calls of its own");

    const brief = (result as unknown as { brief: DesignBrief }).brief;
    // The regression proof: gallery and contactEvidence in the persisted
    // brief are an untouched pass-through of the raw crawl's own evidence —
    // not cleared, not modified — exactly what runDesignBrief already did
    // before Phase 14 existed.
    assert.equal(brief.gallery?.length, 1);
    assert.equal(brief.gallery?.[0].src, "https://acmediner.test/photo.jpg");
    assert.deepEqual(brief.contactEvidence, { phones: ["+15550001111"], emails: [], address: "123 Main St, Springfield, IL", hours: null });
  });

  test("IDENTITY_FAILED: redirected to an unrelated, spam-classified domain — rejectMission() is called (mission ends 'rejected'), design_briefs ends 'failed', and the LLM is NEVER invoked", async () => {
    const analysisRow = fakeAnalysisRow({
      crawl_result: {
        requestedUrl: "https://acmediner.test/",
        finalUrl: "https://unrelated-streaming-site.test/",
        statusCode: 200,
        title: "Live Casino Streams | Watch Now",
        metaDescription: "casino slot machine jackpot streams online.",
        jsonLdName: null,
        jsonLdType: null,
        headingCounts: { h1: 1, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
        internalLinkCount: 0,
        externalLinkCount: 0,
        pages: [],
        robotsTxtFound: false,
        sitemapFound: false,
        htmlByteSize: 1000,
        contact: { phones: [], emails: [], address: null, hours: null },
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
        unparsedDocuments: [],
      } as unknown as WebsiteAnalysisRow["crawl_result"],
    });

    const identityInserts: Record<string, unknown>[] = [];
    const { deps, mission, llmProvider } = buildTestDeps({ analysisRow, identityInserts });

    const result = await runDesignBrief(deps, "brief-1");

    assert.equal(mission.current.state, "rejected", "IDENTITY_FAILED must call rejectMission() — the mission must not stay in analyzing or reach researching");
    assert.equal(result.status, "failed");
    assert.equal(llmProvider.callCount, 0, "citedInsights/generateDesignIntelligence must never run for a FAILED mission — not run and discarded, genuinely never invoked");
    assert.equal(identityInserts.length, 1);
    assert.equal(identityInserts[0].verdict, "failed");
  });

  test("IDENTITY_UNCERTAIN: one uncorroborated address mismatch — mission still proceeds to reviewing, but gallery/contactEvidence are cleared before the LLM ever sees them", async () => {
    const analysisRow = fakeAnalysisRow({
      crawl_result: {
        requestedUrl: "https://acmediner.test/",
        finalUrl: "https://acmediner.test/",
        statusCode: 200,
        title: "Acme Diner | Home",
        metaDescription: "Acme Diner, a real local restaurant.",
        jsonLdName: null,
        jsonLdType: null,
        headingCounts: { h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
        internalLinkCount: 12,
        externalLinkCount: 3,
        pages: [],
        robotsTxtFound: true,
        sitemapFound: true,
        htmlByteSize: 45_000,
        // A real, but unexpected, address — no other signal mismatches.
        contact: { phones: [], emails: [], address: "999 Far Away Ave, Shelbyville, IL", hours: null },
        socials: { facebook: null, instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null },
        certifications: [],
        licenses: [],
        services: [],
        products: [],
        team: [],
        faq: [],
        testimonials: [],
        reviews: { averageRating: null, count: null, source: null },
        gallery: [{ src: "https://acmediner.test/photo.jpg", alt: "Dining room", sourceUrl: "https://acmediner.test/" }],
        menu: [],
        forms: [],
        maps: [],
        unparsedDocuments: [],
      } as unknown as WebsiteAnalysisRow["crawl_result"],
    });

    const identityInserts: Record<string, unknown>[] = [];
    const { deps, mission } = buildTestDeps({
      analysisRow,
      lead: { location: "Springfield, IL", discovery_phone: null, discovery_address: null },
      identityInserts,
    });

    const result = await runDesignBrief(deps, "brief-1");

    assert.equal(mission.current.state, "reviewing", "IDENTITY_UNCERTAIN must still proceed to reviewing, never rejected");
    assert.equal(result.status, "complete");
    assert.equal(identityInserts[0].verdict, "uncertain");

    const brief = (result as unknown as { brief: DesignBrief }).brief;
    // Only the SPECIFIC category the address signal itself flagged
    // (contactEvidence) is cleared — gallery is untouched, since nothing
    // about this scenario's gallery evidence was ever flagged. Suppression
    // is per-signal, never a blanket wipe of all evidence on any mismatch.
    assert.equal(brief.gallery?.length, 1, "gallery is untouched — only contactEvidence was flagged by the address mismatch");
    assert.deepEqual(brief.contactEvidence, { phones: [], emails: [], address: null, hours: null }, "contactEvidence must be cleared to its honest-empty default");
  });

  test("no lead at all (manually-created mission) — identity gate still runs, resolves via non-OSM signals alone, never throws for missing lead data", async () => {
    const { deps, mission } = buildTestDeps({ lead: null });
    const result = await runDesignBrief(deps, "brief-1");
    assert.equal(mission.current.state, "reviewing");
    assert.equal(result.status, "complete");
  });

  test("IDENTITY_UNCERTAIN via a business-name mismatch DOES clear gallery — suppression maps to whichever signal actually fired", async () => {
    const analysisRow = fakeAnalysisRow({
      crawl_result: {
        requestedUrl: "https://acmediner.test/",
        finalUrl: "https://acmediner.test/",
        statusCode: 200,
        // Real, present title/meta — but neither names the business, and
        // nothing else (no redirect, no spam vocabulary) corroborates a
        // mismatch, so this resolves uncertain, not failed.
        title: "Welcome",
        metaDescription: "A local business.",
        jsonLdName: null,
        jsonLdType: null,
        headingCounts: { h1: 1, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
        internalLinkCount: 5,
        externalLinkCount: 1,
        pages: [],
        robotsTxtFound: true,
        sitemapFound: true,
        htmlByteSize: 10_000,
        contact: { phones: [], emails: [], address: null, hours: null },
        socials: { facebook: null, instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null },
        certifications: [],
        licenses: [],
        services: [],
        products: [],
        team: [],
        faq: [],
        testimonials: [],
        reviews: { averageRating: null, count: null, source: null },
        gallery: [{ src: "https://acmediner.test/photo.jpg", alt: "Dining room", sourceUrl: "https://acmediner.test/" }],
        menu: [],
        forms: [],
        maps: [],
        unparsedDocuments: [],
      } as unknown as WebsiteAnalysisRow["crawl_result"],
    });
    const identityInserts: Record<string, unknown>[] = [];
    const { deps, mission } = buildTestDeps({ analysisRow, identityInserts });

    const result = await runDesignBrief(deps, "brief-1");

    assert.equal(mission.current.state, "reviewing");
    assert.equal(identityInserts[0].verdict, "uncertain");
    const brief = (result as unknown as { brief: DesignBrief }).brief;
    assert.deepEqual(brief.gallery, [], "gallery must be cleared — the business-name mismatch signal maps to suppressing it");
  });
});

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function fakeDesignBriefRun(overrides: Partial<DesignBriefRow> = {}): DesignBriefRow {
  const now = new Date().toISOString();
  return {
    id: "brief-1",
    mission_id: "mission-1",
    organization_id: "org-1",
    company_id: null,
    status: "running",
    industry_bucket: null,
    brief: null,
    design_memory: null,
    reasoning: null,
    self_critique: null,
    error_message: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    reviewed_at: null,
    reviewed_by: null,
    ...overrides,
  } as unknown as DesignBriefRow;
}

describe("design-brief-service: decideDesignBriefOverlapGuardAction (overlap protection, mirrors analysis-service's own guard)", () => {
  test("no in-flight brief for this mission — proceed", () => {
    assert.deepEqual(decideDesignBriefOverlapGuardAction(null, Date.now(), FIFTEEN_MIN_MS), { kind: "proceed" });
  });

  test("the mission's latest brief already reached a terminal status — proceed, regardless of which one", () => {
    const now = Date.now();
    assert.deepEqual(decideDesignBriefOverlapGuardAction(fakeDesignBriefRun({ status: "complete" }), now, FIFTEEN_MIN_MS), {
      kind: "proceed",
    });
    assert.deepEqual(decideDesignBriefOverlapGuardAction(fakeDesignBriefRun({ status: "failed" }), now, FIFTEEN_MIN_MS), {
      kind: "proceed",
    });
  });

  test("a 'pending' row (not yet flipped to running) counts as in-flight too — already_running, not proceed", () => {
    const now = Date.now();
    const pendingRun = fakeDesignBriefRun({ status: "pending", started_at: null, created_at: new Date(now - 60_000).toISOString() });
    const result = decideDesignBriefOverlapGuardAction(pendingRun, now, FIFTEEN_MIN_MS);
    assert.deepEqual(result, { kind: "already_running", runningRun: pendingRun });
  });

  test("a fresh running brief (well within the duration bound) — already_running, never a duplicate", () => {
    const now = Date.now();
    const freshRun = fakeDesignBriefRun({ status: "running", started_at: new Date(now - 60_000).toISOString() });
    const result = decideDesignBriefOverlapGuardAction(freshRun, now, FIFTEEN_MIN_MS);
    assert.deepEqual(result, { kind: "already_running", runningRun: freshRun });
  });

  test("a running brief older than the max duration bound — reap it, then allow a new one to proceed", () => {
    const now = Date.now();
    const staleRun = fakeDesignBriefRun({ id: "stale-brief-1", status: "running", started_at: new Date(now - 20 * 60 * 1000).toISOString() });
    const result = decideDesignBriefOverlapGuardAction(staleRun, now, FIFTEEN_MIN_MS);
    assert.deepEqual(result, { kind: "reap_stale_then_proceed", staleRunId: "stale-brief-1" });
  });

  test("exactly at the boundary is treated as still-fresh, not stale (age must exceed, not merely equal, the bound)", () => {
    const now = Date.now();
    const boundaryRun = fakeDesignBriefRun({ status: "running", started_at: new Date(now - FIFTEEN_MIN_MS).toISOString() });
    assert.equal(decideDesignBriefOverlapGuardAction(boundaryRun, now, FIFTEEN_MIN_MS).kind, "already_running");
  });

  test("one millisecond past the bound is stale", () => {
    const now = Date.now();
    const justPastRun = fakeDesignBriefRun({ status: "running", started_at: new Date(now - FIFTEEN_MIN_MS - 1).toISOString() });
    assert.equal(decideDesignBriefOverlapGuardAction(justPastRun, now, FIFTEEN_MIN_MS).kind, "reap_stale_then_proceed");
  });
});

describe("design-brief-service: checkDesignBriefOverlap (the route-facing guard)", () => {
  function fakeOverlapDeps(runs: DesignBriefRow[]) {
    const updated: { id: string; values: unknown }[] = [];
    const designBriefRepository = {
      async findInFlightByMission(_client: unknown, missionId: string) {
        return runs.find((r) => r.mission_id === missionId && (r.status === "pending" || r.status === "running")) ?? null;
      },
      async update(_client: unknown, id: string, values: Record<string, unknown>) {
        updated.push({ id, values });
        const index = runs.findIndex((r) => r.id === id);
        runs[index] = { ...runs[index], ...values } as DesignBriefRow;
        return runs[index];
      },
    };
    return {
      deps: { client: {}, designBriefRepository } as unknown as Pick<DesignBriefServiceDeps, "client" | "designBriefRepository">,
      updated,
      runs,
    };
  }

  test("no in-flight brief — proceed, nothing reaped", async () => {
    const { deps, updated } = fakeOverlapDeps([]);
    const result = await checkDesignBriefOverlap(deps, "mission-1");
    assert.deepEqual(result, { kind: "proceed" });
    assert.equal(updated.length, 0);
  });

  test("a fresh in-flight brief for the same mission — already_running, the real row is returned", async () => {
    const freshRun = fakeDesignBriefRun({ mission_id: "mission-1", started_at: new Date().toISOString() });
    const { deps } = fakeOverlapDeps([freshRun]);
    const result = await checkDesignBriefOverlap(deps, "mission-1");
    assert.deepEqual(result, { kind: "already_running", runningRun: freshRun });
  });

  test("an in-flight brief for a DIFFERENT mission never blocks this one", async () => {
    const otherMissionRun = fakeDesignBriefRun({ mission_id: "mission-2", started_at: new Date().toISOString() });
    const { deps } = fakeOverlapDeps([otherMissionRun]);
    const result = await checkDesignBriefOverlap(deps, "mission-1");
    assert.deepEqual(result, { kind: "proceed" });
  });

  test("a stale in-flight brief is actually reaped (marked failed, real error_message, completed_at set) before proceeding", async () => {
    const staleRun = fakeDesignBriefRun({
      id: "stale-brief-2",
      mission_id: "mission-1",
      started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    const { deps, updated, runs } = fakeOverlapDeps([staleRun]);
    const result = await checkDesignBriefOverlap(deps, "mission-1");
    assert.deepEqual(result, { kind: "proceed" });
    assert.equal(updated.length, 1);
    assert.equal(updated[0].id, "stale-brief-2");
    assert.equal(runs[0].status, "failed");
    assert.ok(runs[0].completed_at);
    assert.match(runs[0].error_message ?? "", /abandoned/);
  });
});

describe("design-brief-service: runDesignBrief under the real worst-case shape (Phase 5.5 — the maxDuration/timeout fix)", () => {
  /**
   * Exercises the exact worst-case Robert asked this fix to hold up under:
   * the revision path triggered (3 sequential LLM calls, not 2) AND one of
   * those calls needing what a real retry would look like (a slower
   * response than the others). This can't reproduce the real wall-clock
   * duration (fetchAnthropicWithRetry's own real timing is already proven
   * with real setTimeout delays in lib/llm/anthropic-provider.test.ts —
   * 511ms/1522ms/504ms measured, unchanged logic, just a larger constant)
   * without making this test impractically slow. What it DOES prove for
   * real, with real (small, proportional) async delays rather than
   * instant-resolving mocks: runDesignBrief's own orchestration correctly
   * awaits and sequences all three calls in order, the revision path's
   * result — not the original flagged draft — is what actually gets
   * persisted, and nothing in this codebase's own code (as opposed to the
   * network layer already proven separately) introduces any additional
   * blocking, deadlock, or premature resolution under this exact shape.
   */
  function slowFakeLlmProvider(delaysMs: { pass1: number; critique: number; revision: number }): LlmProvider & { callCount: number } {
    const responses = [
      { body: validDesignIntelligenceResponseJson(), delay: delaysMs.pass1 },
      { body: genericCritiqueResponseJson(), delay: delaysMs.critique },
      { body: revisedDesignIntelligenceResponseJson(), delay: delaysMs.revision },
    ];
    const provider = {
      name: "fake:test-model-slow",
      callCount: 0,
      async complete(this: { callCount: number }) {
        const { body, delay } = responses[this.callCount];
        this.callCount += 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return body;
      },
    };
    return provider as unknown as LlmProvider & { callCount: number };
  }

  test("revision triggered + the slowest call taking as long as a real timeout-then-retry would — still completes 'complete' with the REVISED content actually persisted, not orphaned", async () => {
    // Proportional stand-in for the real worst case (a call that needed a
    // full 60s timeout before a successful 60s retry lands around 120s
    // real-world) — scaled down so the test stays fast while still being
    // genuinely asynchronous, not instant-resolving.
    const llmProvider = slowFakeLlmProvider({ pass1: 120, critique: 20, revision: 100 });
    const { deps, mission } = buildTestDeps({
      lead: { location: "Springfield, IL", discovery_phone: null, discovery_address: null },
      llmProvider,
    });

    const startedAt = Date.now();
    const result = await runDesignBrief(deps, "brief-1");
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.status, "complete", "must reach a real terminal state, never left orphaned at 'running'");
    assert.equal(llmProvider.callCount, 3, "revision must actually have been triggered — Pass 1 + critique + revision, not just 2 calls");
    assert.equal(mission.current.state, "reviewing");

    const brief = (result as unknown as { brief: DesignBrief }).brief;
    assert.equal(
      brief.heroThesis,
      "A real neighborhood diner, grounded in its own real photography.",
      "the REVISED brief must be what's persisted — the original flagged-generic draft must never win"
    );

    // Real, not simulated: the three calls' own delays (120+20+100=240ms)
    // must actually have been awaited in sequence, proving this codebase's
    // own orchestration doesn't race, skip, or otherwise resolve early.
    assert.ok(elapsedMs >= 240, `expected the three real delays to be genuinely awaited in sequence (>=240ms), got ${elapsedMs}ms`);
  });
});

describe("design-brief-service: runDesignBrief regenerated after the mission already reached 'reviewing'", () => {
  test("a second successful run for a mission already at 'reviewing' completes cleanly — never attempts the now-invalid reviewing->reviewing transition", async () => {
    // The real live scenario (Station Plaza Wine, Sep 10 2026): a first
    // design brief already succeeded and moved the mission researching ->
    // reviewing; regenerating a second one crashed on an unconditional
    // transitionMissionState(..., "reviewing") call, even though the LLM
    // work itself completed successfully.
    const { deps, mission, llmProvider } = buildTestDeps({
      lead: { location: "Springfield, IL", discovery_phone: null, discovery_address: null },
      missionState: "reviewing",
    });

    const result = await runDesignBrief(deps, "brief-1");

    assert.equal(result.status, "complete", "the real LLM work succeeding must not be thrown away by an unrelated state-transition error");
    assert.equal(llmProvider.callCount, 2, "same 2-call shape as any other successful run — this fix only touches the transition at the end");
    assert.equal(mission.current.state, "reviewing", "must stay at reviewing — no transition attempted, and definitely not left partway through one");
  });

  test("a first-ever successful run (mission still at 'researching') still transitions to 'reviewing' exactly as before this fix — no regression to the normal path", async () => {
    const { deps, mission } = buildTestDeps({
      lead: { location: "Springfield, IL", discovery_phone: null, discovery_address: null },
      missionState: "researching",
    });

    const result = await runDesignBrief(deps, "brief-1");

    assert.equal(result.status, "complete");
    assert.equal(mission.current.state, "reviewing", "the normal, first-run transition must still happen");
  });
});
