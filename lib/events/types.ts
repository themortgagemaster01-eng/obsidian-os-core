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
  | "DesignBriefReady"
  | "DesignBriefFailed"
  | "DesignBriefApproved"
  | "WebsiteDesignReady"
  | "WebsiteDesignFailed"
  | "DesignQaComplete"
  | "DesignQaFailed"
  | "PreviewScreenshotCaptured"
  | "PreviewScreenshotFailed"
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

/**
 * Sprint 4 Phase 2 (docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md §1, §2).
 * Published by lib/services/design-brief-service.ts when a mission's Design
 * Brief completes during the `researching` state, just before the mission
 * transitions to `designing`.
 */
export interface DesignBriefReadyPayload {
  industryBucket: string;
  /** How many Insights/Normalized Analysis findings the brief cites — mechanically confirms §12 AC1's non-empty-citation requirement actually held for this run. */
  citationCount: number;
}

export interface DesignBriefFailedPayload {
  errorMessage: string;
}

/**
 * Founder Architecture Spec v1.0, item 2: the Founder Approval Gate.
 * Published by lib/services/design-brief-service.ts::approveDesignBrief()
 * when a human approves (optionally with edits) a Design Brief sitting in
 * the `reviewing` state, immediately before the mission transitions to
 * `designing`.
 */
export interface DesignBriefApprovedPayload {
  approvedBy: string;
  /** True when the founder's approval action included edits to the brief, not just a pass-through approval. */
  wasEdited: boolean;
}

/**
 * Published by lib/services/design-generation-service.ts when the Wireframe
 * + Component Assembly passes complete during `designing`. Does not itself
 * advance the mission — only a future design-qa-service.ts (Phase 3) owns
 * the `designing -> qa` transition.
 */
export interface WebsiteDesignReadyPayload {
  sectionCount: number;
  layoutFamily: string;
  /** Real evidence conflicts (design-generation-service.ts's ContentWarning) kept off the rendered page this run — 0 when nothing conflicted. Surfaced here, not silently discarded, per the CTO Design Intelligence Remediation + Design Brain directive's "Evidence Conflict Handling": full detail is server-logged alongside this run, this count is what makes a conflict's existence visible to whoever reviews mission_events without needing log access. */
  contentWarningCount: number;
}

export interface WebsiteDesignFailedPayload {
  errorMessage: string;
}

/**
 * Sprint 4 Phase 4 (Design QA, docs/SPRINT_4_PHASE_4_DESIGN_REVIEW.md).
 * Published by lib/services/design-qa-service.ts when a QA run completes,
 * immediately before the mission transitions `designing -> qa` — the one
 * transition this service owns, mirroring how design-brief-service.ts owns
 * `researching -> reviewing` and `reviewing -> designing`.
 */
export interface DesignQaCompletePayload {
  overallVerdict: "PASS" | "FAIL" | "INCOMPLETE";
  renderedQaAvailable: boolean;
}

export interface DesignQaFailedPayload {
  errorMessage: string;
}

/**
 * Phase 4: a real screenshot of the LIVE, authenticated Design Preview route
 * was captured and uploaded to Supabase Storage (lib/services/preview-
 * capture-service.ts) — not a deployment (no such capability exists in this
 * codebase; see lib/workflow/mission-state.ts's own note on why `deployment`
 * was deliberately removed as a mission state). This is the same
 * "publishing a preview build is a sub-activity, tracked via events" pattern
 * that note names — it doesn't transition mission state.
 */
export interface PreviewScreenshotCapturedPayload {
  desktopPath: string;
  mobilePath: string;
}

export interface PreviewScreenshotFailedPayload {
  errorMessage: string;
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
    | { type: "DesignBriefReady"; payload: DesignBriefReadyPayload }
    | { type: "DesignBriefFailed"; payload: DesignBriefFailedPayload }
    | { type: "DesignBriefApproved"; payload: DesignBriefApprovedPayload }
    | { type: "WebsiteDesignReady"; payload: WebsiteDesignReadyPayload }
    | { type: "WebsiteDesignFailed"; payload: WebsiteDesignFailedPayload }
    | { type: "DesignQaComplete"; payload: DesignQaCompletePayload }
    | { type: "DesignQaFailed"; payload: DesignQaFailedPayload }
    | { type: "PreviewScreenshotCaptured"; payload: PreviewScreenshotCapturedPayload }
    | { type: "PreviewScreenshotFailed"; payload: PreviewScreenshotFailedPayload }
    | { type: "ProposalReady"; payload: ProposalReadyPayload }
    | { type: "EmailDraftReady"; payload: EmailDraftReadyPayload }
    | { type: "MissionApproved"; payload: MissionApprovedPayload }
    | { type: "MissionRejected"; payload: MissionRejectedPayload }
    | { type: "MissionArchived"; payload: MissionArchivedPayload }
    | { type: "StateChanged"; payload: StateChangedPayload }
    | { type: "DecisionLogged"; payload: DecisionLoggedPayload }
  );
