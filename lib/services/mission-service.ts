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
  businessName: string;
  websiteUrl: string;
}

/**
 * Orchestrates creation of a new mission: delegates the actual state-machine
 * work (insert + seed event) to the workflow engine. Route handlers / server
 * actions should call this rather than touching the repository or workflow
 * engine directly.
 *
 * Note: this does NOT trigger any analysis, scraping, or discovery work —
 * that's the job of background agents introduced in Sprint 2+. Creating a
 * mission here only queues it at the `recon` stage.
 */
export async function createMission(
  client: TypedClient,
  request: CreateMissionRequest
): Promise<MissionRow> {
  const deps = createMissionWorkflowDeps(client);
  const { mission } = await workflowCreateMission(deps, {
    ownerId: request.ownerId,
    businessName: request.businessName,
    websiteUrl: request.websiteUrl,
  });
  return mission;
}

/** Fetches every mission owned by `ownerId`, most recent first. */
export async function listMissionsForOwner(
  client: TypedClient,
  ownerId: string
): Promise<MissionRow[]> {
  return missionRepository.listByOwner(client, ownerId);
}

export interface MissionControlStats {
  runningMissions: number;
  completedToday: number;
  waitingApproval: number;
}

/**
 * Computes the real, database-backed Mission Control stats for a given
 * owner. Only stats with a backing table in Sprint 1 (missions) are
 * computed here — Revenue Pipeline, Meetings Scheduled, Proposal Queue,
 * Draft Emails, and Website Builds have no backing tables yet and are
 * rendered as honest empty states directly in the dashboard component.
 */
export function computeMissionControlStats(missions: MissionRow[]): MissionControlStats {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const runningMissions = missions.filter((m) => m.status === "active").length;

  const waitingApproval = missions.filter((m) => m.status === "waiting_approval").length;

  const completedToday = missions.filter((m) => {
    if (m.status !== "completed") return false;
    const updatedAt = new Date(m.updated_at);
    return updatedAt >= startOfToday;
  }).length;

  return { runningMissions, completedToday, waitingApproval };
}
