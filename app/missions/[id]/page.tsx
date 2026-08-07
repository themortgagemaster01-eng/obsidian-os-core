import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { websiteAnalysisRepository } from "@/lib/repositories/website-analysis-repository";
import { normalizedAnalysisFromRow } from "@/lib/services/analysis-types";
import { generateInsights } from "@/lib/services/insight-service";
import { computeOpportunityScore } from "@/lib/services/opportunity-scoring-service";
import { assembleOpportunityReport } from "@/lib/services/opportunity-report-service";
import { resolveScreenshotUrl } from "@/lib/presentation/resolve-screenshot-url";
import { MissionHeader } from "@/components/mission-detail/mission-header";
import { AnalysisPanel } from "@/components/mission-detail/analysis-panel";

interface PageParams {
  params: { id: string };
}

/**
 * Mission Detail / Opportunity Report page (docs/SPRINT_3_DESIGN_REVIEW.md
 * §6, route `app/missions/[id]/page.tsx`). Server Component: fetches the
 * mission and its latest analysis directly (same pattern as app/page.tsx),
 * assembles the report for the initial paint when analysis is already
 * complete, then hands off to the client AnalysisPanel for the in-progress/
 * failed/polling states. This page composes existing service output for
 * display — it does not score, generate insights, or decide report content.
 */
export default async function MissionDetailPage({ params }: PageParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // RLS-scoped: doubles as the authorization check.
  const mission = await missionRepository.findById(supabase, params.id);
  if (!mission) {
    notFound();
  }

  const analysis = await websiteAnalysisRepository.findLatestByMission(supabase, mission.id);

  let report = null;
  let screenshotUrl: string | null = null;

  if (analysis?.status === "complete") {
    const normalized = normalizedAnalysisFromRow(analysis, mission.website_url);
    const insights = generateInsights(normalized);
    const scoreResult = computeOpportunityScore(normalized);
    report = assembleOpportunityReport(normalized, insights, scoreResult);
    screenshotUrl = await resolveScreenshotUrl(supabase, analysis.screenshot_url);
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container max-w-3xl space-y-5 py-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 ease-in-out hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Mission Control
          </Link>
          <MissionHeader mission={mission} screenshotUrl={screenshotUrl} />
        </div>
      </header>

      <div className="container max-w-3xl space-y-6 py-10">
        <AnalysisPanel
          missionId={mission.id}
          initialAnalysis={analysis}
          initialReport={report}
          initialScreenshotUrl={screenshotUrl}
        />
      </div>
    </main>
  );
}
