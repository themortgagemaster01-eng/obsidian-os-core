import { Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalysisStatus } from "@/lib/repositories/website-analysis-repository";

const DIMENSIONS = [
  "Site Structure",
  "Mobile Display",
  "Search Visibility",
  "Accessibility",
  "Page Speed & Quality",
  "Technology Detection",
  "Screenshot Capture",
];

/**
 * The seven analysis dimensions, honestly reflecting what the backend can
 * actually tell us. analysis-service.ts runs all seven adapters in a single
 * `Promise.all` and writes the `website_analyses` row once at the end
 * (§1/§3 of the design doc) — there is no per-adapter completion timestamp
 * or event persisted anywhere the UI can read mid-run. Rather than fake
 * independent per-item progress (or seven simultaneous spinners, which
 * reads as busy rather than calm), every dimension shares one quiet pulse
 * while the run is genuinely in flight together, and a single status line
 * carries the real state — queued vs. running.
 */
export function AnalysisProgress({ status }: { status: AnalysisStatus }) {
  const running = status === "running";

  return (
    <Card>
      <CardContent className="space-y-6 py-8">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {running ? "Analysis in progress" : "Analysis queued"}
          </p>
        </div>
        <ul className="space-y-3">
          {DIMENSIONS.map((dimension) => (
            <li key={dimension} className="flex items-center gap-3">
              {running ? (
                <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full" />
              ) : (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/10" />
              )}
              <span className={`text-sm ${running ? "text-foreground" : "text-muted-foreground"}`}>
                {dimension}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          All dimensions run concurrently, so they complete together — this can take up to 30
          seconds or more depending on the target site.
        </p>
      </CardContent>
    </Card>
  );
}
