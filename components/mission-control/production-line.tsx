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

/**
 * The Production Index — Mission Control's signature device. Replaces the
 * old six-tile stat row with one continuous typographic line: real, honest
 * counts per pipeline stage, read left to right as "RESEARCH · 2 · BRIEF ·
 * 2 · APPROVAL · 0 · ...". No boxes, no tiles — the interpunct and hairline
 * rule below do the work a grid of cards used to. The same "STAGE · value"
 * grammar repeats at the per-mission level in StageTracker.
 *
 * Approval (a founder decision waiting) and Preview (work ready to share)
 * are the two stages ever called out — never by color alone, each also
 * carries its own text ("needs decision" / "ready"). Wraps intelligently at
 * 375px rather than forcing six stages into a horizontal scroll.
 */
export function ProductionLine({ counts, previewReady }: ProductionLineProps) {
  const stages = buildStageValues(counts, previewReady);

  return (
    <nav aria-label="Production pipeline">
      <ol className="flex flex-wrap items-baseline gap-y-3">
        {stages.map((stage, index) => {
          const emphasisClass = stage.needsAction
            ? "text-amber-300"
            : stage.isReady
              ? "text-emerald-300"
              : undefined;

          return (
            <li key={stage.key} className="flex items-baseline gap-x-2">
              {index > 0 && (
                <span aria-hidden="true" className="mr-2 text-muted-foreground/25">
                  ·
                </span>
              )}
              <span
                aria-hidden="true"
                className={cn("text-xs font-medium uppercase tracking-wide", emphasisClass ?? "text-muted-foreground")}
              >
                {stage.label}
              </span>
              <span aria-hidden="true" className="text-muted-foreground/25">
                ·
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl",
                  emphasisClass ?? "text-foreground"
                )}
              >
                {stage.count}
              </span>
              {stage.needsAction && (
                <span aria-hidden="true" className="ml-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                  needs decision
                </span>
              )}
              {stage.isReady && (
                <span aria-hidden="true" className="ml-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                  ready
                </span>
              )}
              <span className="sr-only">
                {stage.label}: {stage.count}
                {stage.needsAction ? ", needs decision" : ""}
                {stage.isReady ? ", ready to share" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
