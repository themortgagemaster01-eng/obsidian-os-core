# Architecture Decision Records

**This file must be updated every future sprint, alongside `docs/MASTER_BLUEPRINT.md`.** A sprint that changes the architecture without a corresponding ADR entry here is incomplete, per the documentation-first policy in `docs/10-Development-Standards.md`. Entries are chronological, oldest first. Each entry: title, date, status, context, decision, consequences/alternatives considered.

---

## ADR-001: Next.js App Router + Supabase as the platform foundation

**Date:** 2026-08-05
**Status:** Accepted

**Context.** Sprint 1 needed to pick a frontend framework and a backend/data platform for a product that would need auth, a relational schema with row-level tenant isolation eventually, and a fast path to a real dashboard UI, without a dedicated backend team to run infrastructure.

**Decision.** Next.js 14 (App Router) with TypeScript in strict mode, Tailwind CSS, and hand-rolled shadcn/ui primitives on the frontend; Supabase (Postgres + Auth + Storage) as the backend. Server Components fetch data directly server-side through `lib/services`; the one mutating flow (`POST /api/missions`) goes through a Route Handler; `@supabase/ssr` manages cookie-based sessions across both.

**Consequences / alternatives considered.** A separate backend service (e.g. a standalone Node/Express or Python API) was rejected — it would have added a deployment target and a network hop for no benefit at this stage, when Supabase's Postgres + Auth + RLS already provides the persistence and tenant-isolation primitives the product needs. A traditional Pages Router Next.js app was rejected in favor of App Router for first-class Server Components, which let the data-fetching layer (`lib/services`) be called directly from `app/page.tsx` without a client-side fetch/loading-state dance for the primary dashboard view. The cost of this choice is that the whole app is more tightly coupled to Next.js's server/client component model than a framework-agnostic API would be — acceptable for the product's current single-frontend scope.

---

## ADR-002: Layered `lib/` architecture (services / repositories / workflow / events)

**Date:** 2026-08-05
**Status:** Accepted

**Context.** Sprint 1 needed to decide where business logic, data access, and the mission state machine each live, before any of them existed, to avoid the common failure mode of business logic leaking into React components or route handlers as the codebase grows.

**Decision.** A strict one-directional layering: `app/`/`components/` (presentation only) → `lib/services` (business logic/orchestration) → `lib/repositories` (mechanical data access, one file per table) and `lib/workflow` (the state machine, dependency-injected rather than using module-level singletons) → `lib/supabase` (typed client factories and hand-written DB types). See `docs/03-Software-Architecture.md` for the full dependency-direction rules.

**Consequences / alternatives considered.** A simpler two-layer split (just "components" and "a big `lib/db.ts`") was rejected as insufficiently future-proof — it was clear from the outset that a state machine (the mission pipeline) and an eventual event system would need their own homes distinct from plain CRUD, and retrofitting that separation after code already assumed a flat structure is expensive. The dependency-injection pattern for the workflow engine (explicit `deps` argument instead of an imported singleton client) costs a small amount of ceremony at every call site (`createMissionWorkflowDeps(client)`) in exchange for testability that doesn't exist yet but is designed in from day one — see the testing gap noted in `docs/10-Development-Standards.md`. No automated boundary enforcement (e.g. an ESLint import-restriction rule) was added; the layering is enforced by convention and review only, a known soft spot.

---

## ADR-003: Sprint 1's two-field `status` + `stage` mission model (superseded by ADR-005)

**Date:** 2026-08-05 (recorded retroactively, alongside its Sprint 2 correction)
**Status:** Accepted, superseded

**Context.** Sprint 1 needed to represent both a mission's lifecycle (is it actively being worked, waiting on a human, done, failed, archived?) and its position in the pipeline (which of ten stages is it at?) as separate concerns, since they seemed conceptually distinct: "active" felt orthogonal to "at the design stage" vs. "at the SEO stage."

**Decision.** Two columns: `status` (`active`/`waiting_approval`/`completed`/`failed`/`archived`) and `stage` (`recon`/`research`/`copywriting`/`design`/`seo`/`performance`/`proposal`/`deployment`/`outreach`/`waiting_approval`), each with its own CHECK constraint, each transitioned independently by `lib/workflow/types.ts` (Sprint 1) logic.

**Consequences (with hindsight — this is what Sprint 2 fixed).** The two fields could drift out of sync in ways that were hard to reason about: nothing enforced that `status = 'waiting_approval'` correlated with `stage = 'waiting_approval'` (note the awkward naming collision itself — a status value and a stage value sharing a name is a design smell in hindsight), and a caller updating one field without the other was a real, easy-to-write bug with no compiler or constraint to catch it. The Mission Control "Completed Today" stat computation also had to reason about `status = 'completed'` while other UI reasoned about `stage`, doubling the surface area for a subtle mismatch. This was corrected in Sprint 2 — see ADR-005.

---

## ADR-004: Multi-tenancy (organizations) built now, not deferred

**Date:** 2026-08-05
**Status:** Accepted

**Context.** Sprint 2 needed to decide whether to add `organizations`/`organization_members` and rewrite every table's RLS to be tenant-scoped now, while the product has effectively zero real users and no team/billing UI exists yet — or defer multi-tenancy until it was actually needed by a team-management feature.

**Decision.** Build it now: `organizations` + `organization_members` (`supabase/migrations/0002_organizations.sql`), an auto-provisioned personal org on every signup via a rewritten `handle_new_user()` trigger, `profiles.default_organization_id`, and every table's RLS (`missions`, `mission_events`, `decisions`, `companies`) scoped to `is_org_member(organization_id)` / `is_org_admin(organization_id)` instead of a direct `owner_id = auth.uid()` check.

**Consequences / alternatives considered.** The alternative — keep `owner_id`-scoped RLS and retrofit organizations later, once team features are actually being built — was rejected specifically because of the retrofit-cost argument: retrofitting tenant isolation onto a schema and RLS policy set that was written assuming single-owner rows means rewriting every policy, backfilling an `organization_id` onto every existing table with live data (a much riskier migration once real customer data exists), and auditing every query path in the app for an implicit "this only returns my own rows" assumption that a tenant-scoped model breaks. Doing it now, while `missions` and `mission_events` are the only tables with any live-shaped data and before a single real customer exists, keeps the migration low-risk and means every table built from Sprint 2 onward (`decisions`, `companies`) is tenant-scoped from its first line rather than needing its own follow-up migration later. The cost paid now: solo users get an invisible "personal organization" they never see or manage, adding a small amount of indirection (every query needs `organization_id`, not just `user_id`) for a benefit (team/white-label readiness) that has no UI yet and won't be used for several more sprints.

---

## ADR-005: Unifying `status` + `stage` into a single `state` field

**Date:** 2026-08-05
**Status:** Accepted

**Context.** With ADR-003's hindsight in mind, Sprint 2 needed a mission-lifecycle model that couldn't drift out of sync with itself, while still supporting the real distinct pipeline positions the product needs (11, after consolidation — see below) and the non-linear transitions the pipeline actually has (rejection from most states, a QA revise loop).

**Decision.** One column, `state`, text with a CHECK constraint restricting it to 11 values (`discovered, analyzing, researching, designing, qa, proposal, email, approval, sent, archived, rejected`), plus a `state_changed_at` timestamp maintained by a dedicated trigger independent of the generic `updated_at` trigger. `docs/06-Database.md` has the exact backfill CASE expression; the interesting mapping choices are addressed here.

**Why a text + CHECK constraint, not a native Postgres `enum` type.** A native `enum` was considered and rejected. Postgres enums are notoriously awkward to evolve: adding a value is a fast, safe `ALTER TYPE ... ADD VALUE`, but *removing* or *renaming* a value (which this product will very plausibly need — pipeline stages are exactly the kind of thing that gets rethought as the product matures, as ADR-003 itself demonstrates) requires rebuilding the type and every column using it, inside a migration that can't run inside the same transaction as other DDL in some Postgres versions. A text column with a CHECK constraint gets 95% of the safety (invalid values are still rejected at the database level) with 100% of the evolvability (changing the constraint is a plain `ALTER TABLE ... DROP CONSTRAINT` / `ADD CONSTRAINT`, no special-cased migration tooling). Given this product is two sprints old and its own state vocabulary already changed once, evolvability was weighted higher than the marginal type-safety/storage-efficiency benefit of a native enum.

**Why keeping two fields was rejected.** Already covered by ADR-003's hindsight — the fundamental problem (two fields that can independently drift) isn't fixable by tuning either field's vocabulary; it requires collapsing to one field.

**The old→new mapping, and why the less-obvious choices were made:**
- `stage = 'seo'` and `stage = 'performance'` both fold into the new `qa` state, and `stage = 'deployment'` *also* folds into `qa`. This is the least obvious mapping decision in the migration and deserves explicit justification: SEO checks, performance checks, and preparing a deployable preview are all, in the new model, treated as **sub-activities of the quality-assurance gate** rather than distinct pipeline stops a mission visibly sits at. The reasoning: an operator reviewing Mission Control doesn't need to distinguish "currently running SEO checks" from "currently running performance checks" from "currently building a preview" as separate top-level states — what they need to know is "is this mission still being validated before it's ready to propose," which is exactly what `qa` communicates. The finer-grained detail of *which* check is running is exactly what the event bus (ADR-006) is for — an SEO Agent publishing `SEOComplete` with a score, a Deployment Agent publishing a future preview-build event — without needing three separate top-level pipeline states that add dashboard complexity without adding decision-relevant information for the human. This is a genuine information-hiding tradeoff, made deliberately, not an oversight.
- `stage = 'copywriting'` maps to the new `researching` state, not `designing` — because in the new vocabulary, `researching` is meant to cover the analytical/content-gathering work that produces what a Copywriter agent would consume, while `designing` is reserved for the visual/layout work. This reflects a shift in how the pipeline's middle stages are conceptually grouped, not a literal one-to-one renaming.
- `status = 'completed'` maps to `sent` (not `archived`) — "completed" in the old model meant the pipeline finished and outreach went out; `sent` is the new model's equivalent successful-completion state, with `archived` reserved for the explicit housekeeping step after a mission (successful or rejected) is done being looked at.
- `status`-based rules were given priority over `stage`-based rules in the backfill CASE expression specifically because `status` was the more authoritative field for terminal outcomes in the Sprint 1 schema — a mission marked `failed` should become `rejected` regardless of what `stage` it happened to be sitting at when it failed.

**Consequences.** The state machine is now genuinely a single source of truth, with `transitionMissionState()` (`lib/workflow/mission-workflow.ts`) as the sole enforcement point for valid transitions, including the hard invariants (`archived` is fully terminal; `rejected` only ever moves to `archived`) and the explicit non-sequential exceptions (`qa → designing`, and rejection from any non-terminal, non-`sent` state). The cost: the "SEO/Performance/Deployment are folded into QA" decision means the current UI cannot show "this mission is specifically running SEO checks right now" without reading the mission's event timeline — a deliberate simplicity-over-granularity tradeoff that should be revisited if user feedback (once there are users) says otherwise.

---

## ADR-006: A typed event bus as a port/adapter, not direct Supabase calls or an immediate real queue

**Date:** 2026-08-05
**Status:** Accepted

**Context.** Sprint 1's workflow engine wrote to `mission_events` directly wherever it needed to log something. Sprint 2 needed a mechanism for the mission timeline that (a) would work identically for the handful of events the workflow engine itself publishes today and (b) would be the right shape for Sprint 3+'s agents to publish real work output through, without requiring a rewrite when those agents move from "called inline in a request" to "running as independent background workers."

**Decision.** Define `EventBus` as an interface (`lib/events/event-bus.ts`) — `publish(event): Promise<void>` and `subscribe(handler): unsubscribe` — with `SupabaseEventBus` as the only current implementation: persists every event to `mission_events` and additionally fans it out synchronously, in-process, to same-request subscribers. `DomainEvent` (`lib/events/types.ts`) is a discriminated union with a fixed, typed catalog, matching the `mission_events.event_type` CHECK constraint string-for-string with no snake_case translation layer.

**Consequences / alternatives considered.** Two alternatives were explicitly rejected: **(1) keep calling Supabase directly everywhere**, as Sprint 1 did — rejected because every future agent would need to independently reimplement "insert into `mission_events` with the right shape," with no single place to add cross-cutting behavior (e.g. a future audit log, a future webhook fan-out, a future notification trigger) later. **(2) Adopt a real message queue or job system (Inngest, Trigger.dev, Supabase Realtime as a durable transport) immediately** — rejected as premature for Sprint 2: there is no background agent yet that needs cross-process delivery, so building or integrating real queue infrastructure now would be speculative complexity with no consumer to justify it. The interface is deliberately designed so this decision can be revisited cheaply: swapping `SupabaseEventBus` for a durable, cross-process-aware implementation later requires no changes to any call site, only a new class implementing the same `EventBus` interface. The explicit, documented cost of the current implementation (in `event-bus.ts`'s own doc comment): the in-process fan-out is not durable and does not survive a restart or fan out across server instances — acceptable today because nothing subscribes to it yet, and flagged clearly as something Sprint 3's job runner must address (`docs/04-AI-Systems.md`, `docs/11-Product-Roadmap.md`).

---

## ADR-007: Denormalizing `organization_id` onto `mission_events` and `decisions`

**Date:** 2026-08-05
**Status:** Accepted

**Context.** With RLS now organization-scoped (ADR-004), every policy check on a mission-child table (`mission_events`, `decisions`) needs to know which organization the row belongs to. The naive approach is a subquery/join back to `missions.organization_id` on every RLS check and every analytics query.

**Decision.** Store `organization_id` directly on both `mission_events` and `decisions`, backfilled via a join to `missions` at migration time, then locked `NOT NULL`, with its own index on each table. RLS policies check `is_org_member(organization_id)` directly against the denormalized column — no join to `missions` in the policy itself.

**Consequences / alternatives considered.** The alternative — a normalized design where these tables only carry `mission_id` and every RLS check joins to `missions` — was rejected on a performance/simplicity tradeoff: `mission_events` in particular is expected to become the highest-volume table in the schema (every agent publishing every piece of work, eventually many events per mission), and both RLS checks and analytics queries ("show me every event across an organization," "show me every decision of type `edit_proposal` across an organization") are meaningfully simpler and faster against a direct column than a join-per-row. The cost is standard denormalization risk: `organization_id` on a child row could in principle drift from its parent mission's `organization_id` if a mission were ever reassigned to a different organization (no code path does this today, and it's not a planned feature) — worth revisiting if cross-organization mission transfer ever becomes a real requirement.

---

## ADR-008: `decisions.before_value`/`after_value`/`metadata` as flexible `jsonb`, not rigid typed columns

**Date:** 2026-08-05
**Status:** Accepted

**Context.** The Decision Intelligence layer (`decisions` table, `supabase/migrations/0005_decisions.sql`) needs to capture "what changed" for an edit-type decision (e.g. `edit_email`, `edit_proposal`, `change_price`) where the shape of "before" and "after" varies enormously depending on `decision_type` — an edited email subject is a string, an edited proposal might be a structured object, a changed price is a number.

**Decision.** `before_value` and `after_value` are `jsonb`, nullable, with no fixed shape enforced by the schema. Alongside them, a set of **named, typed columns** for the specific signals expected to matter most for a future scoring/recommendation model (`opportunity_score numeric`, `website_score numeric`, `proposal_price numeric(10,2)`, `industry text`, `business_category text`, `email_subject text`, `email_length integer`, `website_theme text`), plus a catch-all `metadata jsonb` for anything not yet worth a named column.

**Consequences / alternatives considered.** A fully rigid, fully typed schema (a separate table or a set of nullable typed columns per possible edit type — `old_email_subject`, `new_email_subject`, `old_proposal_price`, `new_proposal_price`, etc.) was rejected as premature over-specification: at this stage nobody has built the recommendation/prediction system that will eventually consume this data, so guessing its exact schema needs now risks a table full of columns that turn out to be the wrong shape, requiring a migration to fix later. The `jsonb` before/after approach defers that specification decision to whenever the consuming system is actually being built, while the named columns capture the handful of signals that are obviously going to matter (a score, a price, an industry) regardless of what the eventual model looks like, so those don't have to be parsed back out of unstructured JSON for the common case. The cost: `jsonb` columns don't get the same compile-time type safety as named columns — a bug that writes the wrong shape into `before_value` won't be caught by TypeScript or a database constraint, only by the eventual consumer failing to parse it. Acceptable given nothing consumes this data yet (Sprint 2 is architecture-only for this layer).

---

## ADR-009: Modeling `companies` (the Memory Vault) now, with real write wiring, instead of deferring the CRM concept entirely

**Date:** 2026-08-05
**Status:** Accepted

**Context.** Sprint 2 needed to decide whether to build any CRM-adjacent schema at all yet, given there is no CRM UI, no outreach code, and no proposal/email generation — or defer the entire concept until those features exist and it's clearer what a "company" record actually needs to hold.

**Decision.** Build the `companies` table now (`supabase/migrations/0006_memory_vault.sql`) as the anchor of the future CRM — one row per unique (organization, website) pair, persisting `total_missions_count`, `last_mission_id`, proposal/contact history fields, a `do_not_contact` compliance flag, and freeform `design_preferences jsonb` — and wire `findOrCreateCompany()` into mission creation (`lib/workflow/mission-workflow.ts::createMission`) so every mission created from Sprint 2 onward actually populates it, rather than shipping a schema nothing writes to.

**Consequences / alternatives considered.** Deferring the whole Memory Vault concept until outreach/CRM UI work begins was rejected for the same retrofit-cost reasoning as ADR-004: if `companies` is added only once a CRM UI needs it, every mission created before that point has no company linkage, and backfilling "which business does this old mission belong to" after the fact means re-deriving it from `business_name`/`website_url` matching — exactly the fuzzy, error-prone work `findOrCreateCompany()`'s normalization logic already exists to avoid doing in an ad hoc way. Building the table now, with real (if minimal) write wiring, means the data starts accumulating from day one — by the time a CRM UI or an outreach agent needs `companies` data, there's already real history in it instead of an empty table needing a backfill migration. The explicit compliance flag (`do_not_contact`) being part of the schema from day one, before any outreach code exists to check it, was a deliberate choice so it can never be added as an afterthought once outreach ships and consent hygiene suddenly matters urgently. The cost paid now: a table with several columns (`last_contacted_at`, `last_proposal_amount`, `follow_up_date`) that nothing writes to yet beyond the one `findOrCreateCompany()` call site — acceptable, consistent with how `decisions` shipped as schema-only in the same sprint.
