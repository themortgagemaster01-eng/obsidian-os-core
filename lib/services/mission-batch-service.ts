import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, MissionBatchStopReason } from "@/lib/supabase/database.types";
import { missionBatchRunRepository, type MissionBatchRunRow } from "@/lib/repositories/mission-batch-run-repository";
import { leadRepository, type LeadRow } from "@/lib/repositories/lead-repository";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { promoteLeadToMission, createLeadPromotionServiceDeps } from "@/lib/services/lead-promotion-service";
import { createAnalysisRun, runAnalysis, createAnalysisServiceDeps } from "@/lib/services/analysis-service";
import {
  createDesignBriefRun,
  runDesignBrief,
  approveDesignBrief,
  createDesignBriefServiceDeps,
} from "@/lib/services/design-brief-service";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import {
  createDesignGenerationRun,
  runDesignGeneration,
  createDesignGenerationServiceDeps,
} from "@/lib/services/design-generation-service";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import { createDesignQaRun, runDesignQa, createDesignQaServiceDeps } from "@/lib/services/design-qa-service";
import { createProposal, createProposalServiceDeps } from "@/lib/services/proposal-service";
import { createEmailDraft, createEmailDraftServiceDeps } from "@/lib/services/email-draft-service";
import { createMissionWorkflowDeps } from "@/lib/workflow/mission-workflow";

/**
 * lib/services/mission-batch-service.ts — Phase 9: the smallest safe
 * controlled-batch orchestrator. Preserves the existing mission pipeline
 * exactly as-is (analyze -> design-brief -> approve -> generate-design ->
 * qa -> proposal -> email-draft, every one of these an unmodified,
 * already-tested function this file only calls in the same sequence
 * scripts/_run-five-business-pipeline.mjs already proved works by hand) —
 * this file adds no parallel pipeline, no new generation logic, no new QA
 * logic, no new scoring/ranking/qualification logic.
 *
 * Concurrency is exactly 1 by design (docs/PHASE_9_CONTROLLED_BATCH_AUDIT.md
 * §G): candidates are processed one at a time, sequentially, mirroring
 * lib/services/lead-hunter-service.ts::runLeadHunterScan's own explicit
 * "don't hammer real, rate-limited/resource-heavy work" discipline.
 *
 * "Process N" means: keep attempting eligible candidates until N missions
 * genuinely reach `approval` with a real, persisted proposal AND a real
 * email draft — never merely "N missions were created" or "N attempts were
 * made". A candidate whose QA result is WARN/FAIL/INCOMPLETE still counts
 * as a real success once it legitimately reaches `approval` — QA has never
 * gated mission progression anywhere in this codebase (Phases 6.8/6.9/7/8),
 * and a batch run does not invent that gate now. Only a genuine failure —
 * an exception thrown by any stage — excludes a candidate from the count,
 * and moves on to the next one; this file never retries a failed stage
 * itself (no broad retry system this phase, per the founder's own explicit
 * scope).
 */

type TypedClient = SupabaseClient<Database>;

export interface MissionBatchServiceDeps {
  client: TypedClient;
  missionBatchRunRepository: typeof missionBatchRunRepository;
  leadRepository: Pick<typeof leadRepository, "findNextEligibleCandidate">;
}

export function createMissionBatchServiceDeps(client: TypedClient): MissionBatchServiceDeps {
  return { client, missionBatchRunRepository, leadRepository };
}

export interface RunMissionBatchInput {
  organizationId: string;
  /** The founder's own free-text target area (e.g. "Mahopac, NY") — matched against leads.location, never re-geocoded here. */
  location: string;
  /** "Process N" — how many real, approval-ready packages this run should try to produce. */
  requestedCount: number;
  /** The safety cap — this run stops once this many real attempts have been made, even short of requestedCount. Defaults to 3x requestedCount, a deliberately generous but real, bounded ceiling. */
  maxAttempts?: number;
  /** The founder/user id every created mission's owner_id and every stage's approvedBy becomes — the real person this batch is running on behalf of. */
  ownerId: string;
}

export interface MissionBatchAttemptResult {
  leadId: string;
  missionId: string | null;
  businessName: string;
  outcome: "succeeded" | "failed";
  failedStage?: string;
  errorMessage?: string;
}

/**
 * runOneCandidate — the exact existing mission pipeline, called in the same
 * sequence the five-business validation script already proved by hand,
 * using direct service calls (never HTTP — this already runs inside a
 * background, service-role context, the same reasoning
 * lib/services/lead-hunter-service.ts already applies to its own
 * candidate loop). Throws on the first real failure, carrying which stage
 * failed — the caller (runMissionBatch) is the only place that decides a
 * thrown error means "this candidate failed, move on," never a retry.
 */
async function runOneCandidate(client: TypedClient, lead: LeadRow, ownerId: string): Promise<{ missionId: string }> {
  const workflowDeps = createMissionWorkflowDeps(client);

  let missionId: string;
  try {
    const { mission } = await promoteLeadToMission(createLeadPromotionServiceDeps(client), { leadId: lead.id, ownerId });
    missionId = mission.id;
  } catch (err) {
    throw new StageError("promote", err);
  }

  try {
    const mission = await missionRepository.findById(client, missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found immediately after promotion.`);

    const analysisDeps = createAnalysisServiceDeps(client);
    const analysis = await createAnalysisRun(analysisDeps, { missionId, organizationId: mission.organization_id, companyId: mission.company_id });
    const completedAnalysis = await runAnalysis(analysisDeps, analysis.id);
    if (completedAnalysis.status !== "complete") {
      throw new Error(completedAnalysis.error_message ?? "Analysis did not complete.");
    }
  } catch (err) {
    throw new StageError("analyze", err, missionId);
  }

  try {
    const mission = await missionRepository.findById(client, missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found.`);

    const briefDeps = createDesignBriefServiceDeps(client);
    const designBrief = await createDesignBriefRun(briefDeps, { missionId, organizationId: mission.organization_id, companyId: mission.company_id });
    const completedBrief = await runDesignBrief(briefDeps, designBrief.id);
    if (completedBrief.status !== "complete") {
      throw new Error(completedBrief.error_message ?? "Design Brief generation did not complete.");
    }
    await approveDesignBrief(briefDeps, missionId, { approvedBy: ownerId });
  } catch (err) {
    throw new StageError("design-brief", err, missionId);
  }

  try {
    const designBrief = await designBriefRepository.findLatestByMission(client, missionId);
    if (!designBrief || designBrief.status !== "complete") {
      throw new Error("No completed Design Brief found after approval.");
    }
    const mission = await missionRepository.findById(client, missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found.`);

    const genDeps = createDesignGenerationServiceDeps(client);
    const websiteDesign = await createDesignGenerationRun(genDeps, {
      designBriefId: designBrief.id,
      missionId,
      organizationId: mission.organization_id,
    });
    const completedDesign = await runDesignGeneration(genDeps, websiteDesign.id);
    if (completedDesign.status !== "complete") {
      throw new Error(completedDesign.error_message ?? "Website generation did not complete.");
    }
  } catch (err) {
    throw new StageError("generate-design", err, missionId);
  }

  try {
    const websiteDesign = await websiteDesignRepository.findLatestByMission(client, missionId);
    if (!websiteDesign || websiteDesign.status !== "complete") {
      throw new Error("No completed website design found after generation.");
    }
    const qaDeps = createDesignQaServiceDeps(client);
    const run = await createDesignQaRun(qaDeps, { websiteDesignId: websiteDesign.id });
    // Diagnostic only, per this codebase's own established QA discipline —
    // runDesignQa never throws over a bad verdict; it only throws for a
    // genuine system failure (see design-qa-service.ts). A WARN/FAIL/
    // INCOMPLETE verdict is never treated as a stage failure here.
    await runDesignQa(qaDeps, run.id);
  } catch (err) {
    throw new StageError("qa", err, missionId);
  }

  try {
    const proposalDeps = createProposalServiceDeps(client, workflowDeps);
    await createProposal(proposalDeps, missionId);
  } catch (err) {
    throw new StageError("proposal", err, missionId);
  }

  try {
    const draftDeps = createEmailDraftServiceDeps(client, workflowDeps);
    await createEmailDraft(draftDeps, missionId);
  } catch (err) {
    throw new StageError("email-draft", err, missionId);
  }

  return { missionId };
}

/**
 * decideBatchStop — the pure "what does process N mean" decision (docs/
 * PHASE_9_CONTROLLED_BATCH_AUDIT.md §C, Model C), extracted on its own so
 * it is directly unit-testable without a real database. Checked in this
 * exact order: target already reached (a real success on the attempt that
 * just completed) beats every other reason, since a run that just hit its
 * goal should never be reported as having stopped for lack of candidates or
 * hitting the cap, even if both also happen to be true at that instant;
 * then the attempt cap; then whether a next real candidate exists at all.
 * Returns null while the run should keep going.
 */
export function decideBatchStop(state: {
  succeeded: number;
  attempted: number;
  requestedCount: number;
  maxAttempts: number;
  hasNextCandidate: boolean;
}): MissionBatchStopReason | null {
  if (state.succeeded >= state.requestedCount) return "target_reached";
  if (state.attempted >= state.maxAttempts) return "max_attempts_reached";
  if (!state.hasNextCandidate) return "pool_exhausted";
  return null;
}

class StageError extends Error {
  stage: string;
  missionId: string | null;
  constructor(stage: string, cause: unknown, missionId: string | null = null) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.stage = stage;
    this.missionId = missionId;
  }
}

/**
 * Phase 10: how long a "running" row is trusted before it's treated as
 * abandoned (a crashed process, a killed/cancelled job — never a thrown
 * error, which the outer try/catch below already turns into a real
 * "failed" status on its own). A tuning value, not an architectural one
 * (docs/PHASE_10_IMPLEMENTATION_PLAN.md §5 deliberately left the exact
 * number undecided) — four hours is comfortably above every real batch
 * duration observed in Phase 9's own end-to-end validation (2-7 minutes
 * per successful candidate, a handful of candidates per run) while still
 * catching a genuinely abandoned run well before the next scheduled
 * attempt. Deliberately not a fifth configurable input alongside
 * owner/location/target-count/safety-cap — this is an internal safety
 * parameter, not a per-run choice a caller should have to make.
 */
const DEFAULT_MAX_RUNNING_DURATION_MS = 4 * 60 * 60 * 1000;

export type OverlapGuardAction =
  | { kind: "proceed" }
  | { kind: "reap_stale_then_proceed"; staleRunId: string }
  | { kind: "skip_already_running"; runningRun: MissionBatchRunRow };

/**
 * decideOverlapGuardAction — Phase 10's own "is it safe to start a new run"
 * decision, pulled out as a pure function on the same principle
 * decideBatchStop already established: directly unit-testable without a
 * real database. Takes the organization's currently-`running` row, if any
 * (the caller must resolve this via a direct status-filtered query —
 * findRunningByOrganization, never findLatestByOrganization's "most
 * recently started regardless of status," which is a different question
 * that only coincides with this one when nothing has altered a row's
 * started_at after the fact). A null input means no run is in progress.
 */
export function decideOverlapGuardAction(
  currentlyRunningRun: MissionBatchRunRow | null,
  nowMs: number,
  maxRunningDurationMs: number
): OverlapGuardAction {
  // Defensive, even though the real caller is expected to have already
  // filtered to status='running' — never trust that a future caller got
  // that right, when checking here costs nothing.
  if (!currentlyRunningRun || currentlyRunningRun.status !== "running") {
    return { kind: "proceed" };
  }
  const startedAtMs = new Date(currentlyRunningRun.started_at).getTime();
  const ageMs = nowMs - startedAtMs;
  if (ageMs > maxRunningDurationMs) {
    return { kind: "reap_stale_then_proceed", staleRunId: currentlyRunningRun.id };
  }
  return { kind: "skip_already_running", runningRun: currentlyRunningRun };
}

/**
 * runMissionBatch — the one entry point. Mirrors runLeadHunterScan's own
 * shape exactly: a run row is created before any real work starts, one
 * broad try/catch around the whole loop records a genuine run-level failure
 * (never leaving the row stuck at "running"), and every real outcome
 * (success or failure) is recorded honestly, including a real stop_reason
 * once the run reaches one of its three defined stop conditions.
 *
 * Phase 10 addition: before any of that, an overlap guard (§4/§5 of
 * docs/PHASE_10_IMPLEMENTATION_PLAN.md) either lets this proceed, reaps a
 * genuinely abandoned prior run first, or skips entirely — living here,
 * once, means every caller (the existing manual dashboard route and the
 * new scheduled CLI script alike) gets identical protection automatically,
 * with nothing duplicated in either caller. The database's own partial
 * unique index (`mission_batch_runs_one_running_per_org`,
 * supabase/migrations/0026_mission_batch_overlap_guard.sql) remains the
 * real, final authority — this guard exists to produce an honest, legible
 * outcome instead of a raw constraint-violation error, not to replace the
 * constraint.
 */
export async function runMissionBatch(deps: MissionBatchServiceDeps, input: RunMissionBatchInput): Promise<MissionBatchRunRow> {
  const maxAttempts = input.maxAttempts ?? input.requestedCount * 3;

  // findRunningByOrganization, not findLatestByOrganization — the guard
  // needs "is a run currently in progress," a direct status-filtered query,
  // not "whatever run most recently started" (a different question that
  // only coincides with this one when nothing has altered a row's
  // started_at after the fact).
  const runningRun = await deps.missionBatchRunRepository.findRunningByOrganization(deps.client, input.organizationId);
  const overlapAction = decideOverlapGuardAction(runningRun, Date.now(), DEFAULT_MAX_RUNNING_DURATION_MS);

  if (overlapAction.kind === "skip_already_running") {
    return overlapAction.runningRun;
  }

  if (overlapAction.kind === "reap_stale_then_proceed") {
    await deps.missionBatchRunRepository.update(deps.client, overlapAction.staleRunId, {
      status: "failed",
      error_message:
        "Run considered abandoned — exceeded its maximum expected duration, likely due to a process restart, cancellation, or crash before it could reach a real terminal status.",
      completed_at: new Date().toISOString(),
    });
  }

  const run = await deps.missionBatchRunRepository.insert(deps.client, {
    organization_id: input.organizationId,
    location: input.location,
    requested_count: input.requestedCount,
    max_attempts: maxAttempts,
    status: "running",
  });

  try {
    const results: MissionBatchAttemptResult[] = [];
    const attemptedLeadIds: string[] = [];
    let succeeded = 0;
    let attempted = 0;
    let stopReason: MissionBatchStopReason | null = null;

    for (;;) {
      // Checked before ever querying for a next candidate — succeeded/
      // maxAttempts are already fully known without touching the database.
      stopReason = decideBatchStop({ succeeded, attempted, requestedCount: input.requestedCount, maxAttempts, hasNextCandidate: true });
      if (stopReason) break;

      const lead = await deps.leadRepository.findNextEligibleCandidate(deps.client, input.organizationId, input.location, attemptedLeadIds);
      stopReason = decideBatchStop({ succeeded, attempted, requestedCount: input.requestedCount, maxAttempts, hasNextCandidate: !!lead });
      if (stopReason || !lead) break;

      attemptedLeadIds.push(lead.id);
      attempted += 1;

      try {
        const { missionId } = await runOneCandidate(deps.client, lead, input.ownerId);
        await missionRepository.update(deps.client, missionId, { batch_run_id: run.id });
        succeeded += 1;
        results.push({ leadId: lead.id, missionId, businessName: lead.business_name, outcome: "succeeded" });
      } catch (err) {
        const stageErr = err instanceof StageError ? err : new StageError("unknown", err);
        results.push({
          leadId: lead.id,
          missionId: stageErr.missionId,
          businessName: lead.business_name,
          outcome: "failed",
          failedStage: stageErr.stage,
          errorMessage: stageErr.message,
        });
      }

      // Persist real progress after every attempt — never only at the end
      // — so a founder (or a resumed run) can always see honest, current
      // progress even if the process stops before the loop finishes.
      await deps.missionBatchRunRepository.update(deps.client, run.id, {
        attempted_count: attempted,
        succeeded_count: succeeded,
        failed_count: attempted - succeeded,
        results: results as unknown as MissionBatchRunRow["results"],
      });
    }

    return await deps.missionBatchRunRepository.update(deps.client, run.id, {
      status: "complete",
      stop_reason: stopReason,
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mission batch run failed for an unknown reason.";
    return await deps.missionBatchRunRepository.update(deps.client, run.id, {
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    });
  }
}
