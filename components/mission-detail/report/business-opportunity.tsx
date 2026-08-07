import { Card, CardContent } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/mission-detail/report/confidence-badge";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";

const ITEMS: { key: keyof OpportunityReport["businessOpportunity"]; label: string }[] = [
  { key: "estimatedCustomerExperienceImpact", label: "Customer Experience Impact" },
  { key: "estimatedLocalSeoImpact", label: "Local SEO Impact" },
  { key: "estimatedConversionImprovement", label: "Conversion Improvement" },
  { key: "estimatedBrandModernization", label: "Brand Modernization" },
  { key: "potentialBusinessValue", label: "Potential Business Value" },
];

/** §6.3 — the five estimated-impact statements, framing why this matters before the numbers. */
export function BusinessOpportunity({ report }: { report: OpportunityReport }) {
  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">Business Opportunity</h2>
          {report.confidence.businessOpportunity.level !== "High" && (
            <ConfidenceBadge entry={report.confidence.businessOpportunity} />
          )}
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ITEMS.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="text-sm leading-relaxed text-foreground">
                {report.businessOpportunity[key]}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
