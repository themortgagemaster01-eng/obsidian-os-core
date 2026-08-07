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

## Sprint 3 — Business URL Analysis (Opportunity Report) — done, reviewed, merged

Commits `f3fe479`..`7a1ec8e`, on top of `0a3a5f0`. Went through a design review before code (`docs/SPRINT_3_DESIGN_REVIEW.md`), per-phase reviews as it was built (`docs/SPRINT_3_PHASE_2_REPORT.md`, `docs/SPRINT_3_PHASE_3_VALIDATION_REPORT.md`), and a consolidated closure review (`docs/SPRINT_3_REVIEW.md`) approved by the founder — CTO score 9.0/10, recommendation Ship. Tagged `v0.4.0-alpha`. Full retrospective: `docs/SPRINT_3_RETROSPECTIVE.md`.

**Scope, per the Founder Directive issued after the Sprint 2 Architecture Review Gate: the first customer-facing, demoable feature.** A user pastes a business URL; the system performs a website crawl, mobile analysis, SEO analysis, accessibility analysis, Lighthouse analysis, technology detection, opportunity scoring, and screenshot capture, and produces a "Premium Opportunity Report" — a polished report that could be shown to a customer. Website generation, proposals, and outreach were explicitly out of scope and were not built ahead into.

### What was actually built

**The Analysis Engine, split into four single-responsibility services** (`docs/ARCHITECTURE_DECISIONS.md` ADR-011) — `lib/adapters/*` (seven I/O-only adapters: crawl, mobile, SEO, accessibility, Lighthouse, tech detection, screenshot) → `lib/services/analysis-service.ts` (orchestrates adapters, normalizes vendor-shaped output to a consistent per-dimension shape, persists to the new `website_analyses` table, `supabase/migrations/0007_website_analysis.sql`) → `lib/services/insight-service.ts` (Normalized Analysis translated into plain-language, evidence-tagged business observations) → `lib/services/opportunity-scoring-service.ts` (single 0–100 Opportunity Score, equal 20% weighting across five categories — explicitly disclosed as a placeholder needing a real founder decision, not a finished formula) → `lib/services/opportunity-report-service.ts` (assembles the customer-presentable `OpportunityReport` object the UI renders).

**Asynchronous execution, mandatory** (ADR-012) — `POST /api/missions/:id/analyze` creates the `website_analyses` row and returns `202 Accepted` immediately; the actual seven-adapter run is invoked as an un-awaited background promise using a service-role client. This is the first real, working exception to "nothing runs outside a request" (`docs/MISSION_ENGINE.md` §6) — explicitly a lightweight v1 workaround for one caller, not the general-purpose job runner still flagged as unbuilt.

**Mission Engine exercised for real, for the first time** — `analysis-service.ts` is the second-ever caller of `transitionMissionState()` (advancing `discovered → analyzing`) and the first real publisher of `WebsiteScanned`/`SEOComplete` with genuine measured payloads instead of placeholder types; `AnalysisFailed` was added as a new event type for the failure path. `docs/MISSION_ENGINE.md` has been updated throughout to reflect this — see that document for the full, section-by-section reality check.

**Evidence-first report architecture, enforced not just described** (ADR-013) — every report claim traces to a specific measurement; every section carries a mandatory confidence rating (High/Medium/Low/Unavailable) computed from whether its underlying check actually succeeded; a banned-terms automated test fails the suite if any adapter/vendor name or raw technical jargon leaks into customer-facing text. This is what turned three real production defects (below) into honest "Unavailable confidence" sections instead of silent data corruption or fabricated scores.

**Presentation layer** (`app/missions/[id]/page.tsx`, `GET /api/missions/:id/analysis`) — the first customer-facing UI surface beyond Mission Control itself, rendering the assembled report in the exact section order specified in the design doc, with inline confidence metadata and signed-URL screenshot rendering.

**Real end-to-end validation, not synthetic** — the full pipeline was run against two independent, live, unaffiliated business websites (`katzsdelicatessen.com`, `veslofamilyrestaurant.com`) through the actual product flow. This surfaced and led to fixing five real defects: a New Mission URL field that rejected any URL with a protocol (its own placeholder's format); login silently failing against a bare local Postgres instance for missing table grants; a Lighthouse adapter that was ESM-incompatible with the app's bundler at runtime; an axe-core adapter broken by webpack bundling; and a Windows-specific `chrome-launcher` cleanup race that could crash an entire analysis run over a temp-directory delete. All five are fixed and re-verified; full detail in `docs/TECH_DEBT.md`.

### Known gaps / TODOs carried forward

- **Category weighting is an unresolved founder decision, not an engineering task.** Equal 20% weighting ships in every report today with no analytical basis behind it — flagged in `docs/SPRINT_3_REVIEW.md` as the one item that should not be allowed to quietly become "how it's always worked" by default.
- **The general-purpose job runner still does not exist.** Sprint 3's fire-and-forget worker proves the pattern for one caller triggered by one human action; it has no answer for a scheduled agent or multiple concurrent workers. Still the largest piece of unbuilt infrastructure per `docs/MISSION_ENGINE.md` §6.
- **Windows `chrome-launcher` temp-directory leak** (`docs/TECH_DEBT.md` item 4) — guarded against crashing a run, disk leak itself unfixed, unconfirmed whether it reproduces on the eventual production hosting platform.
- **UI still shows the retired "AI Agency Operating System" tagline** (`docs/TECH_DEBT.md` item 5) — `docs/ARCHITECTURE_DECISIONS.md` ADR-010 named fixing this as a Sprint 3 follow-up; it was missed because none of the three phases touched the login page or root layout.
- **No retry policy, no durable cross-process event delivery, no queue claim/lock semantics** — unchanged from Sprint 2, now exercised at slightly larger (but still single-caller) scale without being resolved.
- Still no automated accessibility audit of the *product's own* UI (distinct from the accessibility-adapter measuring a *target* site), still no rate limiting on `POST /api/missions` or the new analyze endpoint.

---

## Sprint 4 (next) — Website Generation, design phase only

**Status: design review only, no implementation.** See `docs/SPRINT_4_DESIGN_REVIEW.md`. Per `docs/MASTER_BLUEPRINT.md`'s named pipeline (ADR-010), Website Generation is the next stage after the Analysis/Opportunity-Report work Sprint 3 completed. The founder has approved Sprint 3's close and directed that Sprint 4 begin with design-only work — architecture, workflow, Mission Engine integration points, the design pipeline itself, AI responsibilities, acceptance criteria, risks, and open questions written down and reviewed before any code is written, per standing process. No Sprint 4 implementation is authorized by this status update or by the design review document itself.
