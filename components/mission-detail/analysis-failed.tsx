"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** An honest failure state — never a silent hang — with a retry action that re-calls POST /api/missions/:id/analyze (§6). */
export function AnalysisFailed({
  missionId,
  errorMessage,
  onRetried,
}: {
  missionId: string;
  errorMessage: string | null;
  onRetried: (analysisId: string) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setRetrying(true);
    setError(null);
    try {
      const response = await fetch(`/api/missions/${missionId}/analyze`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { analysis?: { id: string }; error?: string }
        | null;
      if (!response.ok || !body?.analysis) {
        throw new Error(body?.error ?? "Failed to start analysis");
      }
      onRetried(body.analysis.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start analysis");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <AlertTriangle className="h-5 w-5 text-red-300" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Analysis failed</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {errorMessage ?? "The analysis could not complete for an unknown reason."}
          </p>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button onClick={handleRetry} disabled={retrying} className="gap-2">
          {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          Retry analysis
        </Button>
      </CardContent>
    </Card>
  );
}
