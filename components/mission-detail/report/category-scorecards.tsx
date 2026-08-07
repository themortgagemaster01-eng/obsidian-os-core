import { Card, CardContent } from "@/components/ui/card";
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
 * check couldn't measure reads visually muted (score dimmed, "—" instead
 * of a bold number) rather than a confident-looking score standing in for
 * a real measurement that never happened — the same distinction
 * opportunity-report-service.ts's confidence field exists to preserve.
 */
export function CategoryScorecards({ report }: { report: OpportunityReport }) {
  return (
    <Card>
      <CardContent className="space-y-5 py-6">
        <h2 className="text-sm font-medium text-muted-foreground">Category Scorecards</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {report.findings.map((finding) => {
            const confidence: ConfidenceEntry = report.confidence[CONFIDENCE_KEY[finding.category]];
            const measured = confidence.level !== "Unavailable";

            return (
              <div key={finding.category} className="rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">
                    {CATEGORY_LABELS[finding.category]}
                  </p>
                  <span
                    className={
                      measured
                        ? `text-lg font-semibold ${scoreTextClass(finding.score)}`
                        : "text-lg font-semibold text-muted-foreground/50"
                    }
                  >
                    {measured ? (finding.score ?? "—") : "—"}
                  </span>
                </div>
                <div className="mt-2">
                  <ConfidenceBadge entry={confidence} />
                </div>
                <ul className="mt-3 space-y-1.5">
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
