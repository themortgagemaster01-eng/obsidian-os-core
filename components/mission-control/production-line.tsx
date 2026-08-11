import { PRODUCTION_STAGES, type ProductionLineCounts } from "@/lib/services/mission-service";
import { cn } from "@/lib/utils";

export interface ProductionLineProps {
  counts: ProductionLineCounts;
  previewReady: number;
}

interface StageValue {
  key: string;
  label: string;
  count: number;
  needsAction: boolean;
  isReady: boolean;
}

function buildStageValues(counts: ProductionLineCounts, previewReady: number): StageValue[] {
  const values: Record<string, number> = { ...counts, preview: previewReady };
  return PRODUCTION_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    count: values[stage.key] ?? 0,
    needsAction: stage.key === "approval" && (values[stage.key] ?? 0) > 0,
    isReady: stage.key === "preview" && (values[stage.key] ?? 0) > 0,
  }));
}

function dotClasses(stage: StageValue): string {
  if (stage.needsAction) return "border-amber-300 bg-amber-300";
  if (stage.isReady) return "border-emerald-300 bg-emerald-300";
  return "border-border bg-background";
}

/**
 * The Line — Mission Control's signature element (Visual Redesign
 * synthesis). One continuous read of the real production pipeline:
 * Research -> Brief -> Approval -> Build -> QA -> Preview. A single rule
 * runs behind every stage with a tick mark at each position — six real
 * counts on one line, not six independent tiles — with real, honest counts.
 * Approval is called out when it holds missions (a founder decision is
 * waiting); Preview is called out when work is ready to share. Neither
 * callout depends on color alone — each carries its own text.
 *
 * Desktop renders the connected horizontal line. Mobile (< sm) renders a
 * vertical spine instead of forcing all six stages into a cramped or
 * horizontally-scrolling row — every stage stays visible without the founder
 * needing to discover hidden scroll affordance.
 */
export function ProductionLine({ counts, previewReady }: ProductionLineProps) {
  const stages = buildStageValues(counts, previewReady);

  return (
    <nav aria-label="Production pipeline">
      {/* Desktop: one continuous horizontal line with a tick per stage. */}
      <div className="relative hidden sm:block">
        <div aria-hidden="true" className="absolute left-0 right-0 top-[7px] h-px bg-border" />
        <ol className="relative grid grid-cols-6 gap-0">
          {stages.map((stage) => (
            <li key={stage.key} className="flex flex-col items-start pr-6">
              <span
                aria-hidden="true"
                className={cn("relative z-10 h-3.5 w-3.5 rounded-full border-2", dotClasses(stage))}
              />
              <span className="mt-3 font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                {stage.count}
              </span>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {stage.label}
              </p>
              {stage.needsAction && (
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                  Needs decision
                </p>
              )}
              {stage.isReady && (
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                  Ready to share
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* Mobile: a vertical spine — all six stages always visible, no scrolling to discover. */}
      <ol className="relative sm:hidden">
        <div aria-hidden="true" className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
        {stages.map((stage, index) => (
          <li key={stage.key} className={cn("relative flex items-center gap-4 pl-0", index > 0 && "mt-4")}>
            <span
              aria-hidden="true"
              className={cn("relative z-10 h-3.5 w-3.5 shrink-0 rounded-full border-2 bg-background", dotClasses(stage))}
            />
            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {stage.label}
                </p>
                {stage.needsAction && (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                    Needs decision
                  </p>
                )}
                {stage.isReady && (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                    Ready to share
                  </p>
                )}
              </div>
              <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                {stage.count}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </nav>
  );
}
