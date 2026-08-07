import { ConfidenceBadge } from "@/components/mission-detail/report/confidence-badge";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";

/**
 * §6.2 — leads the report, narrative, not the score. Given the elevated
 * `.glass-panel` treatment (the design system's signature surface,
 * reserved for the one thing on a page that should read as premium rather
 * than as another data card) so the report opens with a considered,
 * executive-facing statement instead of a metrics dump.
 */
export function ExecutiveSummary({ report }: { report: OpportunityReport }) {
  return (
    <div className="glass-panel space-y-4 p-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Executive Summary
        </p>
        {report.confidence.executiveSummary.level !== "High" && (
          <ConfidenceBadge entry={report.confidence.executiveSummary} />
        )}
      </div>
      <p className="text-xl font-medium leading-relaxed tracking-tight text-foreground">
        {report.executiveSummary}
      </p>
    </div>
  );
}
