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
 * Sprint 3 (docs/SPRINT_3_DESIGN_REVIEW.md §11) is the first real publisher
 * of WebsiteScanned and SEOComplete — both payload interfaces below are
 * expanded here to carry this sprint's actual normalized analysis data,
 * consistent with ADR-010's precedent of reconciling with existing
 * vocabulary before adding new concepts. AnalysisFailed is the one
 * genuinely new event type Sprint 3 adds (see
 * supabase/migrations/0007_website_analysis.sql for the matching CHECK
 * constraint update). ProposalReady/EmailDraftReady remain unpublished
 * until Sprint 5/6.
 */
export type DomainEventType =
  | "MissionStarted"
  | "WebsiteScanned"
  | "SEOComplete"
  | "AnalysisFailed"
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

/**
 * Published by lib/services/analysis-service.ts (§1, §11) when the full
 * analysis pipeline completes for a mission. Carries the Normalized
 * Analysis scores (§3.2) for every dimension except SEO, which gets its
 * own SEOComplete event below — the split existed before Sprint 3 and is
 * kept rather than collapsed, since SEOComplete already had an independent
 * meaning in the original event catalog.
 */
export interface WebsiteScannedPayload {
  websiteUrl: string;
  mobileScore?: number;
  accessibilityScore?: number;
  lighthousePerformance?: number;
  lighthouseAccessibility?: number;
  lighthouseBestPractices?: number;
  lighthouseSeo?: number;
  technologyStack?: string[];
  findings?: Record<string, unknown>;
}

export interface SEOCompletePayload {
  score?: number;
  issues?: string[];
}

/**
 * New in Sprint 3 (§11, §15 risk #2). Published when any adapter in
 * analysis-service.ts's pipeline throws — the mission stays at
 * `analyzing` (§12) rather than advancing, and this event is the failure
 * signal the UI's Failed state (§6) and a future retry mechanism read.
 */
export interface AnalysisFailedPayload {
  errorMessage: string;
  /** Which adapter failed, when known — e.g. "lighthouse-adapter". */
  stage?: string;
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
    | { type: "AnalysisFailed"; payload: AnalysisFailedPayload }
    | { type: "ProposalReady"; payload: ProposalReadyPayload }
    | { type: "EmailDraftReady"; payload: EmailDraftReadyPayload }
    | { type: "MissionApproved"; payload: MissionApprovedPayload }
    | { type: "MissionRejected"; payload: MissionRejectedPayload }
    | { type: "MissionArchived"; payload: MissionArchivedPayload }
    | { type: "StateChanged"; payload: StateChangedPayload }
    | { type: "DecisionLogged"; payload: DecisionLoggedPayload }
  );
