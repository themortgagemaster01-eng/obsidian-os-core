import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/mission-detail/report/confidence-badge";
import { scoreTextClass } from "@/components/mission-detail/report/score-color";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";
import type { InsightSeverity } from "@/lib/services/insight-service";

function qualitativeLabel(score: number | null): string {
  if (score === null) return "Not measured";
  if (score >= 90) return "Strong";
  if (score >= 70) return "Needs improvement";
  return "Significant opportunity";
}

const SEVERITY_DOT: Record<InsightSeverity, string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-white/30",
};

/**
 * §6.4 — the overall score, plus the "Top Opportunities" checklist. A large,
 * quiet number rather than a gauge/ring — the score bands opportunity-
 * report-service.ts already computes are conveyed through color and the
 * qualitative label alone, not a chart. The checklist is real
 * `recommendations` data (already sorted high-severity first), not a
 * hardcoded list of example topic names — the design doc's illustrative
 * topic list was an example of the *kind* of content, not literal labels.
 */
export function OpportunityScore({ report }: { report: OpportunityReport }) {
  const topOpportunities = report.recommendations.slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Opportunity Score</CardTitle>
        <ConfidenceBadge entry={report.confidence.overall} />
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-baseline gap-4">
          <span className={`text-6xl font-semibold tracking-tight ${scoreTextClass(report.scores.overall)}`}>
            {report.scores.overall ?? "—"}
          </span>
          <span className="text-base font-medium text-muted-foreground">
            {qualitativeLabel(report.scores.overall)}
          </span>
        </div>

        {topOpportunities.length > 0 && (
          <div className="space-y-3 border-t border-border pt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Top Opportunities
            </p>
            <ul className="space-y-3">
              {topOpportunities.map((item) => (
                <li key={item.title} className="flex items-center gap-3 text-sm">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[item.severity]}`} />
                  <span className="text-foreground">{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
