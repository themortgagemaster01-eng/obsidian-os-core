import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { ConfidenceEntry } from "@/lib/services/opportunity-report-service";

/**
 * Confidence is a distinct signal from the score itself (§6.5): a category
 * that couldn't be measured must never carry the same visual weight as one
 * that was. High reads as a quiet, low-key badge (measurement worked as
 * expected, nothing to flag); Medium/Low/Unavailable escalate in color so a
 * reader can't mistake "we don't actually know" for "we measured this."
 */
function variantForConfidence(level: ConfidenceEntry["level"]): NonNullable<BadgeProps["variant"]> {
  switch (level) {
    case "High":
      return "outline";
    case "Medium":
      return "warning";
    case "Low":
    case "Unavailable":
      return "destructive";
  }
}

/**
 * The founder's explicit bar: confidence must be "visibly shown, not
 * buried." A hover-only tooltip fails that test for anything below High —
 * `showReason` renders the reason as real, always-visible text beneath the
 * badge rather than something a reader has to discover by hovering.
 */
export function ConfidenceBadge({
  entry,
  showReason = false,
  className,
}: {
  entry: ConfidenceEntry;
  showReason?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <Badge variant={variantForConfidence(entry.level)}>{entry.level} confidence</Badge>
      {showReason && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{entry.reason}</p>}
    </div>
  );
}
