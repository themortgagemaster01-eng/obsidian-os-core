import { Card, CardContent } from "@/components/ui/card";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";

/** §6.8 — every insight/recommendation traced back to the specific measurement it came from. */
export function EvidenceTable({ report }: { report: OpportunityReport }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <h2 className="text-sm font-medium text-muted-foreground">Evidence</h2>
        {report.evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">No findings to trace for this analysis.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Claim</th>
                  <th className="py-2 pl-4 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.evidence.map((entry, i) => (
                  <tr key={i}>
                    <td className="py-3 pr-4 text-foreground">{entry.claim}</td>
                    <td className="py-3 pl-4 whitespace-nowrap text-muted-foreground">
                      {entry.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
