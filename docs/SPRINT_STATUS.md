# Sprint Status

For the full architectural picture, see `docs/MASTER_BLUEPRINT.md`. For the reasoning behind each decision below, see `docs/ARCHITECTURE_DECISIONS.md`.

---

## Sprint 1 — Foundation — done

See git history (`9b989ed`) for the full commit. Summary retained below for continuity.

**Project scaffold:** Next.js 14 App Router + TypeScript strict mode, Tailwind CSS, hand-written shadcn/ui primitives (`components/ui/*`) on Radix. Dark-only design system (`tailwind.config.ts`, `app/globals.css`). `.env.example` with every Sprint 1 and future-sprint env var placeholder.

**Supabase integration:** typed browser/server clients, session-refresh middleware, hand-written `Database` type, `supabase/migrations/0001_init.sql` (`profiles`, `missions`, `mission_events`, owner-scoped RLS).

**Mission workflow engine (Sprint 1 shape, since replaced):** `MissionStage`/`MissionStatus` two-field model, `transitionMissionStage()`.

**Data-access + service layers, Auth, Mission Control dashboard, `POST /api/missions`:** all as originally documented — see git history for exact detail if needed; superseded by Sprint 2 in every place the schema changed.

**Known gaps at the end of Sprint 1:** no tests, no background process driving `transitionMissionStage()`, no Storage usage, no rate limiting on `POST /api/missions`, minimal error UI, no mission timeline UI.

---

## Sprint 2 — Mission State Machine + Multi-Tenancy + Event Bus + Decision Intelligence + Memory Vault — done

Commit `0a3a5f0`, on top of `9b989ed`.

### What was actually built

**Mission state machine unification** (`supabase/migrations/0003_mission_state_machine.sql`, `lib/workflow/mission-state.ts`, `lib/workflow/mission-workflow.ts`) — Collapsed the Sprint 1 `status` + `stage` two-field design into one canonical `state` text column with an 11-value CHECK constraint (`discovered, analyzing, researching, designing, qa, proposal, email, approval, sent, archived, rejected`), plus a `state_changed_at` timestamp maintained by its own trigger (`set_mission_state_changed_at`), independent of `updated_at`. Full documented backfill logic mapping every old `status`/`stage` combination to a new state (see `docs/06-Database.md` and ADR-005 for the exact mapping, including the non-obvious SEO/Performance/Deployment → `qa` folding). `lib/workflow/mission-workflow.ts` was rewritten around the new field: `createMission()`, `transitionMissionState()` (validates sequential transitions plus three explicit non-sequential exceptions: the `qa → designing` revise loop, rejection from most non-terminal states, and `rejected → archived`), `rejectMission()`, `archiveMission()`.

**Multi-tenancy groundwork** (`supabase/migrations/0002_organizations.sql`) — New `organizations` and `organization_members` tables, `is_org_member()`/`is_org_admin()` `security definer` RLS helper functions, an auto-provisioned personal organization on every signup via a rewritten `handle_new_user()` trigger, `profiles.default_organization_id`, and RLS rewritten across `missions`, `mission_events`, `decisions`, and `companies` to the `is_org_member(organization_id)` pattern instead of Sprint 1's direct `owner_id = auth.uid()` checks.

**Typed event bus** (`lib/events/types.ts`, `lib/events/event-bus.ts`, `supabase/migrations/0004_event_bus.sql`) — A `DomainEvent` discriminated union with a 10-type catalog (`MissionStarted`, `WebsiteScanned`, `SEOComplete`, `ProposalReady`, `EmailDraftReady`, `MissionApproved`, `MissionRejected`, `MissionArchived`, `StateChanged`, `DecisionLogged`), an `EventBus` port interface with `SupabaseEventBus` as its one current implementation (persists to `mission_events`, fans out in-process to same-request subscribers). `mission_events` gained an `actor` column and a denormalized `organization_id`. The workflow engine now publishes every event through this bus (`deps.eventBus.publish(...)`) instead of the Sprint 1 pattern of inserting `mission_events` rows directly.

**Decision Intelligence layer** (`supabase/migrations/0005_decisions.sql`, `lib/repositories/decision-repository.ts`, `lib/services/decision-service.ts`) — New `decisions` table (11 `decision_type` values, `ai_recommendation`/`user_action` free text, `before_value`/`after_value`/`metadata` as flexible `jsonb`, plus named columns for the highest-value expected signals: `opportunity_score`, `website_score`, `proposal_price`, `industry`, etc.) and a typed `logDecision()` service that writes a decision row and publishes a `DecisionLogged` event. Architecture and plumbing only — no ML, no scoring logic, and (see below) no caller yet.

**Memory Vault** (`supabase/migrations/0006_memory_vault.sql`, `lib/repositories/company-repository.ts`, `lib/services/company-service.ts`) — New `companies` table, the anchor of the future CRM: one row per unique (organization, normalized website URL), tracking `total_missions_count`, `last_mission_id`, proposal/contact history fields, a `do_not_contact` compliance flag, and freeform `design_preferences jsonb`. `findOrCreateCompany()` is genuinely wired into `mission-workflow.ts::createMission()` — every mission created from this sprint forward links to (or creates) a company record and bumps its mission count, so the table starts accumulating real data immediately rather than shipping empty.

**UI updates** (`components/mission-control/state-badge.tsx`, `mission-list.tsx`, `lib/services/mission-service.ts::computeMissionControlStats()`) — Renamed/updated to read the new `state` field instead of the old `status`/`stage` pair. Fixed a real Sprint 1 correctness bug in the process: "Completed Today" now uses `state_changed_at` (only updated when `state` itself changes) instead of `updated_at` (which could change for unrelated reasons).

**Documentation** (this sprint's deliverable) — `docs/MASTER_BLUEPRINT.md`, the numbered `docs/00`–`11` deep-dives, `docs/ARCHITECTURE_DECISIONS.md`, this file, and `docs/VISION.md` converted to a pointer at `docs/01-Product-Vision.md`.

### Known gaps / TODOs carried forward

- **Still zero automated tests.** Flagged after Sprint 1, still true after Sprint 2. `lib/workflow/mission-workflow.ts::transitionMissionState()` remains the highest-value first target (see `docs/10-Development-Standards.md`).
- **No background process drives a mission forward.** A mission created today sits at `discovered` permanently. This is Sprint 3's core blocker — see below.
- **No agent calls Anthropic or OpenAI.** Both keys are in `.env.example`; zero code uses either SDK.
- **No Approval Queue UI**, so `logDecision()` has no real caller yet despite being fully built.
- **No mission-timeline UI**, so `mission_events` (and the new `actor` column) has no UI consumer beyond being written to.
- **No architectural-boundary lint rule** enforcing the layering described in `docs/03-Software-Architecture.md` — still convention-only.
- Still no rate limiting on `POST /api/missions`, and no accessibility audit has been performed (`docs/09-UI-Design-System.md`).

---

## Sprint 3 (next) — the first real AI agents

**Scope: Discovery Engine, Opportunity Scoring, and Research Engine** — the first agents that make Sprint 2's event bus carry real work instead of an unused catalog. Concretely, these agents must call `eventBus.publish()` with genuinely populated `WebsiteScanned`/`SEOComplete`-shaped (or newly typed) payloads produced by real analysis, not the current state where those payload interfaces exist in `lib/events/types.ts` with nothing constructing them.

**What Sprint 3 gets for free from Sprint 2:**
- The **state machine** — `transitionMissionState()` already has the full, correct transition-validation logic; agents call it, they don't reimplement it.
- The **event bus** — agents get mission-timeline persistence and (same-request) fan-out for free by calling `publish()`.
- The **`companies` table** — any mission a Discovery Agent creates automatically gets Memory Vault linkage through the already-wired `findOrCreateCompany()`.
- **Org-scoped RLS** — already correct for every table these agents will read/write, assuming they run with an appropriately-scoped client.

**What Sprint 3 must build net-new (none of this exists today):**
1. **A job runner / scheduler.** Nothing currently drives a mission past `discovered`. Sprint 3 needs a real trigger mechanism (cron-triggered Route Handler, Supabase scheduled function, or a proper job/queue system) before "nightly pipeline" is anything but aspirational. This is also the natural point to replace the event bus's non-durable in-process fan-out (explicitly documented as inadequate for cross-process consumers in `event-bus.ts`) with something durable.
2. **Real Anthropic API wiring.** An actual SDK integration, prompt construction, and response parsing into the typed event payloads that already exist as interfaces.
3. **Actual scraping/analysis logic.** Website scraping/scoring, competitor lookup, and review mining — none of this exists in even stub form today.
4. **New event types + a migration.** At minimum, something for "company discovered" and "opportunity scored" — no such event type exists in the Sprint 2 catalog, so `lib/events/types.ts` and `mission_events.event_type`'s CHECK constraint both need updates before these agents can publish typed, constraint-valid events for their own output.

See `docs/04-AI-Systems.md` and `docs/11-Product-Roadmap.md` for the full agent-by-agent contract and the broader roadmap beyond Sprint 3.
