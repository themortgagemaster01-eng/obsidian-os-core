# 02 — Product Requirements

## Functional requirements

**Authentication.** A user can sign in via Google OAuth, GitHub OAuth, or an email magic link (`app/login/page.tsx`). Magic link was chosen over password auth deliberately — no password to create or remember, matching the product's premium, no-friction feel, and keeping the Sprint 1 auth surface small. On first sign-in, a `profiles` row and a personal `organizations` row are created automatically by the `handle_new_user()` trigger (`supabase/migrations/0002_organizations.sql`) — zero extra onboarding steps for a solo user.

**Mission creation.** An authenticated user can create a mission by supplying a website URL (and optionally a business name) via the "New Mission" dialog (`components/mission-control/new-mission-dialog.tsx`), which posts to `POST /api/missions`. The mission is created at the `discovered` state, linked to (or creates) a Memory Vault `companies` record for that business, and seeds its timeline with a `MissionStarted` event. **Creating a mission does not trigger any analysis, scraping, or AI work** — this is explicit in the code comments in `app/api/missions/route.ts` and `lib/workflow/mission-workflow.ts::createMission`.

**Mission visibility.** An authenticated user sees every mission belonging to their organization (not just missions they personally created) on Mission Control (`app/page.tsx`), each showing business name, URL, creation date, and current state.

**Mission lifecycle actions (schema/engine exists, no UI yet).** `lib/workflow/mission-workflow.ts` exposes `transitionMissionState()`, `rejectMission()`, and `archiveMission()` as the complete, validated state-transition API. No route or UI currently calls any of them beyond the initial `discovered` state set at creation — a mission created today will sit at `discovered` forever until Sprint 3+ builds something that drives it forward.

**Decision logging (schema/service exists, no caller yet).** `lib/services/decision-service.ts::logDecision()` is a complete, callable API for recording a human's approve/reject/edit/etc. decision on a mission, publishing a `DecisionLogged` event. Nothing calls it yet because the Approval Queue UI that would call it doesn't exist.

**Memory Vault (schema + one real write path).** `lib/services/company-service.ts::findOrCreateCompany()` is wired into mission creation, so the `companies` table accumulates a real row per unique (organization, website) pair from day one, including `total_missions_count` incrementing on repeat missions against the same business. No read-side CRM UI exists yet.

## Non-functional requirements

- **Type safety.** Strict TypeScript (`tsconfig.json`: `"strict": true`) throughout; no `any`; every database table has a hand-written `Database` type in `lib/supabase/database.types.ts` mirroring the migrations exactly.
- **Tenant isolation.** Every table's row-level security is scoped to organization membership (`is_org_member(organization_id)` / `is_org_admin(organization_id)`), not to the individual user, as of Sprint 2. See `docs/06-Database.md`.
- **Auditability.** Every meaningful state change and (eventually) every agent output is recorded as an immutable event on `mission_events` via the event bus, not as a silent field mutation. See `docs/03-Software-Architecture.md` and `docs/04-AI-Systems.md`.
- **Honesty in the UI.** Metrics with no real backing data render as explicit `$0` / `0` with a "Coming in a future sprint" caption rather than a fake loading shimmer or invented number (`app/page.tsx`). This is a real, code-enforced product principle, not just a talking point.
- **Testing.** Currently zero — a known, explicitly flagged gap. See `docs/10-Development-Standards.md`.

## Core user journeys

**Journey 1 — New mission.** Operator signs in → clicks "New Mission" → enters a URL → mission is created at `discovered`, linked to a Memory Vault company record, timeline seeded. *(Fully working today.)*

**Journey 2 — Nightly pipeline (target state, not built).** A scheduled process (no job runner exists yet — see `docs/11-Product-Roadmap.md`) picks up missions at `discovered`, runs them through Discovery → Research → Design → QA → Proposal → Email agents, each publishing events and transitioning state, ending at `approval`.

**Journey 3 — Morning approval queue review (target state, not built).** Operator opens an approval queue (no UI exists), sees every mission sitting at `approval`, reviews the accumulated research/design/proposal/email artifacts and event timeline, and takes an action.

**Journey 4 — Approve / reject / edit (schema exists, no caller).** Each action calls `logDecision()` with the relevant context (industry, scores, proposal price, before/after values for an edit) and transitions the mission's state accordingly (`approval → sent` on approve, `approval → rejected` on reject, back to an earlier state or an edited artifact on an edit-type decision).

**Journey 5 — Outcome tracked in Memory Vault (schema exists, mostly unpopulated).** The `companies` table has the columns to track this (`last_proposal_amount`, `last_proposal_sent_at`, `follow_up_date`, `do_not_contact`) but nothing writes to most of them yet beyond `findOrCreateCompany()`'s mission-linking fields.

## Business workflows

The product is built for a solo or small-team agency operator who wants to spend their attention on judgment calls (is this prospect worth pursuing, is this proposal good enough to send) rather than on the mechanical labor of researching, designing, and drafting for each one. The "one operator reviewing many missions each morning" shape is why the Approval Queue (not yet built) is treated as equally important to Mission Control in the roadmap — Mission Control is the ambient status view, the Approval Queue is where actual decisions get made and actual product value gets captured.

## Acceptance criteria for "done" (product-level, not sprint-level)

The product is not "done" in any meaningful sense until: (1) a mission can traverse the entire pipeline from `discovered` to `approval` unattended, driven by real agents publishing real events; (2) a human can review a completed mission's full output (research findings, design, proposal, draft email) in one screen and take one of a small set of clear actions; (3) every such action is durably captured by the Decision Memory layer; and (4) outcomes (did the proposal get accepted, did the client become repeat business) flow back into the Memory Vault. Sprint 2 built the schema and plumbing for (3) and part of (4); (1) and (2) are entirely ahead, starting with Sprint 3.
