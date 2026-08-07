import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { OpportunityReport } from "@/lib/services/opportunity-report-service";

/** §6.6 — detected CMS, frameworks, hosting, etc. */
export function TechnologyStack({ report }: { report: OpportunityReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Technology Stack</CardTitle>
      </CardHeader>
      <CardContent>
        {report.technologyStack.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No underlying technology could be confidently detected.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {report.technologyStack.map((tech) => (
              <Badge key={tech} variant="outline">
                {tech}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
