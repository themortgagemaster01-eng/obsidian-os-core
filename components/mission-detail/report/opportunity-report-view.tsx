import type { OpportunityReport } from "@/lib/services/opportunity-report-service";
import { ExecutiveSummary } from "@/components/mission-detail/report/executive-summary";
import { BusinessOpportunity } from "@/components/mission-detail/report/business-opportunity";
import { OpportunityScore } from "@/components/mission-detail/report/opportunity-score";
import { CategoryScorecards } from "@/components/mission-detail/report/category-scorecards";
import { TechnologyStack } from "@/components/mission-detail/report/technology-stack";
import { ScreenshotSection } from "@/components/mission-detail/report/screenshot-section";
import { EvidenceTable } from "@/components/mission-detail/report/evidence-table";
import { Recommendations } from "@/components/mission-detail/report/recommendations";

/**
 * Renders the OpportunityReport object in the exact section order specified
 * by docs/SPRINT_3_DESIGN_REVIEW.md §6 (business name/header is rendered
 * separately, always-visible, by MissionHeader — see app/missions/[id]/page.tsx).
 * This component only lays sections out; it assembles nothing — every value
 * rendered here already exists on the `report` object produced by
 * opportunity-report-service.ts.
 */
export function OpportunityReportView({
  report,
  screenshotUrl,
}: {
  report: OpportunityReport;
  screenshotUrl: string | null;
}) {
  return (
    <div className="space-y-6">
      <ExecutiveSummary report={report} />
      <BusinessOpportunity report={report} />
      <OpportunityScore report={report} />
      <CategoryScorecards report={report} />
      <TechnologyStack report={report} />
      <ScreenshotSection screenshotUrl={screenshotUrl} />
      <EvidenceTable report={report} />
      <Recommendations report={report} />
    </div>
  );
}
