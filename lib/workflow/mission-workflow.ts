import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  missionRepository,
  type MissionRow,
} from "@/lib/repositories/mission-repository";
import {
  missionEventRepository,
  type MissionEventRow,
} from "@/lib/repositories/mission-event-repository";
import {
  isMissionStage,
  NEXT_STAGE,
  STAGE_LABELS,
  type MissionStage,
} from "@/lib/workflow/types";

/**
 * Dependencies the workflow engine needs, injected by the caller. This is
 * intentionally a plain object rather than a DI container — just enough
 * indirection to keep the engine testable and decoupled from how the
 * Supabase client itself is constructed (browser vs server vs service role).
 */
export interface MissionWorkflowDeps {
  client: SupabaseClient<Database>;
  missionRepository: typeof missionRepository;
  missionEventRepository: typeof missionEventRepository;
}

/** Builds the default deps object for a given Supabase client. */
export function createMissionWorkflowDeps(
  client: SupabaseClient<Database>
): MissionWorkflowDeps {
  return { client, missionRepository, missionEventRepository };
}

export interface CreateMissionInput {
  ownerId: string;
  businessName: string;
  websiteUrl: string;
}

/**
 * Creates a new mission at the start of the pipeline (`recon` stage,
 * `active` status) and writes the `mission_created` event that seeds its
 * timeline. This is the entry point for a mission's life — no analysis or
 * discovery work happens here; actual recon/research agent execution is
 * Sprint 2+.
 */
export async function createMission(
  deps: MissionWorkflowDeps,
  input: CreateMissionInput
): Promise<{ mission: MissionRow; event: MissionEventRow }> {
  const mission = await deps.missionRepository.insert(deps.client, {
    owner_id: input.ownerId,
    business_name: input.businessName,
    website_url: input.websiteUrl,
    status: "active",
    stage: "recon",
  });

  const event = await deps.missionEventRepository.insert(deps.client, {
    mission_id: mission.id,
    event_type: "mission_created",
    message: `Mission created for ${mission.business_name} (${mission.website_url})`,
    metadata: { stage: mission.stage, status: mission.status },
  });

  return { mission, event };
}

export interface TransitionMissionStageOptions {
  /**
   * By default, transitionMissionStage only allows moving to the stage
   * that NEXT_STAGE says follows the mission's current stage — this keeps
   * the pipeline linear and predictable. Pass `allowNonSequential: true`
   * to explicitly override that check (e.g. an operator manually rewinding
   * a mission, or a future "skip stage" admin action). The override is
   * opt-in and must be explicit so accidental out-of-order transitions
   * don't silently happen.
   */
  allowNonSequential?: boolean;
}

/**
 * Validates and performs a mission stage transition: updates the mission's
 * `stage` (and `status`, when entering `waiting_approval` or when the
 * caller marks a mission `completed`), and writes a `stage_changed` event
 * with a human-readable message.
 */
export async function transitionMissionStage(
  deps: MissionWorkflowDeps,
  missionId: string,
  toStage: MissionStage,
  opts: TransitionMissionStageOptions = {}
): Promise<{ mission: MissionRow; event: MissionEventRow }> {
  if (!isMissionStage(toStage)) {
    throw new Error(`"${toStage}" is not a valid mission stage.`);
  }

  const current = await deps.missionRepository.findById(deps.client, missionId);
  if (!current) {
    throw new Error(`Mission ${missionId} not found.`);
  }

  const expectedNext = NEXT_STAGE[current.stage];
  const isSequential = expectedNext === toStage;

  if (!isSequential && !opts.allowNonSequential) {
    throw new Error(
      `Cannot transition mission ${missionId} from "${current.stage}" to "${toStage}": ` +
        `expected next stage is "${expectedNext ?? "none (terminal stage)"}". ` +
        `Pass { allowNonSequential: true } to override.`
    );
  }

  const nextStatus = toStage === "waiting_approval" ? "waiting_approval" : current.status;

  const mission = await deps.missionRepository.update(deps.client, missionId, {
    stage: toStage,
    status: nextStatus,
  });

  const event = await deps.missionEventRepository.insert(deps.client, {
    mission_id: mission.id,
    event_type: "stage_changed",
    message: `Stage changed from ${STAGE_LABELS[current.stage]} to ${STAGE_LABELS[toStage]}`,
    metadata: { fromStage: current.stage, toStage, status: mission.status },
  });

  return { mission, event };
}
