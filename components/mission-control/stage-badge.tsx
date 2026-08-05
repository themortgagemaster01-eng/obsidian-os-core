import { Badge } from "@/components/ui/badge";
import { STAGE_LABELS, type MissionStage } from "@/lib/workflow/types";

/** Small pill showing a mission's current pipeline stage. */
export function StageBadge({ stage }: { stage: MissionStage }) {
  const variant = stage === "waiting_approval" ? "warning" : "navy";
  return <Badge variant={variant}>{STAGE_LABELS[stage]}</Badge>;
}
