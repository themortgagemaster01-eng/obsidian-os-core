import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import { proposalRepository, type ProposalRow } from "@/lib/repositories/proposal-repository";
import { missionRepository } from "@/lib/repositories/mission-repository";
import type { ProposalContent } from "@/lib/services/proposal-service";
import { transitionMissionState, type MissionWorkflowDeps } from "@/lib/workflow/mission-workflow";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";

/**
 * lib/services/email-draft-service.ts — Phase 8's deterministic email-draft
 * generation. No LLM call, no email provider, no send: composes a subject
 * and body entirely from the already-assembled ProposalContent
 * (lib/services/proposal-service.ts) — the same real business name, real
 * demo link, and real, evidence-backed opportunity findings a founder
 * already reviewed, never generic boilerplate a template with no real
 * inputs would produce. The result is a plain, editable draft — founder
 * edits happen by updating the same `proposals` row (see
 * app/api/missions/[id]/proposal/route.ts's PATCH handler), each edit
 * logged via the existing Decision Memory (`decisions.decision_type =
 * "edit_email"`), never by regenerating this template.
 */

type TypedClient = SupabaseClient<Database>;

export interface EmailDraftContent {
  subject: string;
  body: string;
}

/** Pure — no I/O. Independently testable against a hand-built ProposalContent fixture. */
export function assembleEmailDraft(content: ProposalContent): EmailDraftContent {
  const topOpportunities = content.keyOpportunities.slice(0, 2);
  const opportunityLines = topOpportunities.length > 0
    ? topOpportunities.map((o) => `- ${o.title}: ${o.detail}`).join("\n")
    : "- A few concrete opportunities to improve the current site's performance and presentation.";

  const subject = `A quick redesign concept for ${content.businessName}`;

  const body = [
    `Hi there,`,
    ``,
    `I took a look at ${content.businessName}'s current website (${content.websiteUrl}) and put together a redesign concept along with a short review of what's working well and what could be improved.`,
    ``,
    `A few things that stood out:`,
    opportunityLines,
    ``,
    `You can view the concept here: ${content.demoUrl}`,
    ``,
    content.proposedNextStep,
    ``,
    `Best,`,
  ].join("\n");

  return { subject, body };
}

export interface EmailDraftServiceDeps {
  client: TypedClient;
  missionRepository: typeof missionRepository;
  proposalRepository: typeof proposalRepository;
  workflowDeps: MissionWorkflowDeps;
  eventBus: EventBus;
}

export function createEmailDraftServiceDeps(client: TypedClient, workflowDeps: MissionWorkflowDeps): EmailDraftServiceDeps {
  return { client, missionRepository, proposalRepository, workflowDeps, eventBus: createEventBus(client) };
}

/**
 * createEmailDraft — the orchestration entry point. Requires the mission
 * to be at `state === "proposal"` with a real, already-assembled proposal
 * row. Updates the same proposal row's `email_subject`/`email_body`
 * (never a new row — one live artifact per mission), then advances the
 * mission through both `proposal -> email` and `email -> approval`
 * (both already-defined NEXT_STATE moves) as one atomic unit: there is no
 * distinct founder action between "an email draft now exists" and "this
 * mission is awaiting founder review" — the second transition has no
 * dedicated domain event of its own (only `EmailDraftReady` does),
 * confirming it was never meant to be a separate, independently-triggered
 * milestone.
 */
export async function createEmailDraft(deps: EmailDraftServiceDeps, missionId: string): Promise<ProposalRow> {
  const mission = await deps.missionRepository.findById(deps.client, missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);
  if (mission.state !== "proposal") {
    throw new Error(`Mission ${missionId} is at state "${mission.state}", not "proposal" — an email draft requires an assembled proposal first.`);
  }

  const existing = await deps.proposalRepository.findByMission(deps.client, missionId);
  if (!existing || !existing.content) {
    throw new Error(`Mission ${missionId} has no assembled proposal content — cannot draft an email without it.`);
  }

  const draft = assembleEmailDraft(existing.content as unknown as ProposalContent);

  const proposal = await deps.proposalRepository.update(deps.client, existing.id, {
    email_subject: draft.subject,
    email_body: draft.body,
  });

  await transitionMissionState(deps.workflowDeps, missionId, "email");
  await transitionMissionState(deps.workflowDeps, missionId, "approval");

  await deps.eventBus.publish({
    type: "EmailDraftReady",
    missionId,
    organizationId: mission.organization_id,
    payload: { subject: draft.subject, length: draft.body.length },
  });

  return proposal;
}
