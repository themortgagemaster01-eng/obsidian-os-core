import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { websiteAnalysisRepository } from "@/lib/repositories/website-analysis-repository";
import { normalizedAnalysisFromRow } from "@/lib/services/analysis-types";
import { generateInsights } from "@/lib/services/insight-service";
import { computeOpportunityScore } from "@/lib/services/opportunity-scoring-service";
import { assembleOpportunityReport } from "@/lib/services/opportunity-report-service";
import { resolveScreenshotUrl } from "@/lib/presentation/resolve-screenshot-url";

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/missions/:id/analysis (docs/SPRINT_3_DESIGN_REVIEW.md §5) —
 * returns the current `website_analyses` row for a mission (or `null` if
 * analysis has never been run), and — once `status = 'complete'` — the
 * assembled `OpportunityReport`. Read-only: assembles the report by calling
 * the existing insight/scoring/report services with their existing,
 * unmodified public functions — this route does not compute anything they
 * don't already compute.
 *
 * The client (app/missions/[id]/page.tsx's analysis panel) polls this
 * endpoint while status is 'pending'/'running'.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: doubles as the authorization check, same pattern as the
  // POST .../analyze route.
  const mission = await missionRepository.findById(supabase, params.id);
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  const analysis = await websiteAnalysisRepository.findLatestByMission(supabase, mission.id);

  if (!analysis || analysis.status !== "complete") {
    return NextResponse.json({ analysis, report: null, screenshotUrl: null });
  }

  const normalized = normalizedAnalysisFromRow(analysis, mission.website_url);
  const insights = generateInsights(normalized);
  const scoreResult = computeOpportunityScore(normalized);
  const report = assembleOpportunityReport(normalized, insights, scoreResult);
  const screenshotUrl = await resolveScreenshotUrl(supabase, analysis.screenshot_url);

  return NextResponse.json({ analysis, report, screenshotUrl });
}
