import type { MissionStageStep } from "@/lib/services/mission-service";
import { cn } from "@/lib/utils";

export interface StageTrackerProps {
  steps: MissionStageStep[];
}

/**
 * Signal Room — the compact per-mission stage tracker (Visual Redesign
 * synthesis). Position, label, and a text status word all communicate state
 * together, not color alone: a completed stage's marker is filled and its
 * label is struck to normal weight, the active stage's marker is ringed and
 * its label bold, an upcoming stage's marker is a hollow outline.
 */
export function StageTracker({ steps }: StageTrackerProps) {
  const activeStep = steps.find((s) => s.status === "active");
  const activeIndex = steps.findIndex((s) => s.status === "active");
  const summary = activeStep
    ? `Stage ${activeIndex + 1} of ${steps.length}: ${activeStep.label} — in progress`
    : "Complete";

  return (
    <div className="flex items-center gap-1 sm:gap-1.5" role="group" aria-label={summary}>
      {steps.map((step, index) => (
        <div key={step.key} className="flex items-center gap-1 sm:gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "inline-block h-1.5 w-1.5 shrink-0 rounded-full border",
              step.status === "complete" && "border-foreground/70 bg-foreground/70",
              step.status === "active" && "border-amber-300 bg-amber-300",
              step.status === "upcoming" && "border-border bg-transparent"
            )}
          />
          {/* Labels are hidden below `sm` to keep the tracker compact enough for a
              375px viewport (six full labels don't fit) — the dot sequence alone
              still communicates position, and the full label + status is always
              present for assistive tech via the sr-only span below. */}
          <span
            aria-hidden="true"
            className={cn(
              "hidden whitespace-nowrap text-[10px] uppercase tracking-wide sm:inline",
              step.status === "active"
                ? "font-semibold text-foreground"
                : step.status === "complete"
                  ? "text-muted-foreground"
                  : "text-muted-foreground/50"
            )}
          >
            {step.label}
          </span>
          <span className="sr-only">
            {step.label} — {step.status === "active" ? "in progress" : step.status}
          </span>
          {index < steps.length - 1 && (
            <span aria-hidden="true" className="h-px w-2 shrink-0 bg-border sm:w-3" />
          )}
        </div>
      ))}
    </div>
  );
}
