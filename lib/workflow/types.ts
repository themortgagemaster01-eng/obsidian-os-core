/**
 * The Mission pipeline: the fixed sequence of stages every mission moves
 * through, from initial recon of a prospect's web presence to the
 * outreach/approval hand-off. Values are snake_case to match the
 * `missions.stage` column check constraint in supabase/migrations/0001_init.sql.
 */
export type MissionStage =
  | "recon"
  | "research"
  | "copywriting"
  | "design"
  | "seo"
  | "performance"
  | "proposal"
  | "deployment"
  | "outreach"
  | "waiting_approval";

/**
 * The lifecycle status of a mission, independent of which pipeline stage
 * it is currently in. A mission is usually `active` while it moves through
 * stages, flips to `waiting_approval` once it reaches the final stage, and
 * becomes `completed`, `failed`, or `archived` from there.
 */
export type MissionStatus =
  | "active"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "archived";

/**
 * Canonical ordered list of every stage in the pipeline. Order matters:
 * it defines what "next stage" means for NEXT_STAGE below and for any
 * future auto-advancement logic.
 */
export const MISSION_STAGES: readonly MissionStage[] = [
  "recon",
  "research",
  "copywriting",
  "design",
  "seo",
  "performance",
  "proposal",
  "deployment",
  "outreach",
  "waiting_approval",
] as const;

/** Human-readable display names for each stage, for UI rendering. */
export const STAGE_LABELS: Record<MissionStage, string> = {
  recon: "Recon",
  research: "Research",
  copywriting: "Copywriting",
  design: "Design",
  seo: "SEO",
  performance: "Performance",
  proposal: "Proposal",
  deployment: "Deployment",
  outreach: "Outreach",
  waiting_approval: "Waiting Approval",
};

/**
 * Maps each stage to the stage that follows it, or `null` for the terminal
 * stage. This supports future auto-advancement (a background job runner
 * moving a mission forward once an agent finishes its work) without
 * hardcoding pipeline order in multiple places.
 */
export const NEXT_STAGE: Record<MissionStage, MissionStage | null> = {
  recon: "research",
  research: "copywriting",
  copywriting: "design",
  design: "seo",
  seo: "performance",
  performance: "proposal",
  proposal: "deployment",
  deployment: "outreach",
  outreach: "waiting_approval",
  waiting_approval: null,
};

/** Type guard: is `value` a valid MissionStage? */
export function isMissionStage(value: string): value is MissionStage {
  return (MISSION_STAGES as readonly string[]).includes(value);
}

const MISSION_STATUSES: readonly MissionStatus[] = [
  "active",
  "waiting_approval",
  "completed",
  "failed",
  "archived",
];

/** Type guard: is `value` a valid MissionStatus? */
export function isMissionStatus(value: string): value is MissionStatus {
  return (MISSION_STATUSES as readonly string[]).includes(value);
}
