import { Badge, type BadgeProps } from "@/components/ui/badge";
import { STATE_LABELS, type MissionState } from "@/lib/workflow/mission-state";

/** Chooses a badge color family that reflects where a state sits in the pipeline. */
function variantForState(state: MissionState): NonNullable<BadgeProps["variant"]> {
  switch (state) {
    case "sent":
      return "success";
    case "approval":
    case "reviewing":
      return "warning";
    case "rejected":
      return "destructive";
    case "archived":
      return "outline";
    default:
      return "navy";
  }
}

/** Small pill showing a mission's current state. */
export function StateBadge({ state }: { state: MissionState }) {
  return <Badge variant={variantForState(state)}>{STATE_LABELS[state]}</Badge>;
}
