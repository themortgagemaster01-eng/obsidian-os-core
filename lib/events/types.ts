import type { MissionState } from "@/lib/workflow/mission-state";
import type { DecisionType } from "@/lib/repositories/decision-repository";

/**
 * The formal event bus's event catalog. Every event type here is both the
 * TS discriminant AND the exact string persisted in mission_events.event_type
 * (see supabase/migrations/0004_event_bus.sql) — no snake_case translation
 * layer between the two, deliberately, to keep this simple.
 *
 * Two additions beyond the eight named in the original brief:
 *   - StateChanged: the state machine (lib/workflow/mission-workflow.ts)
 *     needs a generic event to publish on every transition, distinct from
 *     the domain-specific events an agent publishes when it finishes work.
 *   - DecisionLogged: so the Decision Memory layer
 *     (lib/services/decision-service.ts) flows through the same bus as
 *     everything else, instead of writing mission_events directly.
 *
 * None of MissionStarted/WebsiteScanned/SEOComplete/ProposalReady/
 * EmailDraftReady are published by any code yet — the agents that will
 * publish them (Research, SEO, Copywriter, Designer, QA, Proposal, Email,
 * Deployment) are Sprint 3+. Sprint 2 only needs the shape to exist and
 * compile.
 */
export type DomainEventType =
  | "MissionStarted"
  | "WebsiteScanned"
  | "SEOComplete"
  | "ProposalReady"
  | "EmailDraftReady"
  | "MissionApproved"
  | "MissionRejected"
  | "MissionArchived"
  | "StateChanged"
  | "DecisionLogged";

export interface MissionStartedPayload {
  businessName: string;
  websiteUrl: string;
}

export interface WebsiteScannedPayload {
  websiteUrl: string;
  findings?: Record<string, unknown>;
}

export interface SEOCompletePayload {
  score?: number;
  issues?: string[];
}

export interface ProposalReadyPayload {
  proposalId?: string;
  price?: number;
}

export interface EmailDraftReadyPayload {
  subject?: string;
  length?: number;
}

export interface MissionApprovedPayload {
  approvedBy: string;
}

export interface MissionRejectedPayload {
  reason?: string;
  rejectedBy?: string;
}

export interface MissionArchivedPayload {
  archivedBy?: string;
}

export interface StateChangedPayload {
  fromState: MissionState;
  toState: MissionState;
}

export interface DecisionLoggedPayload {
  decisionType: DecisionType;
}

/**
 * Fields every event carries at the top level regardless of type, since
 * they're needed for persistence (mission_events columns) and RLS
 * regardless of which domain event this is.
 */
interface DomainEventBase {
  missionId: string;
  organizationId: string;
}

export type DomainEvent = DomainEventBase &
  (
    | { type: "MissionStarted"; payload: MissionStartedPayload }
    | { type: "WebsiteScanned"; payload: WebsiteScannedPayload }
    | { type: "SEOComplete"; payload: SEOCompletePayload }
    | { type: "ProposalReady"; payload: ProposalReadyPayload }
    | { type: "EmailDraftReady"; payload: EmailDraftReadyPayload }
    | { type: "MissionApproved"; payload: MissionApprovedPayload }
    | { type: "MissionRejected"; payload: MissionRejectedPayload }
    | { type: "MissionArchived"; payload: MissionArchivedPayload }
    | { type: "StateChanged"; payload: StateChangedPayload }
    | { type: "DecisionLogged"; payload: DecisionLoggedPayload }
  );
