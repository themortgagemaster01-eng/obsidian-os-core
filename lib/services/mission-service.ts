import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { missionRepository, type MissionRow } from "@/lib/repositories/mission-repository";
import type { WebsiteDesignRow } from "@/lib/repositories/website-design-repository";
import type { MissionState } from "@/lib/workflow/mission-state";
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
  /** Phase 2: optional Memory Vault seeding from a promoted lead's own qualification evidence — see lib/services/lead-promotion-service.ts. */
  industry?: string;
  businessCategory?: string;
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
    industry: request.industry,
    businessCategory: request.businessCategory,
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

/**
 * The Line — Mission Control's production-pipeline spine (Visual Redesign
 * synthesis). Six stages a founder can look at and understand: Research,
 * Brief, Approval, Build, QA, Preview. `preview` is deliberately not a
 * `MissionState` — see `ProductionLineStage` below — it's a real, already
 * computed artifact (`computeMissionsWithPreview()`), not a pipeline
 * position, so a mission can be "in QA" and "preview ready" at once (Design
 * Generation completes, and can produce a renderable `website_designs` row,
 * before `design-qa-service.ts` ever runs and moves `state` to `qa`).
 */
export const PRODUCTION_STAGES = [
  { key: "research", label: "Research" },
  { key: "brief", label: "Brief" },
  { key: "approval", label: "Approval" },
  { key: "build", label: "Build" },
  { key: "qa", label: "QA" },
  { key: "preview", label: "Preview" },
] as const;

export type StageKey = (typeof PRODUCTION_STAGES)[number]["key"];

/** The five `MissionState`-backed positions on the Line — `preview` excluded, see above. */
export type ProductionLineStage = Exclude<StageKey, "preview">;

/**
 * Maps each real mission `state` to its position on the Line. `null` for
 * states off the production line: `archived`/`rejected` (rejecting or
 * archiving overwrites `state`, so how far the mission actually got is not
 * recoverable from this field alone — never fabricated here) and the
 * downstream proposal/email/approval/sent sales-pipeline states, which are
 * real but explicitly unwired (`docs/05-Mission-Control.md`) and represent a
 * different pipeline than the one this Line visualizes.
 */
const PRODUCTION_LINE_STAGE_BY_STATE: Record<MissionState, ProductionLineStage | null> = {
  discovered: "research",
  analyzing: "research",
  researching: "brief",
  reviewing: "approval",
  designing: "build",
  qa: "qa",
  proposal: null,
  email: null,
  approval: null,
  sent: null,
  archived: null,
  rejected: null,
};

export function getProductionLineStage(state: MissionState): ProductionLineStage | null {
  return PRODUCTION_LINE_STAGE_BY_STATE[state];
}

export type ProductionLineCounts = Record<ProductionLineStage, number>;

/** Real, honest counts per Line stage — never fabricated for a stage with no missions. */
export function computeProductionLineCounts(missions: MissionRow[]): ProductionLineCounts {
  const counts: ProductionLineCounts = { research: 0, brief: 0, approval: 0, build: 0, qa: 0 };
  for (const mission of missions) {
    const stage = getProductionLineStage(mission.state);
    if (stage) counts[stage] += 1;
  }
  return counts;
}

export type StageStatus = "complete" | "active" | "upcoming";

export interface MissionStageStep {
  key: StageKey;
  label: string;
  status: StageStatus;
}

/**
 * Signal Room — the compact per-mission stage tracker. Returns `null` for a
 * mission off the Line (see `getProductionLineStage`): rather than guess how
 * far a rejected/archived mission got, the tracker is omitted and the
 * existing `StateBadge` (which already renders "Rejected"/"Archived")
 * remains the sole, honest status indicator for those rows.
 */
export function computeMissionStageTrack(
  mission: Pick<MissionRow, "state">,
  hasPreview: boolean
): MissionStageStep[] | null {
  const activeStage = getProductionLineStage(mission.state);
  if (!activeStage) return null;

  const activeIndex = PRODUCTION_STAGES.findIndex((stage) => stage.key === activeStage);

  return PRODUCTION_STAGES.map((stage, index) => {
    let status: StageStatus;
    if (stage.key === "preview") {
      status = hasPreview ? "complete" : "upcoming";
    } else if (index < activeIndex) {
      status = "complete";
    } else if (index === activeIndex) {
      status = "active";
    } else {
      status = "upcoming";
    }
    return { key: stage.key, label: stage.label, status };
  });
}

/** States that require a founder decision right now — the Design Brief Approval Gate ("reviewing") and, since Phase 8, the Prospect-to-Approval Gate ("approval": a real, complete proposal + email draft is already waiting). Both are real "a human must act" states; neither is more urgent than the other. */
const NEEDS_REVIEW_STATES: ReadonlySet<MissionState> = new Set(["reviewing", "approval"]);

export interface MissionGroups {
  /** State === "reviewing" or "approval" — a real decision is required now. */
  needsReview: MissionRow[];
  /** On the Line, no preview yet. */
  inProduction: MissionRow[];
  /** A real, renderable Design Preview exists. */
  readyToPresent: MissionRow[];
}

/**
 * Groups every mission into exactly one of three sections for the Mission
 * List (Studio Docket synthesis) — nothing is hidden: the three groups
 * always sum to `missions.length`. Order within each group preserves the
 * input order (most-recent-first, from `listMissionsForOrganization`).
 *
 * Phase 9 fix: `needsReview` previously checked only `state === "reviewing"`
 * — a mission Phase 8's own workflow already advanced to `"approval"` (a
 * real, complete proposal + email draft, genuinely awaiting a founder
 * decision) fell through to `inProduction`/`readyToPresent` instead, the
 * exact bug a founder's "wake up and see what's ready to review" morning
 * workflow depends on not having. Fixed here, not worked around in the
 * batch service — the dashboard's own grouping is where this always
 * belonged.
 */
export function groupMissionsForDisplay(
  missions: MissionRow[],
  missionsWithPreview: ReadonlySet<string> = new Set()
): MissionGroups {
  const needsReview: MissionRow[] = [];
  const readyToPresent: MissionRow[] = [];
  const inProduction: MissionRow[] = [];

  for (const mission of missions) {
    if (NEEDS_REVIEW_STATES.has(mission.state)) {
      needsReview.push(mission);
    } else if (missionsWithPreview.has(mission.id)) {
      readyToPresent.push(mission);
    } else {
      inProduction.push(mission);
    }
  }

  return { needsReview, inProduction, readyToPresent };
}
