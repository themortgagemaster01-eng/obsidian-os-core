import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type {
  DesignQaReport,
  QaCategoryId,
  QaVerdict,
  AiDerivedAssessment,
} from "@/lib/services/design-qa-service";

const CATEGORY_LABEL: Record<QaCategoryId, string> = {
  typography: "Typography",
  spacing: "Spacing",
  layout: "Layout",
  motion: "Motion",
  mobile: "Mobile",
  accessibility: "Accessibility",
  performance: "Performance",
  trust: "Trust",
  conversion: "Conversion",
  brandFit: "Brand Fit",
  genericTemplate: "Generic Template",
};

// Fixed, deliberate order — not just Object.keys() over the report, since a
// founder scanning this should see it in a stable, sensible reading order
// every time regardless of how the underlying record iterates.
const CATEGORY_ORDER: QaCategoryId[] = [
  "typography",
  "spacing",
  "layout",
  "motion",
  "mobile",
  "accessibility",
  "performance",
  "trust",
  "conversion",
  "brandFit",
  "genericTemplate",
];

function verdictBadgeVariant(verdict: QaVerdict): NonNullable<BadgeProps["variant"]> {
  switch (verdict) {
    case "PASS":
      return "success";
    case "WARN":
      return "warning";
    case "FAIL":
      return "destructive";
    case "UNAVAILABLE":
      return "outline";
  }
}

function gradeBadgeVariant(grade: AiDerivedAssessment["grade"]): NonNullable<BadgeProps["variant"]> {
  switch (grade) {
    case "no-finding":
      return "outline";
    case "MINOR":
      return "warning";
    case "MODERATE":
      return "warning";
    case "CRITICAL":
      return "destructive";
  }
}

/**
 * Founder-facing QA summary (Product Surface Pass, Priority 2). Reads a real,
 * persisted `DesignQaReport` (lib/services/design-qa-service.ts) as-is —
 * every verdict, confidence level, and finding shown here already exists on
 * that object. Two rules this view exists to enforce visually, not just
 * describe:
 *
 * 1. Deterministic and AI-derived assessments are never merged into one
 *    score — they render as two visually distinct blocks per category, each
 *    labeled with what produced it, per the founder's explicit instruction
 *    not to blend them into "one unexplained score."
 * 2. UNAVAILABLE is its own real badge state, never silently treated as or
 *    upgraded to PASS.
 */
export function QaReportView({ report }: { report: DesignQaReport }) {
  const readyAnswer =
    report.overallVerdict === "PASS"
      ? "Yes — no category failed, and quality checks actually ran against the real rendered page."
      : report.overallVerdict === "FAIL"
        ? "Not yet — at least one category found something that must be addressed first."
        : "Not yet — too much of this run's evidence is unavailable to call it a clean pass.";

  return (
    <div className="space-y-6">
      <div className="glass-panel space-y-4 p-8">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overall Quality Check</p>
          <Badge
            variant={
              report.overallVerdict === "PASS"
                ? "success"
                : report.overallVerdict === "FAIL"
                  ? "destructive"
                  : "warning"
            }
          >
            {report.overallVerdict}
          </Badge>
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Is this ready to show the client?</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{readyAnswer}</p>
        </div>
        {!report.renderedQaAvailable && (
          <p className="text-xs leading-relaxed text-amber-300">
            Rendered checks (real accessibility scan, real performance measurement) were unavailable for this run
            {report.renderedQaUnavailableReason ? `: ${report.renderedQaUnavailableReason}` : "."} Structural checks
            below still ran and are reported honestly on their own.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CATEGORY_ORDER.map((categoryId) => {
          const categoryReport = report.categories[categoryId];
          if (!categoryReport) return null;
          return <QaCategoryCard key={categoryId} label={CATEGORY_LABEL[categoryId]} report={categoryReport} />;
        })}
      </div>
    </div>
  );
}

function QaCategoryCard({
  label,
  report,
}: {
  label: string;
  report: DesignQaReport["categories"][QaCategoryId];
}) {
  const det = report.deterministic;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-sm font-medium text-foreground">{label}</CardTitle>
        <Badge variant={verdictBadgeVariant(det.verdict)}>{det.verdict}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {det.confidence} confidence — {det.evidenceSource === "none" ? "no evidence source" : `${det.evidenceSource} evidence`}
        </p>

        {det.findings.length > 0 && (
          <ul className="space-y-1">
            {det.findings.map((finding, i) => (
              <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                {finding}
              </li>
            ))}
          </ul>
        )}

        {report.aiDerived && <AiDerivedBlock assessment={report.aiDerived} />}
      </CardContent>
    </Card>
  );
}

function AiDerivedBlock({ assessment }: { assessment: AiDerivedAssessment }) {
  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">AI-derived assessment</p>
        <Badge variant={gradeBadgeVariant(assessment.grade)}>{assessment.grade}</Badge>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{assessment.reasoning}</p>
      {assessment.grade !== "no-finding" && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Recommendation: </span>
          {assessment.recommendation}
        </p>
      )}
    </div>
  );
}
