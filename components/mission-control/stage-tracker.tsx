import type { MissionStageStep } from "@/lib/services/mission-service";
import { cn } from "@/lib/utils";

export interface StageTrackerProps {
  steps: MissionStageStep[];
}

/**
 * The per-mission echo of the Production Index's "STAGE · STAGE" grammar —
 * RESEARCH · BRIEF · APPROVAL · BUILD · QA · PREVIEW, read left to right.
 * Position in the pipeline is communicated by weight and opacity, not color
 * alone: the active stage is bold and full-strength, completed stages are
 * medium-weight and legible, upcoming stages fade toward the hairline. A
 * screen reader gets the full status per stage via the sr-only text below
 * each visual label.
 */
export function StageTracker({ steps }: StageTrackerProps) {
  const activeStep = steps.find((s) => s.status === "active");
  const activeIndex = steps.findIndex((s) => s.status === "active");
  const summary = activeStep
    ? `Stage ${activeIndex + 1} of ${steps.length}: ${activeStep.label} — in progress`
    : "Complete";

  return (
    <div className="flex flex-wrap items-baseline gap-y-1" role="group" aria-label={summary}>
      {steps.map((step, index) => (
        <span key={step.key} className="inline-flex items-baseline">
          {index > 0 && (
            <span aria-hidden="true" className="mx-1.5 text-muted-foreground/25">
              ·
            </span>
          )}
          <span
            aria-hidden="true"
            className={cn(
              "whitespace-nowrap text-[11px] uppercase tracking-wide",
              step.status === "active" && "font-semibold text-foreground",
              step.status === "complete" && "font-medium text-muted-foreground",
              step.status === "upcoming" && "text-muted-foreground/40"
            )}
          >
            {step.label}
          </span>
          <span className="sr-only">
            {step.label} — {step.status === "active" ? "in progress" : step.status}
          </span>
        </span>
      ))}
    </div>
  );
}
