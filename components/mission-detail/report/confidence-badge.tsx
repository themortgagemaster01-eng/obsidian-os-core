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

export function ConfidenceBadge({ entry, className }: { entry: ConfidenceEntry; className?: string }) {
  return (
    <Badge variant={variantForConfidence(entry.level)} className={className} title={entry.reason}>
      {entry.level} confidence
    </Badge>
  );
}
