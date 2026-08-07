import { CheckSquare } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge } from "@/components/mission-detail/report/confidence-badge";
import { scoreTextClass, scoreRingClass } from "@/components/mission-detail/report/score-color";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";
import type { InsightSeverity } from "@/lib/services/insight-service";

function qualitativeLabel(score: number | null): string {
  if (score === null) return "Not measured";
  if (score >= 90) return "Strong";
  if (score >= 70) return "Needs improvement";
  return "Significant opportunity";
}

function severityBadgeVariant(severity: InsightSeverity): "destructive" | "warning" | "outline" {
  if (severity === "high") return "destructive";
  if (severity === "medium") return "warning";
  return "outline";
}

/**
 * §6.4 — the overall score, plus the "Top Opportunities" checklist. The
 * checklist is real `recommendations` data (already sorted high-severity
 * first by opportunity-report-service.ts) rather than a hardcoded list of
 * example topic names — the design doc's illustrative topic list
 * (Mobile Experience, SEO, ...) was an example of the *kind* of content,
 * not literal required labels.
 */
export function OpportunityScore({ report }: { report: OpportunityReport }) {
  const topOpportunities = report.recommendations.slice(0, 5);

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-5">
            <div
              className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 ${scoreRingClass(report.scores.overall)}`}
            >
              <span className={`text-2xl font-semibold ${scoreTextClass(report.scores.overall)}`}>
                {report.scores.overall ?? "—"}
              </span>
            </div>
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">Opportunity Score</h2>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {qualitativeLabel(report.scores.overall)}
              </p>
            </div>
          </div>
          <ConfidenceBadge entry={report.confidence.overall} />
        </div>

        {topOpportunities.length > 0 && (
          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <CheckSquare className="h-3.5 w-3.5" />
              Top Opportunities
            </h3>
            <ul className="space-y-2">
              {topOpportunities.map((item) => (
                <li key={item.title} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-foreground">{item.title}</span>
                  <Badge variant={severityBadgeVariant(item.severity)}>{item.severity}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
