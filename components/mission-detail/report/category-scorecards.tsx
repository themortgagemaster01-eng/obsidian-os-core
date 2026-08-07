import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/mission-detail/report/confidence-badge";
import { scoreTextClass } from "@/components/mission-detail/report/score-color";
import type { OpportunityReport, ConfidenceEntry } from "@/lib/services/opportunity-report-service";
import type { AnalysisCategory } from "@/lib/services/analysis-types";

const CATEGORY_LABELS: Record<AnalysisCategory, string> = {
  performance: "Performance",
  accessibility: "Accessibility",
  seo: "SEO",
  mobile: "Mobile Experience",
  technicalHealth: "Technical Health",
};

const CONFIDENCE_KEY: Record<AnalysisCategory, keyof OpportunityReport["confidence"]> = {
  performance: "performance",
  accessibility: "accessibility",
  seo: "seo",
  mobile: "mobile",
  technicalHealth: "technicalHealth",
};

/**
 * §6.5 — the five v1 categories individually. A category the underlying
 * check couldn't measure reads visually muted (score dimmed to "—") rather
 * than a confident-looking number standing in for a measurement that never
 * happened; its confidence reason is shown as real text, not a tooltip —
 * "visibly shown, not buried."
 */
export function CategoryScorecards({ report }: { report: OpportunityReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Category Scorecards</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2">
          {report.findings.map((finding, index) => {
            const confidence: ConfidenceEntry = report.confidence[CONFIDENCE_KEY[finding.category]];
            const measured = confidence.level !== "Unavailable";
            // An odd count would otherwise leave the grid's last cell empty
            // on wider screens — give the final item the full row instead.
            const isDanglingLast = index === report.findings.length - 1 && report.findings.length % 2 === 1;

            return (
              <div
                key={finding.category}
                className={`space-y-3 bg-panel p-5 ${isDanglingLast ? "sm:col-span-2" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">
                    {CATEGORY_LABELS[finding.category]}
                  </p>
                  <span
                    className={
                      measured
                        ? `text-xl font-semibold tracking-tight ${scoreTextClass(finding.score)}`
                        : "text-xl font-semibold tracking-tight text-muted-foreground/40"
                    }
                  >
                    {measured ? (finding.score ?? "—") : "—"}
                  </span>
                </div>
                {confidence.level !== "High" && (
                  <ConfidenceBadge entry={confidence} showReason />
                )}
                <ul className="space-y-1.5">
                  {finding.statements.map((statement, i) => (
                    <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                      {statement}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
