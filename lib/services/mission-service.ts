import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { missionRepository, type MissionRow } from "@/lib/repositories/mission-repository";
import {
  createMission as workflowCreateMission,
  createMissionWorkflowDeps,
} from "@/lib/workflow/mission-workflow";

type TypedClient = SupabaseClient<Database>;

export interface CreateMissionRequest {
  ownerId: string;
  organizationId: string;
  businessName: string;
  websiteUrl: string;
}

/**
 * Orchestrates creation of a new mission: delegates the actual state-machine
 * work (insert + Memory Vault linking + seed event) to the workflow engine.
 * Route handlers / server actions should call this rather than touching the
 * repository or workflow engine directly.
 *
 * Note: this does NOT trigger any analysis, scraping, or discovery work —
 * that's the job of background agents introduced in Sprint 3+. Creating a
 * mission here only queues it at the `discovered` state.
 */
export async function createMission(
  client: TypedClient,
  request: CreateMissionRequest
): Promise<MissionRow> {
  const deps = createMissionWorkflowDeps(client);
  const { mission } = await workflowCreateMission(deps, {
    ownerId: request.ownerId,
    organizationId: request.organizationId,
    businessName: request.businessName,
    websiteUrl: request.websiteUrl,
  });
  return mission;
}

/** Fetches every mission in `organizationId`, most recent first. */
export async function listMissionsForOrganization(
  client: TypedClient,
  organizationId: string
): Promise<MissionRow[]> {
  return missionRepository.listByOrganization(client, organizationId);
}

export interface MissionControlStats {
  runningMissions: number;
  completedToday: number;
  waitingApproval: number;
}

/**
 * Computes the real, database-backed Mission Control stats for a given
 * organization. Only stats with a backing table in Sprint 2 (missions) are
 * computed here — Revenue Pipeline, Meetings Scheduled, Proposal Queue,
 * Draft Emails, and Website Builds have no backing tables yet and are
 * rendered as honest empty states directly in the dashboard component.
 *
 * Sprint 2 fixes a Sprint 1 correctness bug: "Completed Today" now uses
 * `state_changed_at` (updated only when `state` itself changes) rather than
 * `updated_at` (which could change for unrelated reasons), and rests on the
 * new single-source-of-truth `state` field instead of the old dual
 * status/stage columns.
 */
export function computeMissionControlStats(missions: MissionRow[]): MissionControlStats {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const runningMissions = missions.filter(
    (m) => m.state !== "sent" && m.state !== "archived" && m.state !== "rejected"
  ).length;

  const waitingApproval = missions.filter((m) => m.state === "approval").length;

  const completedToday = missions.filter((m) => {
    if (m.state !== "sent") return false;
    const stateChangedAt = new Date(m.state_changed_at);
    return stateChangedAt >= startOfToday;
  }).length;

  return { runningMissions, completedToday, waitingApproval };
}
