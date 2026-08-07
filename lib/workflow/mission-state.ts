/**
 * The Mission pipeline, Sprint 2+: a single canonical `state` field replaces
 * Sprint 1's overlapping `status` + `stage` columns (see
 * supabase/migrations/0003_mission_state_machine.sql for the backfill logic
 * that migrated existing rows). `state` is the sole source of truth for a
 * mission's lifecycle position — nothing else tracks it.
 *
 * Primary linear sequence:
 *   discovered -> analyzing -> researching -> reviewing -> designing -> qa
 *   -> proposal -> email -> approval -> sent -> archived
 *
 * `reviewing` (Founder Architecture Spec v1.0, supabase/migrations/
 * 0011_founder_approval_gate.sql): the Founder Approval Gate between the
 * Design Brief and Generation Engine steps — a mission sits here once
 * design-brief-service.ts finishes until a human calls approveDesignBrief()
 * (lib/services/design-brief-service.ts), which is the only thing that can
 * move it into `designing`. Distinct from the `approval` state later in
 * this sequence, which gates the founder's review of the finished
 * proposal/email before sending, not the Design Brief.
 *
 * Non-sequential transitions, both explicit escape hatches rather than part
 * of the default forward path:
 *   - `rejected` is reachable from ANY non-terminal state (discovered
 *     through approval) — rejection is a first-class outcome, not a flavor
 *     of archiving. From `rejected`, the only further move is -> archived
 *     (housekeeping cleanup); nothing else.
 *   - `qa` -> `designing` is an explicit "revise" loop (e.g. QA fails and
 *     the design needs another pass).
 *
 * `archived` is fully terminal: no transitions out of it at all.
 *
 * Note on `deployment`: Sprint 1 had a standalone `deployment` stage.
 * Sprint 2 deliberately does NOT carry that forward as a top-level state —
 * publishing a preview build is a sub-activity of QA/design review, tracked
 * via events (e.g. WebsiteScanned) rather than a pipeline gate. See the
 * 0003 migration's backfill CASE expression, which folds the old
 * `deployment` stage into `qa`.
 */
export type MissionState =
  | "discovered"
  | "analyzing"
  | "researching"
  | "reviewing"
  | "designing"
  | "qa"
  | "proposal"
  | "email"
  | "approval"
  | "sent"
  | "archived"
  | "rejected";

/**
 * Canonical ordered list of the primary linear sequence. `rejected` is
 * intentionally excluded — it's a side-transition reachable from any
 * non-terminal state, not a position in the sequence.
 */
export const MISSION_STATE_SEQUENCE: readonly MissionState[] = [
  "discovered",
  "analyzing",
  "researching",
  "reviewing",
  "designing",
  "qa",
  "proposal",
  "email",
  "approval",
  "sent",
  "archived",
] as const;

/** Every valid state, including `rejected` — used by the isMissionState() guard. */
const ALL_MISSION_STATES: readonly MissionState[] = [
  ...MISSION_STATE_SEQUENCE,
  "rejected",
];

/** Human-readable display names for each state, for UI rendering. */
export const STATE_LABELS: Record<MissionState, string> = {
  discovered: "Discovered",
  analyzing: "Analyzing",
  researching: "Researching",
  reviewing: "Reviewing",
  designing: "Designing",
  qa: "QA",
  proposal: "Proposal",
  email: "Email",
  approval: "Approval",
  sent: "Sent",
  archived: "Archived",
  rejected: "Rejected",
};

/**
 * Maps each state to the state that follows it in the primary linear
 * sequence, or `null` for a state with no default forward move
 * (`archived`, the sequence's terminus, and `rejected`, which only ever
 * moves to `archived` via the dedicated archiveMission() entry point, not
 * a "default next state"). This supports auto-advancement without
 * hardcoding pipeline order in multiple places.
 */
export const NEXT_STATE: Record<MissionState, MissionState | null> = {
  discovered: "analyzing",
  analyzing: "researching",
  researching: "reviewing",
  reviewing: "designing",
  designing: "qa",
  qa: "proposal",
  proposal: "email",
  email: "approval",
  approval: "sent",
  sent: "archived",
  archived: null,
  rejected: null,
};

/** Type guard: is `value` a valid MissionState? */
export function isMissionState(value: string): value is MissionState {
  return (ALL_MISSION_STATES as readonly string[]).includes(value);
}

/** `archived` is the only fully terminal state — no transitions out of it at all. */
export function isTerminalState(state: MissionState): boolean {
  return state === "archived";
}

/**
 * `rejected` is reachable as an explicit side-transition from any
 * non-terminal state. `sent` is excluded even though it isn't `archived`
 * or `rejected` itself, because it's the successful end of the primary
 * sequence — rejecting a mission that already shipped isn't a meaningful
 * product action, only archiving it is.
 */
export function canReject(state: MissionState): boolean {
  return state !== "archived" && state !== "rejected" && state !== "sent";
}

/** Every state except `archived` itself can move to `archived` (housekeeping cleanup). */
export function canArchive(state: MissionState): boolean {
  return state !== "archived";
}
