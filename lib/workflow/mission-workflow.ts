import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  missionRepository,
  type MissionRow,
} from "@/lib/repositories/mission-repository";
import {
  companyRepository,
  type CompanyRow,
} from "@/lib/repositories/company-repository";
import { findOrCreateCompany } from "@/lib/services/company-service";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";
import {
  canArchive,
  canReject,
  isMissionState,
  isTerminalState,
  NEXT_STATE,
  type MissionState,
} from "@/lib/workflow/mission-state";

/**
 * Dependencies the workflow engine needs, injected by the caller. This is
 * intentionally a plain object rather than a DI container — just enough
 * indirection to keep the engine testable and decoupled from how the
 * Supabase client itself is constructed (browser vs server vs service role).
 *
 * Sprint 2: missionEventRepository is gone from here — the event bus is now
 * the single writer for the mission timeline (see lib/events/event-bus.ts),
 * removing the Sprint 1 duplication where the workflow engine inserted
 * mission_events rows directly.
 */
export interface MissionWorkflowDeps {
  client: SupabaseClient<Database>;
  missionRepository: typeof missionRepository;
  companyRepository: typeof companyRepository;
  eventBus: EventBus;
}

/** Builds the default deps object for a given Supabase client. */
export function createMissionWorkflowDeps(
  client: SupabaseClient<Database>
): MissionWorkflowDeps {
  return {
    client,
    missionRepository,
    companyRepository,
    eventBus: createEventBus(client),
  };
}

export interface CreateMissionInput {
  ownerId: string;
  organizationId: string;
  businessName: string;
  websiteUrl: string;
}

/**
 * Creates a new mission at the start of the pipeline (`state: 'discovered'`)
 * and publishes the `MissionStarted` event that seeds its timeline. This is
 * the entry point for a mission's life — no analysis or discovery work
 * happens here; actual agent execution is Sprint 3+.
 *
 * Also does the one piece of real Memory Vault integration wiring Sprint 2
 * ships: looks up (or creates) the Memory Vault company record for this
 * business via findOrCreateCompany and links the mission to it, so the
 * Memory Vault starts accumulating data immediately instead of being a
 * dead table nobody writes to.
 */
export async function createMission(
  deps: MissionWorkflowDeps,
  input: CreateMissionInput
): Promise<{ mission: MissionRow; company: CompanyRow }> {
  const mission = await deps.missionRepository.insert(deps.client, {
    owner_id: input.ownerId,
    organization_id: input.organizationId,
    business_name: input.businessName,
    website_url: input.websiteUrl,
    state: "discovered",
  });

  // Company must exist (with a real id) before we can point the mission at
  // it, and total_missions_count/last_mission_id should reflect *this*
  // mission — so find-or-create runs after the insert, passing the new
  // mission's id, then the mission is updated with the resolved company_id.
  const company = await findOrCreateCompany(
    { client: deps.client, companyRepository: deps.companyRepository },
    {
      organizationId: input.organizationId,
      businessName: input.businessName,
      websiteUrl: input.websiteUrl,
    },
    mission.id
  );

  const missionWithCompany = await deps.missionRepository.update(deps.client, mission.id, {
    company_id: company.id,
  });

  await deps.eventBus.publish({
    type: "MissionStarted",
    missionId: missionWithCompany.id,
    organizationId: missionWithCompany.organization_id,
    payload: {
      businessName: missionWithCompany.business_name,
      websiteUrl: missionWithCompany.website_url,
    },
  });

  return { mission: missionWithCompany, company };
}

export interface TransitionMissionStateOptions {
  /**
   * By default, transitionMissionState only allows moving to the state that
   * NEXT_STATE says follows the mission's current state, plus the handful
   * of explicit non-sequential transitions the state machine always
   * permits (see isImplicitlyAllowed below: the qa -> designing revise
   * loop, and any -> rejected side-transition) — this keeps the pipeline
   * predictable. Pass `allowNonSequential: true` to explicitly override
   * for anything else (e.g. an operator manually rewinding a mission, or a
   * future "skip state" admin action). The override is opt-in and must be
   * explicit so accidental out-of-order transitions don't silently happen.
   *
   * Two invariants are NOT overridable by this flag, even when true:
   * `archived` never transitions to anything (fully terminal), and
   * `rejected` only ever transitions to `archived`.
   */
  allowNonSequential?: boolean;
}

/**
 * Validates and performs a mission state transition: updates the mission's
 * `state` (state_changed_at is maintained by the
 * set_missions_state_changed_at DB trigger, not here) and publishes a
 * `StateChanged` event through the event bus.
 */
export async function transitionMissionState(
  deps: MissionWorkflowDeps,
  missionId: string,
  toState: MissionState,
  opts: TransitionMissionStateOptions = {}
): Promise<{ mission: MissionRow }> {
  if (!isMissionState(toState)) {
    throw new Error(`"${toState}" is not a valid mission state.`);
  }

  const current = await deps.missionRepository.findById(deps.client, missionId);
  if (!current) {
    throw new Error(`Mission ${missionId} not found.`);
  }

  // Hard invariants — never overridable, not even with allowNonSequential.
  if (isTerminalState(current.state)) {
    throw new Error(
      `Mission ${missionId} is in terminal state "${current.state}" and cannot transition further.`
    );
  }
  if (current.state === "rejected" && toState !== "archived") {
    throw new Error(
      `Mission ${missionId} is "rejected" and can only transition to "archived", not "${toState}".`
    );
  }

  const expectedNext = NEXT_STATE[current.state];
  const isSequential = expectedNext === toState;
  const isRejectSideTransition = toState === "rejected" && canReject(current.state);
  const isReviseLoop = current.state === "qa" && toState === "designing";
  const isRejectedToArchived = current.state === "rejected" && toState === "archived";
  const isImplicitlyAllowed =
    isSequential || isRejectSideTransition || isReviseLoop || isRejectedToArchived;

  if (!isImplicitlyAllowed && !opts.allowNonSequential) {
    throw new Error(
      `Cannot transition mission ${missionId} from "${current.state}" to "${toState}": ` +
        `expected next state is "${expectedNext ?? "none (terminal state)"}". ` +
        `Pass { allowNonSequential: true } to override.`
    );
  }

  const mission = await deps.missionRepository.update(deps.client, missionId, {
    state: toState,
  });

  await deps.eventBus.publish({
    type: "StateChanged",
    missionId: mission.id,
    organizationId: mission.organization_id,
    payload: { fromState: current.state, toState },
  });

  return { mission };
}

/**
 * Rejects a mission: an explicit, intention-revealing entry point for a
 * first-class product outcome (not just a flavor of archiving). Delegates
 * the actual state change to transitionMissionState, then publishes the
 * domain-specific `MissionRejected` event on top of the generic
 * `StateChanged` event transitionMissionState already publishes.
 */
export async function rejectMission(
  deps: MissionWorkflowDeps,
  missionId: string,
  reason?: string
): Promise<{ mission: MissionRow }> {
  const current = await deps.missionRepository.findById(deps.client, missionId);
  if (!current) {
    throw new Error(`Mission ${missionId} not found.`);
  }
  if (!canReject(current.state)) {
    throw new Error(`Mission ${missionId} cannot be rejected from state "${current.state}".`);
  }

  const { mission } = await transitionMissionState(deps, missionId, "rejected", {
    allowNonSequential: true,
  });

  await deps.eventBus.publish({
    type: "MissionRejected",
    missionId: mission.id,
    organizationId: mission.organization_id,
    payload: { reason },
  });

  return { mission };
}

/**
 * Archives a mission: an explicit, intention-revealing entry point covering
 * both the normal pipeline's terminal step (sent -> archived) and
 * housekeeping cleanup of a rejected mission (rejected -> archived).
 * Delegates the actual state change to transitionMissionState, then
 * publishes the domain-specific `MissionArchived` event on top of the
 * generic `StateChanged` event.
 */
export async function archiveMission(
  deps: MissionWorkflowDeps,
  missionId: string
): Promise<{ mission: MissionRow }> {
  const current = await deps.missionRepository.findById(deps.client, missionId);
  if (!current) {
    throw new Error(`Mission ${missionId} not found.`);
  }
  if (!canArchive(current.state)) {
    throw new Error(`Mission ${missionId} cannot be archived from state "${current.state}".`);
  }

  const { mission } = await transitionMissionState(deps, missionId, "archived", {
    allowNonSequential: true,
  });

  await deps.eventBus.publish({
    type: "MissionArchived",
    missionId: mission.id,
    organizationId: mission.organization_id,
    payload: {},
  });

  return { mission };
}
