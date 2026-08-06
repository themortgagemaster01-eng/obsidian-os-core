import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import {
  websiteAnalysisRepository,
  type WebsiteAnalysisRow,
} from "@/lib/repositories/website-analysis-repository";
import { missionRepository } from "@/lib/repositories/mission-repository";
import {
  createMissionWorkflowDeps,
  transitionMissionState,
  type MissionWorkflowDeps,
} from "@/lib/workflow/mission-workflow";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";

import { runCrawlAdapter } from "@/lib/adapters/crawl-adapter";
import { runMobileAnalysisAdapter } from "@/lib/adapters/mobile-analysis-adapter";
import { runSeoAdapter } from "@/lib/adapters/seo-adapter";
import { runAccessibilityAdapter } from "@/lib/adapters/accessibility-adapter";
import { runLighthouseAdapter } from "@/lib/adapters/lighthouse-adapter";
import { runTechDetectionAdapter } from "@/lib/adapters/tech-detection-adapter";
import { runScreenshotAdapter, type ScreenshotUploader } from "@/lib/adapters/screenshot-adapter";
import type {
  MobileRawResult,
  SeoRawResult,
  AccessibilityRawResult,
} from "@/lib/adapters/types";

type TypedClient = SupabaseClient<Database>;

const SCREENSHOT_BUCKET = "website-screenshots";

/**
 * Dependencies analysis-service needs, injected by the caller — same
 * pattern as MissionWorkflowDeps. `client` should be a service-role client
 * when this runs in the detached background worker (see
 * lib/supabase/service-role.ts), since there's no user session there.
 */
export interface AnalysisServiceDeps {
  client: TypedClient;
  websiteAnalysisRepository: typeof websiteAnalysisRepository;
  missionRepository: typeof missionRepository;
  workflowDeps: MissionWorkflowDeps;
  eventBus: EventBus;
}

export function createAnalysisServiceDeps(client: TypedClient): AnalysisServiceDeps {
  return {
    client,
    websiteAnalysisRepository,
    missionRepository,
    workflowDeps: createMissionWorkflowDeps(client),
    eventBus: createEventBus(client),
  };
}

export interface CreateAnalysisRunInput {
  missionId: string;
  organizationId: string;
  companyId?: string | null;
}

/**
 * The fast, synchronous half of §2's flow: creates the `website_analyses`
 * row at `status: 'pending'` and returns immediately. Called directly by
 * POST /api/missions/:id/analyze (app/api/missions/[id]/analyze/route.ts)
 * — the actual analysis work (runAnalysis, below) is invoked separately
 * and NOT awaited by that route handler.
 */
export async function createAnalysisRun(
  deps: AnalysisServiceDeps,
  input: CreateAnalysisRunInput
): Promise<WebsiteAnalysisRow> {
  return deps.websiteAnalysisRepository.insert(deps.client, {
    mission_id: input.missionId,
    organization_id: input.organizationId,
    company_id: input.companyId ?? null,
    status: "pending",
  });
}

// ===========================================================================
// Normalization (§3.2) — turns each adapter's raw, vendor-shaped output into
// a consistent 0-100 score + a short structured findings list. Deliberately
// still technical/factual language here, NOT the plain-business-language
// "Insights" layer (§3.3) — that translation is insight-service.ts's job
// (Phase 2), not this service's. Nothing in this file should be rendered
// directly in the Opportunity Report UI.
//
// Exported (Phase 2 addition, no behavior change): so
// lib/services/analysis-types.ts's normalizedAnalysisFromRawResults() can
// reuse this exact scoring logic — for tests and the Phase 2 demo script —
// instead of a second, potentially-divergent copy of it. Every other
// caller should still go through a persisted website_analyses row
// (normalizedAnalysisFromRow), not call these directly.
// ===========================================================================

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeMobileScore(raw: MobileRawResult): number {
  if (raw.fetchError) return 0;
  let score = 100;
  if (!raw.hasViewportMeta) score -= 40;
  if (raw.usesUserScalableNo) score -= 15;
  if (raw.mediaQueryCount === 0) score -= 20;
  if (raw.smallFontDeclarationCount > 0) score -= 10;
  return clampScore(score);
}

export function mobileFindings(raw: MobileRawResult): string[] {
  const findings: string[] = [];
  if (raw.fetchError) findings.push(`Could not analyze mobile experience: ${raw.fetchError}`);
  if (!raw.hasViewportMeta) findings.push("No viewport meta tag found.");
  if (raw.usesUserScalableNo) findings.push("Viewport disables user zoom (user-scalable=no).");
  if (raw.mediaQueryCount === 0) findings.push("No responsive breakpoints (media queries) detected.");
  if (raw.smallFontDeclarationCount > 0) {
    findings.push(`${raw.smallFontDeclarationCount} font-size declaration(s) under 12px found.`);
  }
  return findings;
}

export function normalizeSeoScore(raw: SeoRawResult): number {
  if (raw.fetchError) return 0;
  if (raw.hasRobotsNoindex) return 0;
  let score = 100;
  if (!raw.title) score -= 20;
  if (!raw.metaDescription) score -= 15;
  if (raw.h1Count !== 1) score -= 10;
  if (raw.imageCount > 0) {
    score -= Math.min(20, Math.round((raw.imagesMissingAlt / raw.imageCount) * 20));
  }
  if (!raw.canonicalUrl) score -= 10;
  if (raw.structuredDataTypes.length === 0) score -= 10;
  if (raw.openGraphTagCount === 0) score -= 5;
  return clampScore(score);
}

export function seoFindings(raw: SeoRawResult): string[] {
  const findings: string[] = [];
  if (raw.fetchError) findings.push(`Could not analyze SEO: ${raw.fetchError}`);
  if (raw.hasRobotsNoindex) findings.push("Page is marked noindex — excluded from search results.");
  if (!raw.title) findings.push("Missing <title> tag.");
  if (!raw.metaDescription) findings.push("Missing meta description.");
  if (raw.h1Count === 0) findings.push("No H1 heading found.");
  if (raw.h1Count > 1) findings.push(`${raw.h1Count} H1 headings found (expected exactly one).`);
  if (raw.imagesMissingAlt > 0) {
    findings.push(`${raw.imagesMissingAlt} of ${raw.imageCount} images are missing alt text.`);
  }
  if (!raw.canonicalUrl) findings.push("No canonical URL specified.");
  if (raw.structuredDataTypes.length === 0) findings.push("No structured data (JSON-LD) found.");
  if (raw.openGraphTagCount === 0) findings.push("No Open Graph tags found.");
  return findings;
}

export function normalizeAccessibilityScore(raw: AccessibilityRawResult): number {
  if (raw.fetchError) return 0;
  const penalty =
    raw.violationCountByImpact.critical * 10 +
    raw.violationCountByImpact.serious * 5 +
    raw.violationCountByImpact.moderate * 2 +
    raw.violationCountByImpact.minor * 1;
  return clampScore(100 - penalty);
}

export function accessibilityFindings(raw: AccessibilityRawResult): string[] {
  if (raw.fetchError) return [`Could not run accessibility audit: ${raw.fetchError}`];
  return raw.violations
    .slice()
    .sort((a, b) => {
      const order = { critical: 0, serious: 1, moderate: 2, minor: 3 } as const;
      const aRank = a.impact ? order[a.impact] : 4;
      const bRank = b.impact ? order[b.impact] : 4;
      return aRank - bRank;
    })
    .map((v) => `[${v.impact ?? "unknown"}] ${v.help} (${v.nodeCount} element(s))`);
}

// ===========================================================================
// Orchestration (§1, §2)
// ===========================================================================

/**
 * Runs the full analysis pipeline for an existing `website_analyses` row:
 * flips it to 'running', transitions the mission to `analyzing` if it
 * hasn't already, runs all seven adapters, normalizes their output,
 * persists the result, and publishes WebsiteScanned + SEOComplete. On any
 * unexpected failure, marks the row 'failed' and publishes AnalysisFailed
 * instead of throwing back to the caller — this is meant to be the last
 * stop in the background worker, so it owns turning failures into
 * persisted state rather than letting them vanish into an unhandled
 * rejection (§15 risk #2, §13 acceptance criteria).
 *
 * This function alone is the only thing in the Analysis Engine that talks
 * to lib/adapters/ (§1) — insight-service.ts, opportunity-scoring-
 * service.ts, and opportunity-report-service.ts (Phase 2) only ever read
 * the Normalized Analysis columns this function writes.
 */
export async function runAnalysis(
  deps: AnalysisServiceDeps,
  analysisId: string
): Promise<WebsiteAnalysisRow> {
  const analysis = await deps.websiteAnalysisRepository.findById(deps.client, analysisId);
  if (!analysis) {
    throw new Error(`Website analysis ${analysisId} not found.`);
  }

  const mission = await deps.missionRepository.findById(deps.client, analysis.mission_id);
  if (!mission) {
    throw new Error(`Mission ${analysis.mission_id} not found.`);
  }

  await deps.websiteAnalysisRepository.update(deps.client, analysisId, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  // Only advance discovered -> analyzing; a re-run on a mission already at
  // `analyzing` (§13: re-running analysis inserts a new row, doesn't touch
  // state) should not attempt a second, now-invalid transition.
  if (mission.state === "discovered") {
    await transitionMissionState(deps.workflowDeps, mission.id, "analyzing");
  }

  try {
    const websiteUrl = mission.website_url;

    const uploadScreenshot: ScreenshotUploader = async (fileName, buffer) => {
      const path = `${mission.organization_id}/${mission.id}/${analysisId}/${fileName}`;
      const { error } = await deps.client.storage
        .from(SCREENSHOT_BUCKET)
        .upload(path, buffer, { contentType: "image/png", upsert: true });
      if (error) throw error;
      // Bucket is private (0007 migration) — this is a storage object path,
      // not a public URL. Resolving it to a signed URL for display is UI
      // work, not this service's job (Open Question 6).
      return path;
    };

    const [crawl, mobile, seo, accessibility, lighthouseResult, techDetection, screenshot] =
      await Promise.all([
        runCrawlAdapter(websiteUrl),
        runMobileAnalysisAdapter(websiteUrl),
        runSeoAdapter(websiteUrl),
        runAccessibilityAdapter(websiteUrl),
        runLighthouseAdapter(websiteUrl),
        runTechDetectionAdapter(websiteUrl),
        runScreenshotAdapter(websiteUrl, uploadScreenshot),
      ]);

    const mobileScore = normalizeMobileScore(mobile);
    const seoScore = normalizeSeoScore(seo);
    const accessibilityScore = normalizeAccessibilityScore(accessibility);
    const technologyStack = techDetection.technologies.map((t) => t.name);
    const seoFindingsList = seoFindings(seo);

    const updated = await deps.websiteAnalysisRepository.update(deps.client, analysisId, {
      status: "complete",
      completed_at: new Date().toISOString(),
      crawl_result: crawl as unknown as Json,
      mobile_result: mobile as unknown as Json,
      seo_result: seo as unknown as Json,
      accessibility_result: accessibility as unknown as Json,
      lighthouse_result: lighthouseResult as unknown as Json,
      tech_detection_result: techDetection as unknown as Json,
      mobile_score: mobileScore,
      mobile_findings: mobileFindings(mobile) as unknown as Json,
      seo_score: seoScore,
      seo_findings: seoFindingsList as unknown as Json,
      accessibility_score: accessibilityScore,
      accessibility_findings: accessibilityFindings(accessibility) as unknown as Json,
      lighthouse_performance: lighthouseResult.scores.performance,
      lighthouse_accessibility: lighthouseResult.scores.accessibility,
      lighthouse_best_practices: lighthouseResult.scores.bestPractices,
      lighthouse_seo: lighthouseResult.scores.seo,
      technology_stack: technologyStack as unknown as Json,
      screenshot_url: screenshot.fullPageUrl,
    });

    await deps.eventBus.publish({
      type: "WebsiteScanned",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: {
        websiteUrl,
        mobileScore,
        accessibilityScore,
        lighthousePerformance: lighthouseResult.scores.performance ?? undefined,
        lighthouseAccessibility: lighthouseResult.scores.accessibility ?? undefined,
        lighthouseBestPractices: lighthouseResult.scores.bestPractices ?? undefined,
        lighthouseSeo: lighthouseResult.scores.seo ?? undefined,
        technologyStack,
      },
    });

    await deps.eventBus.publish({
      type: "SEOComplete",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: { score: seoScore, issues: seoFindingsList },
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed for an unknown reason.";

    const failed = await deps.websiteAnalysisRepository.update(deps.client, analysisId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
    });

    await deps.eventBus.publish({
      type: "AnalysisFailed",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: { errorMessage: message },
    });

    return failed;
  }
}

