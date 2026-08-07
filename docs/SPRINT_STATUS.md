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

## Sprint 4 — Website Generation — Phase 1 (Design Intelligence Foundation) done; later phases not authorized

**Status: Phase 1 implemented; Phase 2 (Website Generation Pipeline) and beyond not started, not authorized by this update.** The design-only planning pass (`docs/SPRINT_4_DESIGN_REVIEW.md`, `docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md`, `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md`, `docs/DESIGN_INTELLIGENCE.md`) was reviewed and the founder authorized Phase 1 specifically: translating `docs/DESIGN_INTELLIGENCE.md`'s philosophy into a lightweight, typed rules/schema module, per the Design Intelligence Recommendation's explicit guidance to build the schema/rules layer now and defer everything heavier (a queryable reference-library integration, a full component library, a versioned rules engine) until there's real evidence it's needed.

**What was built:** `lib/design-intelligence/` — a read-only knowledge/constraints layer with no orchestration, no adapter access, and no `transitionMissionState()` calls, matching the ownership boundary both design docs set for it:

- `types.ts` — shared `TypeRole` and `EasingCurve` schema types.
- `design-rules.ts` — the general Premium Design Principles (§1-§2) as structured, citable data, plus the sitewide spacing scale schema and validator (§4).
- `typography-rules.ts` — the named type-role scale, the two-family pairing limit, and readability (line length/line height) validators (§3).
- `layout-rules.ts` — the named generic-SaaS-template pattern (made checkable, per §5's own instruction), grid rhythm schema, and the structural-diversity proxy `docs/SPRINT_4_DESIGN_REVIEW.md` §12's acceptance criterion 3 proposed.
- `motion-rules.ts` — the tunable default duration band plus the non-negotiable bounce/spring/purposeless-motion ban (§6).
- `never-generate-rules.ts` — all ten entries from `docs/DESIGN_INTELLIGENCE.md` §11, as structured data.

Each module ships with real `node:test` coverage (60 tests total across the existing suite plus this addition) exercising the actual validators and lookups, not placeholder assertions. `npm test` and `npm run build` both pass clean. Nothing in this module has a caller yet — `design-brief-service.ts` and `design-qa-service.ts`, the two future consumers named in the Design Review, are Phase 2/3 work and are not part of this change.

**Deliberately not done in Phase 1, per scope:** Trust Patterns (§8), Conversion Patterns (§9), Industry Adaptation (§10), Mobile Standards (§7), the Design QA checklist (§12), and any color-role schema — none of these were named in the founder's Phase 1 authorization (Design rules, Typography rules, Layout rules, Motion rules, Never Generate rules) and none are built here. Per `docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md` §4's own stated convention, `docs/MASTER_BLUEPRINT.md` and the ADR log are intentionally not updated by this phase — this codebase's precedent is that ADRs record what was built at a sprint's actual closure (Sprint 3's ADR-011 through ADR-014 were all written at closure, not per-phase), and Sprint 4 is not closed.

**Phase 2 (Website Generation Pipeline) and beyond are not authorized by this update** — per the phase-gated rhythm Sprint 3 and this planning pass both used, implementation stops here for founder review before `design-brief-service.ts` or any generation code is written.

## Sprint 4 — Phase 2 (Website Generation Pipeline: Design Brief, Reference Selection, Wireframe, Component Assembly) — done; Phase 3 (Design Refinement) not started, not authorized

**Status: Phase 2 implemented exactly to its four-item scope; Phase 3 (Typography/Spacing/Motion passes, design-qa-service.ts, founder-review UI) not started, not authorized by this update.** Followed docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md's proposed resolutions where the founder directed: reused the `researching` mission state for the Design Brief step (§2's resolution of Design Review Open Question 1), reused the existing fire-and-forget worker pattern (ADR-012) rather than building new execution infrastructure, and started with a small in-house reference set rather than a third-party design-reference platform (§2's resolution of Open Question 4).

**What was built:**

- `lib/design-references/reference-library.ts` — 16-entry in-house reference set (2 per `docs/DESIGN_INTELLIGENCE.md` §10 industry bucket, including a safe "general" fallback) and `resolveIndustryBucket()`, a keyword-based classifier over `companies.industry`/`business_category`'s freeform text that falls back to "general" rather than guessing a wrong specific industry.
- `lib/services/design-brief-service.ts` — `buildDesignBrief()` (pure): reads Insights and Normalized Analysis directly (not the aggregate `opportunity_score`, per the Recommendation's resolution of Open Question 7), cites at least one real finding (§12 AC1), selects a reference direction, and produces the Design Brief (target audience, positioning, direction, references considered). `runDesignBrief()`/`createDesignBriefRun()` (orchestration): transitions `analyzing -> researching` on entry, `researching -> designing` on completion, persists to the new `design_briefs` table, publishes `DesignBriefReady`/`DesignBriefFailed`.
- `lib/services/design-generation-service.ts` — `generateWireframe()` (pure): per-industry-bucket section-order templates, with a real runtime check (not just a comment) that output never matches `lib/design-intelligence/layout-rules.ts`'s banned generic-SaaS pattern. `assembleComponents()` (pure): assigns a component kind per section and marks every content slot explicitly "real" or "placeholder" — several slots (contact phone/address/hours, credibility's years-in-business/review-count/certifications) are placeholder-only today because the Sprint 3 crawl adapter doesn't capture that data, a disclosed real gap, not a design choice. `runDesignGeneration()`/`createDesignGenerationRun()` (orchestration): requires the mission already at `designing`, persists to the new `website_designs` table, publishes `WebsiteDesignReady`/`WebsiteDesignFailed`, and deliberately does NOT transition mission state further — per the founder's explicit Phase 2 guidance, Generation assembles, it doesn't judge; only a future `design-qa-service.ts` (Phase 3) owns `designing -> qa`.
- `supabase/migrations/0010_design_engine.sql` — `design_briefs` and `website_designs` tables (one row per run, versioned, mirroring `website_analyses`' precedent) and the `mission_events` CHECK constraint update for four new event types.
- `POST /api/missions/:id/design-brief` and `POST /api/missions/:id/generate-design` — both mirror `POST /api/missions/:id/analyze` exactly (ADR-012): synchronous row creation, un-awaited background invocation via a service-role client, 202 immediately.

92 tests total (25 new), all real assertions against the pure `buildDesignBrief`/`generateWireframe`/`assembleComponents` logic — no orchestration/route tests, matching this codebase's existing precedent that `analysis-service.ts` and the API routes it's called from have none either. `npm test` and `npm run build` both pass clean.

**Deliberately not done in Phase 2, per scope:** Typography/Spacing/Motion passes, `design-qa-service.ts`, any founder-review UI for the Design Brief (Human Approval Point #2 in `docs/SPRINT_4_DESIGN_REVIEW.md` §11 — the mission auto-advances `researching -> designing` today with no human gate, exactly the way Sprint 3's `discovered -> analyzing` auto-advances with none). No ADR entries or `MASTER_BLUEPRINT.md` changes, for the same reason Phase 1 didn't add them — this codebase's convention is that ADRs record what's built at a sprint's actual closure, and Sprint 4 is not closed.

**Phase 3 (Design Refinement) is not authorized by this update** — implementation stops here for founder review.
