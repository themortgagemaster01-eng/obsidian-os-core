import { Loader2, Clock } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
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
 * or event persisted anywhere the UI can read mid-run. So rather than fake
 * independent per-item progress, every dimension shares the run's real,
 * single status: queued before the worker picks it up, running together
 * while it does (which is also literally true — they execute concurrently),
 * done together the moment the row flips to `complete`.
 */
export function AnalysisProgress({ status }: { status: AnalysisStatus }) {
  const running = status === "running";

  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {running ? "Analysis in progress…" : "Analysis queued…"}
          </p>
        </div>
        <ul className="space-y-2.5">
          {DIMENSIONS.map((dimension) => (
            <li key={dimension} className="flex items-center gap-2.5 text-sm">
              {running ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-300" />
              ) : (
                <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className={running ? "text-foreground" : "text-muted-foreground"}>
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
