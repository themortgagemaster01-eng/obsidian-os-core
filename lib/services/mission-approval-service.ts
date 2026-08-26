import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { proposalRepository, type ProposalRow } from "@/lib/repositories/proposal-repository";
import { missionRepository, type MissionRow } from "@/lib/repositories/mission-repository";
import { logDecision, createDecisionServiceDeps, type DecisionServiceDeps } from "@/lib/services/decision-service";
import { transitionMissionState, type MissionWorkflowDeps } from "@/lib/workflow/mission-workflow";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";

/**
 * lib/services/mission-approval-service.ts — Phase 8's founder-approval
 * boundary. Mirrors lib/workflow/mission-workflow.ts's own rejectMission
 * exactly in shape and guarantee (validate eligibility, act, throw a clear
 * error otherwise) — approval is not a separate architecture, it is the
 * other legitimate exit from the same Mission Engine gate.
 *
 * The one thing rejectMission never needed and this does: recording the
 * decision through the existing, previously-unconsumed Decision Memory
 * write path (lib/services/decision-service.ts::logDecision, built in an
 * earlier phase specifically "to capture perfect training data... even
 * though no UI calls this yet" — this is that first real call). Nothing
 * here sends anything: approval only records the decision, advances the
 * mission through the existing `approval -> sent` NEXT_STATE move, and
 * publishes the existing `MissionApproved` event. `sent` means
 * approved/outreach-ready, per the founder's own Phase 8 framing — never an
 * actual email send, which stays a separate, later, unbuilt phase.
 */

type TypedClient = SupabaseClient<Database>;

export interface MissionApprovalServiceDeps {
  client: TypedClient;
  missionRepository: typeof missionRepository;
  proposalRepository: typeof proposalRepository;
  decisionDeps: DecisionServiceDeps;
  workflowDeps: MissionWorkflowDeps;
  eventBus: EventBus;
}

export function createMissionApprovalServiceDeps(client: TypedClient, workflowDeps: MissionWorkflowDeps): MissionApprovalServiceDeps {
  return {
    client,
    missionRepository,
    proposalRepository,
    decisionDeps: createDecisionServiceDeps(client),
    workflowDeps,
    eventBus: createEventBus(client),
  };
}

export interface ApproveMissionResult {
  mission: MissionRow;
  proposal: ProposalRow;
}

/**
 * approveMission — only a mission at `state === "approval"`, with a real
 * proposal carrying both assembled content AND a real email draft, is
 * eligible (mirrors rejectMission's own "validate eligibility, then act"
 * shape). Never reachable from `qa`/`proposal`/`email` directly — a mission
 * must have genuinely passed through proposal assembly and email-draft
 * generation first, the same structural guarantee transitionMissionState's
 * own NEXT_STATE sequencing already enforces; this function adds no
 * separate, bypassable gate of its own.
 */
export async function approveMission(
  deps: MissionApprovalServiceDeps,
  missionId: string,
  approvedBy: string
): Promise<ApproveMissionResult> {
  const mission = await deps.missionRepository.findById(deps.client, missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);
  if (mission.state !== "approval") {
    throw new Error(`Mission ${missionId} is at state "${mission.state}", not "approval" — cannot approve a mission that has not reached the founder review gate.`);
  }

  const existingProposal = await deps.proposalRepository.findByMission(deps.client, missionId);
  if (!existingProposal || !existingProposal.content || !existingProposal.email_subject || !existingProposal.email_body) {
    throw new Error(`Mission ${missionId} has no complete proposal + email draft — cannot approve without both.`);
  }

  const proposal = await deps.proposalRepository.update(deps.client, existingProposal.id, { status: "approved" });

  await logDecision(deps.decisionDeps, {
    missionId,
    organizationId: mission.organization_id,
    decisionType: "approve",
    userAction: "approve",
    afterValue: { proposalId: proposal.id, emailSubject: proposal.email_subject },
    emailSubject: proposal.email_subject ?? undefined,
    emailLength: proposal.email_body?.length,
  });

  const { mission: updatedMission } = await transitionMissionState(deps.workflowDeps, missionId, "sent");

  await deps.eventBus.publish({
    type: "MissionApproved",
    missionId,
    organizationId: mission.organization_id,
    payload: { approvedBy },
  });

  return { mission: updatedMission, proposal };
}

/**
 * recordEmailEdit — the one, minimal founder-editing path this phase
 * builds: plain subject/body text on the same live `proposals` row (never
 * the structured `content` object, which stays system-generated — a real,
 * disclosed simplification; editing the full proposal content would need a
 * larger editing surface than "the smallest complete vertical slice" calls
 * for). Every edit is logged through the existing Decision Memory
 * (`decision_type: "edit_email"`) with real before/after values — never
 * silently overwritten with no trace, mirroring this codebase's own
 * "Decision Memory is permanent history" doctrine (CLAUDE.md).
 */
export async function recordEmailEdit(
  deps: MissionApprovalServiceDeps,
  missionId: string,
  edits: { emailSubject: string; emailBody: string },
  editedBy: string
): Promise<ProposalRow> {
  const mission = await deps.missionRepository.findById(deps.client, missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);
  if (mission.state !== "approval" && mission.state !== "email") {
    throw new Error(`Mission ${missionId} is at state "${mission.state}" — an email draft can only be edited while awaiting founder review.`);
  }

  const existing = await deps.proposalRepository.findByMission(deps.client, missionId);
  if (!existing) throw new Error(`Mission ${missionId} has no proposal to edit.`);

  const before = { emailSubject: existing.email_subject, emailBody: existing.email_body };
  const proposal = await deps.proposalRepository.update(deps.client, existing.id, {
    email_subject: edits.emailSubject,
    email_body: edits.emailBody,
  });

  await logDecision(deps.decisionDeps, {
    missionId,
    organizationId: mission.organization_id,
    decisionType: "edit_email",
    userAction: `edited by ${editedBy}`,
    beforeValue: before,
    afterValue: { emailSubject: proposal.email_subject, emailBody: proposal.email_body },
    emailSubject: proposal.email_subject ?? undefined,
    emailLength: proposal.email_body?.length,
  });

  return proposal;
}
