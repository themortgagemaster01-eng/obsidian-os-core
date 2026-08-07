import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Business Opportunity</CardTitle>
        {report.confidence.businessOpportunity.level !== "High" && (
          <ConfidenceBadge entry={report.confidence.businessOpportunity} />
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {ITEMS.map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
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
