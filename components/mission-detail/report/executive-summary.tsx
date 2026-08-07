import { Card, CardContent } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/mission-detail/report/confidence-badge";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";

/** §6.2 — leads the report, narrative, not the score. */
export function ExecutiveSummary({ report }: { report: OpportunityReport }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">Executive Summary</h2>
          {report.confidence.executiveSummary.level !== "High" && (
            <ConfidenceBadge entry={report.confidence.executiveSummary} />
          )}
        </div>
        <p className="text-base leading-relaxed text-foreground">{report.executiveSummary}</p>
      </CardContent>
    </Card>
  );
}
