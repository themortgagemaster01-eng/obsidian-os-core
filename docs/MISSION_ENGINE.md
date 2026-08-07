# Obsidian OS — Mission Engine

**Status:** Living document. Describes the Mission Engine as it exists after Sprint 3 (commit `7a1ec8e`). This document must be updated whenever the Mission Engine's lifecycle, event catalog, or worker architecture changes — same documentation-first discipline as `docs/MASTER_BLUEPRINT.md` and `docs/ARCHITECTURE_DECISIONS.md`.

**How to read this document.** Every section below states plainly what is fully built, what is partially built, and what is pure specification with zero code behind it. Do not assume a described capability exists without checking the "Reality" line at the end of each section.

---

## 1. What the Mission Engine is

The Mission Engine is the subsystem that owns a mission's lifecycle end to end: creating it, moving it through pipeline states, recording everything that happens to it, and — eventually — driving it forward autonomously via agents. It is not a UI concern and not a database concern in isolation; it is the orchestration layer that sits between them (`lib/workflow/`, `lib/events/`, `lib/services/mission-service.ts`). Per `docs/ARCHITECTURE_DECISIONS.md` ADR-000, the Mission Engine exists to make the client-acquisition pipeline durable and trustworthy enough that a human can delegate labor to it without delegating judgment.

**Reality:** Fully built as a manual-trigger orchestration layer. Not yet built as an autonomous one — nothing currently moves a mission forward except a human or a direct API call.

---

## 2. Mission lifecycle

A mission is created at `discovered` and, in the primary sequence, advances one state at a time toward `archived`:

**discovered → analyzing → researching → designing → qa → proposal → email → approval → sent → archived**

Two non-sequential transitions exist as explicit escape hatches, not part of the default path: `rejected` is reachable from any non-terminal, non-`sent` state (rejection is a first-class outcome); `qa → designing` is an explicit revise loop. `archived` is fully terminal — nothing transitions out of it. `rejected` only ever transitions to `archived`. See `lib/workflow/mission-state.ts` for the full type and `docs/ARCHITECTURE_DECISIONS.md` ADR-005 for why this replaced Sprint 1's two-field `status`/`stage` design.

**Reality:** Fully built and enforced at the type level and at the database level (`CHECK` constraint on `missions.state`). `transitionMissionState()` (`lib/workflow/mission-workflow.ts`) is the single enforcement point — there is no second code path that can write an invalid transition.

---

## 3. State machine enforcement

`transitionMissionState()` is the only function permitted to change `missions.state`. It:

- Validates the target state is a real `MissionState`.
- Refuses any transition out of `archived` (hard invariant, not overridable).
- Refuses any transition out of `rejected` except to `archived` (hard invariant, not overridable).
- By default only allows the state machine's own "next state" or one of the two explicit non-sequential exceptions (reject, the QA revise loop); an explicit `{ allowNonSequential: true }` opt-in is required to override this for anything else (e.g. a future admin "skip state" action).
- Updates `state_changed_at` via a dedicated Postgres trigger (`supabase/migrations/0003_mission_state_machine.sql`), independent of the generic `updated_at` trigger, so "time in current state" can be queried directly without diffing timestamps.
- Publishes a `StateChanged` event through the Event Bus (§4) on every successful transition.

`rejectMission()` and `archiveMission()` are named, intention-revealing wrappers around `transitionMissionState()` that additionally publish `MissionRejected` / `MissionArchived` domain events.

**Reality (updated, Sprint 3):** Exercised by two real callers now. The "New Mission" flow calls `createMission()`, which sets the initial `discovered` state. `lib/services/analysis-service.ts::runAnalysis()` — Sprint 3's Analysis Engine — calls `transitionMissionState()` directly, advancing a mission from `discovered` to `analyzing` when analysis begins (guarded so a re-run on a mission already past `discovered` doesn't attempt a second, invalid transition). `rejectMission()` and `archiveMission()` still have no caller — nothing in the running application moves a mission to `rejected` or `archived` yet, and no code advances a mission past `analyzing` to `researching` or beyond. The gap has narrowed from "nothing calls the state machine" to "only the first of eleven states is reachable by real user action today."

---

## 4. Event Bus

`EventBus` (`lib/events/event-bus.ts`) is a port/adapter interface — `publish(event): Promise<void>` and `subscribe(handler): unsubscribe` — with one implementation, `SupabaseEventBus`, which does two things on every `publish()` call: persists the event as a row in `mission_events`, and synchronously fans it out, in-process, to any same-request subscribers.

The event catalog (`lib/events/types.ts`) is a fixed, typed, discriminated union of **11** event types (Sprint 3 added `AnalysisFailed` — see below): `MissionStarted`, `WebsiteScanned`, `SEOComplete`, `AnalysisFailed`, `ProposalReady`, `EmailDraftReady`, `MissionApproved`, `MissionRejected`, `MissionArchived`, `StateChanged`, `DecisionLogged`. This union is kept string-for-string in sync with the `mission_events.event_type` `CHECK` constraint (`supabase/migrations/0007_website_analysis.sql` added the `AnalysisFailed` constraint value) — adding an event type requires updating both.

**Reality, split honestly by event type (updated, Sprint 3):**
- **Fully built and actively published today:** `MissionStarted` (on mission creation), `StateChanged` (on every state transition), `MissionRejected`, `MissionArchived` — all four published by `lib/workflow/mission-workflow.ts`. **New this sprint:** `WebsiteScanned` and `SEOComplete` are now real, published by `lib/services/analysis-service.ts::runAnalysis()` on every completed analysis run, carrying genuine measured scores (mobile, accessibility, all four Lighthouse dimensions, technology stack, SEO issues) rather than placeholder payloads — the first two event types in the catalog to go from "defined" to "actually describes something that happened." `AnalysisFailed` (new type, not in the original 8-event brief) is published on any analysis pipeline failure, carrying the error message and, when known, which adapter failed.
- **Defined but still never published by anything:** `ProposalReady`, `EmailDraftReady`, `MissionApproved`, `DecisionLogged`. These exist as types with a matching database constraint value, ready for a future agent or an Approval Queue UI to publish them, but zero code in the repository publishes any of them today.
- **Durability:** unchanged from Sprint 2 — the in-process fan-out to subscribers is still explicitly non-durable, does not survive a process restart, and does not cross server instances. Sprint 3's analysis worker (§6) runs in-process rather than as a genuinely separate worker, so this limitation was not yet tested against a real cross-process consumer; it remains exactly the gap `docs/ARCHITECTURE_DECISIONS.md` ADR-006 flagged as needing a durable-transport upgrade before any agent depends on cross-process delivery.

---

## 5. Retry logic and failure handling

**Reality: none exists.** There is no retry policy, no dead-letter handling, no idempotency key, no at-least-once/exactly-once delivery guarantee, and no failure classification (transient vs. permanent) anywhere in the Mission Engine today. `EventBus.publish()` either succeeds or throws; a thrown error propagates straight to the caller (a Next.js Route Handler, today) with no automatic retry. This is a known, load-bearing gap: it is fine while the only publishers are synchronous request-handling code with a human waiting on the response, and it stops being fine the moment an autonomous background agent needs to publish an event without a human watching the request fail. Sprint 3's job runner is the first piece of work that must decide this, not defer it further — see §9.

---

## 6. Worker / job runner architecture

**Reality (updated, Sprint 3): a narrow, lightweight exception now exists; the general-purpose job runner still does not.** `POST /api/missions/:id/analyze` (`app/api/missions/[id]/analyze/route.ts`) creates the `website_analyses` row synchronously, returns `202 Accepted` immediately, and invokes `runAnalysis()` (`lib/services/analysis-service.ts`) as a fire-and-forget promise using a service-role Supabase client, deliberately not awaited by the route handler — see `docs/ARCHITECTURE_DECISIONS.md` ADR-012 for the decision record. This is real: it is the first piece of Mission Engine code that runs outside the request/response cycle a human is waiting on. It is explicitly **not** the job runner this section originally described as missing — there is still no job queue, no scheduler, no retry policy, no worker pool, no concept of a process independent of *some* triggering HTTP request, and no guarantee this in-process background promise survives a serverless platform freezing the function immediately after its response is sent (an open, unpriced risk — `docs/SPRINT_3_DESIGN_REVIEW.md` §15 risk #1). "Nightly pipeline work" (`docs/MASTER_BLUEPRINT.md` §2) still has nothing that schedules or executes it. This remains the most consequential piece of unbuilt infrastructure standing between the current codebase and any autonomous agent (Discovery, Research, Design, Proposal, Outreach) actually doing work unattended — Sprint 3 proved the narrowest possible workaround for one caller, not the general solution.

---

## 7. Mission queue

**Reality: does not exist as infrastructure**, but exists today as an implicit query: any mission sitting at a non-terminal state is, by definition, "queued" for whatever work happens next. `computeMissionControlStats()` (`lib/services/mission-service.ts`) reads this implicitly for the Mission Control dashboard's counters (Running / Completed Today / Waiting Approval), but there is no dedicated queue table, no priority ordering, no claim/lock mechanism to prevent two workers from picking up the same mission, and — because §6's worker doesn't exist — nothing to actually consume such a queue yet.

---

## 8. Approval flow

The database and event-catalog support for an approval flow are real: `missions.state` includes an `approval` state; the `decisions` table (`docs/ARCHITECTURE_DECISIONS.md` ADR-008, ADR-009) has an `approve` / `reject` / `not_a_fit` / edit-type vocabulary of 11 `decision_type` values purpose-built to capture what a human does at this gate; `MissionApproved` is a defined event type; `logDecision()` (`lib/services/decision-service.ts`) is a complete, correct function that would record such a decision and publish `DecisionLogged`.

**Reality: zero UI exists.** There is no Approval Queue screen. Nothing in the application ever calls `logDecision()`. A mission can theoretically be moved to `approval` via `transitionMissionState()`, but nothing surfaces it to a human for review, and no code path lets a human actually approve, reject, or edit it today. This is `docs/SPRINT_2_REVIEW.md`'s Sprint 3 recommendation, restated here as the Mission Engine's single highest-leverage missing piece: the schema and services are ready for this screen; the screen itself has not been built.

---

## 9. Logging

Every state transition and every domain event is durably logged to `mission_events` via the Event Bus (§4) — this is real, structured, queryable logging of everything the Mission Engine itself does. What does **not** exist: application-level error logging/observability (no Sentry-equivalent, no structured server logs beyond Next.js/Vercel defaults), and no logging at all for work that hasn't been built yet (agent execution, job runner activity) because that work doesn't exist. `actor` on `mission_events` defaults to the hardcoded string `'system'` for every event published today — no event yet distinguishes "a human did this" from "an agent did this," which will need to change before the Approval Queue (§8) can show a human-legible timeline.

---

## 10. Summary: what a Sprint 4+ agent actually needs from this engine

Any future agent (Discovery, Research, Design, Proposal, Outreach, Opportunity Scoring) integrates with the Mission Engine through exactly two surfaces, and should not need a third: call `transitionMissionState()` to move a mission forward, and call `EventBus.publish()` with a typed `DomainEvent` to record what it did. Both interfaces already exist and are stable, and Sprint 3's Analysis Engine is the first real, non-trivial exercise of both — proof they work under real load, not just in isolation.

**Updated, Sprint 3 close:** Sprint 3 built one instance of "an agent-shaped thing does real work and reports it" — the analysis pipeline runs outside the request a human is waiting on (§6), transitions mission state on its own (§2/§3), and publishes real, non-placeholder events (§4). What it did **not** do, and what still stands between this codebase and "an agent does real work unattended" being true in general, is exactly the same three things this section named after Sprint 2, now more precisely scoped by having one real example to measure against: **(1)** a general-purpose place for agent code to run outside a request — Sprint 3's fire-and-forget promise works for one caller triggered by one human action, but has no answer for an agent that should run on a schedule with nobody watching the request; **(2)** a retry/failure policy — Sprint 3's `AnalysisFailed` event and `status: 'failed'` row give honest failure *visibility*, but nothing retries automatically, at any layer; **(3)** a real queue — the implicit "any non-terminal mission is queued" model (§7) is unchanged, still with no priority ordering and no claim/lock mechanism to prevent two workers picking up the same mission, which matters the moment more than one worker process exists. Building the next agent without first deciding those three things for real (not per-caller) would still mean building on top of a gap, not a foundation — Sprint 3 made the gap smaller and better-understood, not closed.
