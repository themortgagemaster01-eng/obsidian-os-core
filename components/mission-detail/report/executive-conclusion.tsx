import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";

/**
 * Final report section (founder addition, post-Phase-3): closes the
 * report by answering "why is this business worth contacting today" so
 * it ends with confidence instead of stopping after a findings list.
 * Renders only — the text itself is assembled by
 * opportunity-report-service.ts's buildExecutiveConclusion().
 */
export function ExecutiveConclusion({ report }: { report: OpportunityReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Executive Conclusion</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-base leading-relaxed text-foreground">{report.executiveConclusion}</p>
      </CardContent>
    </Card>
  );
}
