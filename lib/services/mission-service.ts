import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { missionRepository, type MissionRow } from "@/lib/repositories/mission-repository";
import type { WebsiteDesignRow } from "@/lib/repositories/website-design-repository";
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
  qaReady: number;
  previewReady: number;
}

/**
 * Computes the real, database-backed Mission Control stats for a given
 * organization. Every stat here is backed by a real column/table — no
 * placeholder metrics (see docs/05-Mission-Control.md for the dashboard
 * product-pass rationale that removed the five "Coming in a future sprint"
 * CRM-style tiles Sprint 1/2 originally shipped).
 *
 * Sprint 2 fixed a Sprint 1 correctness bug: "Completed Today" now uses
 * `state_changed_at` (updated only when `state` itself changes) rather than
 * `updated_at` (which could change for unrelated reasons), and rests on the
 * new single-source-of-truth `state` field instead of the old dual
 * status/stage columns.
 *
 * Dashboard Product Pass fixed a second real bug: "Waiting Approval" was
 * querying `state === "approval"` — the later proposal/email/approval/sent
 * gate — when the actual Founder Approval Gate (supabase/migrations/
 * 0011_founder_approval_gate.sql, lib/workflow/mission-state.ts) sits at
 * `state === "reviewing"`. `reviewing` is what a mission created today
 * actually reaches (Design Brief → Founder Approval → Generation); `approval`
 * is downstream of Proposal/Email, no path there is wired up yet, so the
 * dashboard reported 0 waiting approvals even with a mission genuinely
 * sitting at the Founder Approval Gate. Fixed here, at the dashboard query —
 * the state machine itself (mission-state.ts) is unchanged.
 *
 * `missionsWithPreview` is the set of mission ids with a completed
 * `website_designs` row (a real, renderable Design Preview) — the caller
 * builds it via `computeMissionsWithPreview()` below from
 * `websiteDesignRepository.listCompletedByOrganization()`, scoped to the
 * same organization as `missions`.
 */
export function computeMissionControlStats(
  missions: MissionRow[],
  missionsWithPreview: ReadonlySet<string> = new Set()
): MissionControlStats {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const runningMissions = missions.filter(
    (m) => m.state !== "sent" && m.state !== "archived" && m.state !== "rejected"
  ).length;

  const waitingApproval = missions.filter((m) => m.state === "reviewing").length;

  const qaReady = missions.filter((m) => m.state === "qa").length;

  const previewReady = missions.filter((m) => missionsWithPreview.has(m.id)).length;

  const completedToday = missions.filter((m) => {
    if (m.state !== "sent") return false;
    const stateChangedAt = new Date(m.state_changed_at);
    return stateChangedAt >= startOfToday;
  }).length;

  return { runningMissions, completedToday, waitingApproval, qaReady, previewReady };
}

/**
 * Builds the set of mission ids with a real, renderable Design Preview
 * (a completed `website_designs` row — matches the same "complete" gate
 * `app/missions/[id]/preview/page.tsx` itself renders against). Used both to
 * compute the `previewReady` dashboard stat and, in `MissionList`, to decide
 * per-row whether to show a direct "View Preview" link — never a fabricated
 * URL, and never shown for a mission with only a pending/failed/no design
 * run.
 */
export function computeMissionsWithPreview(
  designs: Pick<WebsiteDesignRow, "mission_id" | "status">[]
): Set<string> {
  const ids = new Set<string>();
  for (const design of designs) {
    if (design.status === "complete") {
      ids.add(design.mission_id);
    }
  }
  return ids;
}

/**
 * Missions sitting at the Founder Approval Gate (`reviewing`) need a human
 * decision now — Change 3 of the Dashboard Product Pass surfaces them first
 * in the list, ahead of missions merely in progress, while preserving the
 * existing most-recent-first order within each group.
 */
export function sortMissionsForReview(missions: MissionRow[]): MissionRow[] {
  const reviewing = missions.filter((m) => m.state === "reviewing");
  const rest = missions.filter((m) => m.state !== "reviewing");
  return [...reviewing, ...rest];
}
