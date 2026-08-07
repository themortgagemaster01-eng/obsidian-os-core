"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Rocket } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnalysisProgress } from "@/components/mission-detail/analysis-progress";
import { AnalysisFailed } from "@/components/mission-detail/analysis-failed";
import { OpportunityReportView } from "@/components/mission-detail/report/opportunity-report-view";
import type { WebsiteAnalysisRow } from "@/lib/repositories/website-analysis-repository";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";

const POLL_INTERVAL_MS = 3000;

interface AnalysisResponse {
  analysis: WebsiteAnalysisRow | null;
  report: OpportunityReport | null;
  screenshotUrl: string | null;
}

/**
 * Client-side orchestrator for the mission detail/report route. Owns none
 * of the mission's actual workflow state — it only reads `website_analyses`
 * (via GET /api/missions/:id/analysis) and triggers a run (via POST
 * /api/missions/:id/analyze); the row's real state transitions all happen
 * server-side in analysis-service.ts. Polling, not Supabase Realtime, per
 * the founder's either/or — chosen since it has no dependency on the
 * `website_analyses` table being added to a realtime publication, which
 * this environment has no way to verify is configured.
 */
export function AnalysisPanel({
  missionId,
  initialAnalysis,
  initialReport,
  initialScreenshotUrl,
}: {
  missionId: string;
  initialAnalysis: WebsiteAnalysisRow | null;
  initialReport: OpportunityReport | null;
  initialScreenshotUrl: string | null;
}) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [report, setReport] = useState(initialReport);
  const [screenshotUrl, setScreenshotUrl] = useState(initialScreenshotUrl);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inFlight = analysis?.status === "pending" || analysis?.status === "running";

  useEffect(() => {
    if (!inFlight) return;

    async function poll() {
      const response = await fetch(`/api/missions/${missionId}/analysis`);
      if (!response.ok) return;
      const body = (await response.json()) as AnalysisResponse;
      setAnalysis(body.analysis);
      setReport(body.report);
      setScreenshotUrl(body.screenshotUrl);
    }

    pollingRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, inFlight]);

  async function handleStartAnalysis() {
    setStarting(true);
    setStartError(null);
    try {
      const response = await fetch(`/api/missions/${missionId}/analyze`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { analysis?: WebsiteAnalysisRow; error?: string }
        | null;
      if (!response.ok || !body?.analysis) {
        throw new Error(body?.error ?? "Failed to start analysis");
      }
      setAnalysis(body.analysis);
      setReport(null);
      setScreenshotUrl(null);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start analysis");
    } finally {
      setStarting(false);
    }
  }

  function handleRetried(analysisId: string) {
    // POST .../analyze already returned the new row; re-fetch once to get
    // it into state without duplicating that response-parsing here.
    setAnalysis({ id: analysisId } as WebsiteAnalysisRow);
    fetch(`/api/missions/${missionId}/analysis`)
      .then((r) => r.json())
      .then((body: AnalysisResponse) => {
        setAnalysis(body.analysis);
        setReport(body.report);
        setScreenshotUrl(body.screenshotUrl);
      });
  }

  if (!analysis) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
            <Rocket className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No analysis yet</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Run a website analysis to generate this mission&apos;s Opportunity Report.
            </p>
          </div>
          {startError && <p className="text-sm text-red-400">{startError}</p>}
          <Button onClick={handleStartAnalysis} disabled={starting} className="gap-2">
            {starting && <Loader2 className="h-4 w-4 animate-spin" />}
            Run Website Analysis
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (inFlight) {
    return <AnalysisProgress status={analysis.status} />;
  }

  if (analysis.status === "failed") {
    return (
      <AnalysisFailed
        missionId={missionId}
        errorMessage={analysis.error_message}
        onRetried={handleRetried}
      />
    );
  }

  if (report) {
    return <OpportunityReportView report={report} screenshotUrl={screenshotUrl} />;
  }

  // status === 'complete' but the report hasn't loaded yet (initial render
  // race) — honest transient state, not a silent blank panel.
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading report…
      </CardContent>
    </Card>
  );
}
