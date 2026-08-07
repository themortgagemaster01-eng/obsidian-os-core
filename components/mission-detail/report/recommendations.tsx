import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";
import type { InsightSeverity } from "@/lib/services/insight-service";

function severityBadgeVariant(severity: InsightSeverity): "destructive" | "warning" | "outline" {
  if (severity === "high") return "destructive";
  if (severity === "medium") return "warning";
  return "outline";
}

/** §6.9 — the same Top Opportunities items, expanded with full detail. */
export function Recommendations({ report }: { report: OpportunityReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recommendations</CardTitle>
      </CardHeader>
      <CardContent>
        {report.recommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recommendations were generated — no notable issues were found.
          </p>
        ) : (
          <ul className="space-y-5">
            {report.recommendations.map((rec) => (
              <li key={rec.title} className="space-y-1.5 border-b border-border pb-5 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-foreground">{rec.title}</p>
                  <Badge variant={severityBadgeVariant(rec.severity)}>{rec.severity}</Badge>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{rec.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
