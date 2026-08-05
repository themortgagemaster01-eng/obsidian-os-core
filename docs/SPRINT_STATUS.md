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

## Sprint 2 — Mission State Machine + Multi-Tenancy + Event Bus + Decision Memory + Memory Vault — done, reviewed, merged

Commit `0a3a5f0`, on top of `9b989ed`. Went through the Architecture Review Gate (`docs/SPRINT_2_REVIEW.md`) and was approved for customer-facing development to begin. Post-review, before merge: added `docs/MISSION_ENGINE.md` (canonical Mission Engine spec), ADR-000 (Product Philosophy) in `docs/ARCHITECTURE_DECISIONS.md`, an "Architecture Principles" section in `docs/MASTER_BLUEPRINT.md` §1, and renamed "Decision Intelligence" to "Decision Memory" throughout docs and code comments (conceptual/naming only — the `decisions` table and schema are unchanged).

### What was actually built

**Mission state machine unification** (`supabase/migrations/0003_mission_state_machine.sql`, `lib/workflow/mission-state.ts`, `lib/workflow/mission-workflow.ts`) — Collapsed the Sprint 1 `status` + `stage` two-field design into one canonical `state` text column with an 11-value CHECK constraint (`discovered, analyzing, researching, designing, qa, proposal, email, approval, sent, archived, rejected`), plus a `state_changed_at` timestamp maintained by its own trigger (`set_mission_state_changed_at`), independent of `updated_at`. Full documented backfill logic mapping every old `status`/`stage` combination to a new state (see `docs/06-Database.md` and ADR-005 for the exact mapping, including the non-obvious SEO/Performance/Deployment → `qa` folding). `lib/workflow/mission-workflow.ts` was rewritten around the new field: `createMission()`, `transitionMissionState()` (validates sequential transitions plus three explicit non-sequential exceptions: the `qa → designing` revise loop, rejection from most non-terminal states, and `rejected → archived`), `rejectMission()`, `archiveMission()`.

**Multi-tenancy groundwork** (`supabase/migrations/0002_organizations.sql`) — New `organizations` and `organization_members` tables, `is_org_member()`/`is_org_admin()` `security definer` RLS helper functions, an auto-provisioned personal organization on every signup via a rewritten `handle_new_user()` trigger, `profiles.default_organization_id`, and RLS rewritten across `missions`, `mission_events`, `decisions`, and `companies` to the `is_org_member(organization_id)` pattern instead of Sprint 1's direct `owner_id = auth.uid()` checks.

**Typed event bus** (`lib/events/types.ts`, `lib/events/event-bus.ts`, `supabase/migrations/0004_event_bus.sql`) — A `DomainEvent` discriminated union with a 10-type catalog (`MissionStarted`, `WebsiteScanned`, `SEOComplete`, `ProposalReady`, `EmailDraftReady`, `MissionApproved`, `MissionRejected`, `MissionArchived`, `StateChanged`, `DecisionLogged`), an `EventBus` port interface with `SupabaseEventBus` as its one current implementation (persists to `mission_events`, fans out in-process to same-request subscribers). `mission_events` gained an `actor` column and a denormalized `organization_id`. The workflow engine now publishes every event through this bus (`deps.eventBus.publish(...)`) instead of the Sprint 1 pattern of inserting `mission_events` rows directly.

**Decision Memory layer** (`supabase/migrations/0005_decisions.sql`, `lib/repositories/decision-repository.ts`, `lib/services/decision-service.ts`) — New `decisions` table (11 `decision_type` values, `ai_recommendation`/`user_action` free text, `before_value`/`after_value`/`metadata` as flexible `jsonb`, plus named columns for the highest-value expected signals: `opportunity_score`, `website_score`, `proposal_price`, `industry`, etc.) and a typed `logDecision()` service that writes a decision row and publishes a `DecisionLogged` event. Architecture and plumbing only — no ML, no scoring logic, and (see below) no caller yet.

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

## Sprint 3 (next) — Business URL Analysis

**Scope, per the Founder Directive issued after the Sprint 2 Architecture Review Gate: the first customer-facing, demoable feature.** A user pastes a business URL; the system performs a website crawl, mobile analysis, SEO analysis, accessibility analysis, Lighthouse analysis, technology detection, opportunity scoring, and screenshot capture, and produces a "Premium Opportunity Report" — a polished report that could be shown to a customer. Scoped to exactly this. Website generation (Sprint 4+) and outreach are explicitly out of scope — do not build ahead into them.

Per the Founder Directive's standing guardrails, restated in `docs/MASTER_BLUEPRINT.md` §1's Architecture Principles: no infrastructure-only sprint should exist unless absolutely necessary, every feature should satisfy at least one of delivers customer value / removes meaningful technical debt / improves customer experience, and progress is measured against proximity to a first paying customer.

**What Sprint 3 gets for free from Sprint 2** (see `docs/MISSION_ENGINE.md` for the full accounting of what's built vs. stubbed):
- The **state machine** — `transitionMissionState()` already has full, correct transition-validation logic; the analysis pipeline calls it, it doesn't reimplement it.
- The **event bus** — mission-timeline persistence and (same-request) fan-out for free via `publish()`.
- The **`companies` table** — analysis triggered against a mission automatically gets Memory Vault linkage through the already-wired `findOrCreateCompany()`.
- **Org-scoped RLS** — already correct for every table this feature will read/write.

**What Sprint 3 must build net-new:**
1. **The analysis pipeline itself** — crawl, mobile analysis, SEO analysis, accessibility analysis, Lighthouse analysis, technology detection, opportunity scoring, and screenshot capture. None of this exists in even stub form today.
2. **New event types + a migration** for analysis results (at minimum something crawl/analysis-complete-shaped) — no such event type exists in the Sprint 2 catalog yet.
3. **A "Premium Opportunity Report" view** — the first real customer-facing UI surface beyond Mission Control itself.
4. **Somewhere for the analysis to run** that isn't blocking a page load for the full duration of a multi-step crawl/analysis — `docs/MISSION_ENGINE.md` §6 flags that no job runner exists yet; Sprint 3 needs at minimum a decision on how a multi-step analysis runs without a human staring at a spinner, even if it's a lightweight solution rather than the full job-runner infrastructure originally scoped for a later sprint.

**Design-review checkpoint:** per standing process, a design review precedes implementation for customer-facing sprints — architecture, database/API changes, the report UI, Mission Engine integration points, acceptance criteria, risks, and open questions get written down and reviewed before code is written. See `docs/11-Product-Roadmap.md` for the broader roadmap beyond Sprint 3.
