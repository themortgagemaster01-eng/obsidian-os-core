# 03 — Software Architecture

## The layering rule

Business logic never lives inside React components or route handlers. The dependency direction is strictly one-way:

```
app/, components/  →  lib/services  →  lib/repositories, lib/workflow, lib/events  →  lib/supabase
```

- **`app/` and `components/`** are presentation only. Server components fetch data by calling `lib/services` functions and render it; client components call API routes and render responses. Neither layer imports Supabase clients directly or contains conditional business logic beyond pure UI concerns (loading/error/empty states). Example: `app/page.tsx` calls `computeMissionControlStats(missions)` and `listMissionsForOrganization(supabase, organizationId)` — it never calls `supabase.from("missions")` itself.
- **`lib/services`** is where business logic and orchestration live: `mission-service.ts` (mission CRUD orchestration + stats computation), `company-service.ts` (Memory Vault find-or-create + URL normalization), `decision-service.ts` (Decision Intelligence write path). Services are the only layer allowed to combine multiple repositories or coordinate a repository with the workflow engine or event bus.
- **`lib/repositories`** is a thin, mechanical data-access layer, one file per table: `mission-repository.ts`, `company-repository.ts`, `decision-repository.ts`, `mission-event-repository.ts`, `profile-repository.ts`. Every function takes a typed Supabase client plus arguments and returns a typed row or array of rows. **No business rules belong here** — no conditional logic beyond error handling, no cross-table joins beyond what a single query naturally does, no validation beyond what the type system already enforces.
- **`lib/workflow`** is the mission state machine. `mission-state.ts` is pure data/types: the `MissionState` union, `MISSION_STATE_SEQUENCE`, `STATE_LABELS`, `NEXT_STATE`, and the guard functions `isMissionState`, `isTerminalState`, `canReject`, `canArchive` — no I/O, no imports beyond types. `mission-workflow.ts` is the engine: `createMission()`, `transitionMissionState()`, `rejectMission()`, `archiveMission()`, all taking an explicit `MissionWorkflowDeps` object (`{ client, missionRepository, companyRepository, eventBus }`) rather than importing a client or repository as a module-level singleton. This dependency-injection shape is what makes the engine unit-testable in isolation — a test can construct fake repositories and a fake event bus and assert on transition behavior without touching a real database.
- **`lib/events`** is the event bus. `types.ts` is the pure `DomainEvent` catalog (types and payload shapes, no behavior). `event-bus.ts` defines the `EventBus` interface (the port) and `SupabaseEventBus` (the current adapter, persisting to `mission_events` and fanning out in-process to subscribers).
- **`lib/supabase`** is the bottom layer: typed client factories (`client.ts` for the browser, `server.ts` for Server Components/Route Handlers, `middleware.ts` for session refresh) and the hand-written `database.types.ts` mirroring the live schema.

## Why dependency injection, not singletons

Every service and the workflow engine takes its dependencies as an explicit argument (`createMissionWorkflowDeps(client)`, `createCompanyServiceDeps(client)`, `createDecisionServiceDeps(client)`) rather than importing a shared client instance. This has two concrete payoffs already visible in the codebase: (1) the same engine works identically whether it's invoked from a Server Component's server-side client or, in the future, a background worker's service-role client — nothing in `mission-workflow.ts` assumes which; (2) it makes the highest-value future unit test (`transitionMissionState`'s branching logic — see `docs/10-Development-Standards.md`) possible without any database at all.

## The independent-subsystems model

The product's intended shape, once more agents exist, is a set of subsystems that communicate only through the Mission Engine (the state machine) and the event bus — never by calling into each other's internals directly:

**Mission Engine** (`lib/workflow/`, built) ↔ **Discovery Engine** (Sprint 3) ↔ **Research Engine** (Sprint 3: Opportunity Scoring, Competitor Analysis, Review Analysis) ↔ **Design Engine** (Copywriter + Designer, later) ↔ **Proposal Engine** (later) ↔ **Outreach Engine** (Email + Deployment, later) ↔ **CRM** (`companies` table exists, no UI) ↔ **Analytics** (not started) ↔ **Approval Queue** (not started, will be the primary caller of `logDecision()`) ↔ **Mission Control** (`app/page.tsx`, built).

The event bus's port/adapter design (`EventBus` interface with the `SupabaseEventBus` implementation) exists specifically to make this true in practice, not just in theory: an agent publishes a `WebsiteScanned` event without knowing or caring what (if anything) is listening. Today nothing listens beyond the same-request in-process fan-out (see the `SupabaseEventBus` doc comment in `event-bus.ts`, and the ADR log entry on this decision) — but the seam is real, and Sprint 3's agents are expected to plug into it rather than call Supabase directly.

## Folder structure (as of Sprint 2)

```
app/
  page.tsx                        — Mission Control (server component)
  login/page.tsx                  — auth screen
  auth/callback/route.ts          — OAuth/magic-link code exchange
  api/missions/route.ts           — POST /api/missions
  layout.tsx, globals.css
components/
  mission-control/                — mission-list, new-mission-dialog, stat-card, state-badge, sign-out-button
  ui/                              — hand-rolled shadcn/ui primitives on Radix
lib/
  supabase/                       — client.ts, server.ts, middleware.ts, database.types.ts
  repositories/                   — mission, company, decision, mission-event, profile
  services/                       — mission-service, company-service, decision-service
  workflow/                       — mission-state.ts, mission-workflow.ts
  events/                         — types.ts, event-bus.ts
  utils.ts
supabase/migrations/              — 0001_init.sql … 0006_memory_vault.sql
middleware.ts                     — root route-protection middleware
```

## Dependency rules, explicit

- `lib/repositories/*` may import from `lib/supabase` only (plus types). It must never import from `lib/services`, `lib/workflow`, or `lib/events`.
- `lib/workflow/mission-state.ts` imports nothing but its own types — it has zero I/O dependencies by design.
- `lib/workflow/mission-workflow.ts` may import repositories, `lib/events`, and `lib/supabase` types, but never `lib/services` (services depend on the workflow engine, not the reverse) and never anything from `app/` or `components/`.
- `lib/events/types.ts` may import `lib/workflow` types (for `MissionState` in `StateChangedPayload`) and `lib/repositories` types (for `DecisionType` in `DecisionLoggedPayload`) — these are type-only imports, not runtime dependencies, and this is the one place a cross-cutting type is shared rather than duplicated.
- `lib/services/*` may import repositories, `lib/workflow`, and `lib/events`. Nothing above `lib/services` (i.e. nothing in `app/` or `components/`) should import a repository or the workflow engine directly.
- `app/` and `components/` may import `lib/services` and UI-only helpers (`lib/utils.ts`, `lib/supabase/client.ts` or `server.ts` for the client instance itself, since services need a client passed in). They must not import `lib/repositories` or `lib/workflow` directly.

Violating any of these should be treated as an architecture bug worth fixing in the same PR that introduces it, not a deferred cleanup item.
