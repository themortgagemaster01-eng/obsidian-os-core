import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildCitations,
  findWeakestMeasuredCategory,
  applyDesignBriefEdits,
  runDesignBrief,
  type DesignBrief,
  type DesignBriefServiceDeps,
} from "@/lib/services/design-brief-service";
import type { NormalizedAnalysis } from "@/lib/services/analysis-types";
import type { Insight } from "@/lib/services/insight-service";
import type { WebsiteAnalysisRow } from "@/lib/repositories/website-analysis-repository";
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
