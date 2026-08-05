# 11 — Product Roadmap

## Sprint 1 (Foundation) — done

Project scaffold (Next.js 14 App Router, TypeScript strict mode, Tailwind CSS, hand-rolled shadcn/ui primitives on Radix). Supabase schema for `profiles`, `missions`, `mission_events` with owner-scoped RLS. The original mission workflow engine, modeling pipeline position with two fields (`status`, `stage`). Supabase Auth (Google, GitHub, email magic link) and route protection middleware. A real Mission Control dashboard with three genuinely computed stats and five honest placeholder stats, plus a working "New Mission" flow. Explicitly, by design: no analysis, scraping, or AI generation of any kind.

## Sprint 2 (Mission State Machine + Multi-Tenancy + Event Bus + Decision Memory + Memory Vault) — done, this sprint

Unified the two-field `status`/`stage` design into one canonical `state` field (11 states, text + CHECK constraint, with a full documented old→new backfill mapping — `supabase/migrations/0003_mission_state_machine.sql`). Added multi-tenancy groundwork: `organizations` + `organization_members`, auto-provisioned personal org on signup, and rewrote RLS across every table to the organization-membership pattern. Formalized a typed event bus (`lib/events/`) as the mission timeline's single writer. Added the Decision Memory schema (`decisions` table) and `logDecision()` service — architecture only, no ML. Added the Memory Vault (`companies` table) with real find-or-create wiring into mission creation. Updated the UI to match the new schema. See `docs/SPRINT_STATUS.md` for the complete file-by-file accounting.

**Correction to note:** Sprint 1's own status doc (the old `docs/SPRINT_STATUS.md`, before this update) predicted Sprint 2 would be "Mission Engine + Discovery" — a real discovery agent, opportunity scoring, and a background job runner. That is **not** what Sprint 2 actually built. Sprint 2 instead built the foundational plumbing (state machine unification, multi-tenancy, event bus, decision memory, memory vault) that Sprint 1's discovery-agent work would have needed anyway to be built correctly the first time, rather than on top of the old two-field state design. The discovery/scoring/research work originally slated for "Sprint 2" is now Sprint 3's scope, described below. This is a sequencing correction, not a scope cut — nothing was dropped, it was reordered so the infrastructure agents will depend on exists before the agents themselves are built.

## Sprint 3 (next) — the first real AI agents

**Scope: Discovery Engine, Opportunity Scoring, and Research Engine** — the first agents that actually publish real events through the Sprint 2 event bus, rather than the event catalog existing with nothing producing most of it.

- **Discovery Engine** — finds businesses with poor websites (via search, directory scraping, or a seed list to start). Creates missions (or a `CompanyDiscovered`-shaped event and mission, depending on final design) and publishes real findings.
- **Opportunity Scoring** — scores discovered candidates so a future Approval Queue can prioritize human attention. Needs a new event type in `lib/events/types.ts` (and a matching migration updating `mission_events.event_type`'s CHECK constraint) — no scoring-specific event exists in the Sprint 2 catalog yet.
- **Research Engine** — competitor analysis and review analysis, publishing real `WebsiteScanned`-shaped (or newly typed) events with actual findings instead of the payload shape existing only as a TypeScript interface nothing constructs.

**What Sprint 3 gets for free from Sprint 2's infrastructure:**
- The mission **state machine** — agents transition missions via `transitionMissionState()` with all the validation/invariant logic already correct and tested-by-inspection.
- The **event bus** — agents call `eventBus.publish()` and get persistence + timeline visibility for free, without designing their own logging mechanism.
- The **companies table** — a Discovery Agent creating a mission automatically gets Memory Vault linkage via the already-wired `findOrCreateCompany()`, so discovered businesses accumulate history from the first mission onward with no extra work.
- The **organization-scoped RLS** — any new query these agents run (via a service-role client or a user-scoped one) inherits the correct tenant isolation without needing new policies for the tables that already exist.

**What Sprint 3 requires that does not exist yet — net-new work, not a gap in Sprint 2's scope:**
- **A job runner / scheduler.** Nothing currently drives a mission forward from `discovered`. There is no cron trigger, no queue, no background worker process anywhere in this codebase. Sprint 3 cannot ship "a nightly pipeline" without building this first — options include a Next.js Route Handler triggered by an external cron (e.g. Vercel Cron or a Supabase scheduled function), or adopting a real job/queue system (Inngest, Trigger.dev) as flagged in `docs/04-AI-Systems.md`'s failure/retry discussion. This is also the natural point to finally replace the event bus's non-durable in-process fan-out with a durable, cross-process transport, since a real job runner is exactly the kind of separate-process consumer that fan-out was documented as inadequate for.
- **Real Anthropic API wiring.** `ANTHROPIC_API_KEY` exists in `.env.example` but zero code calls it. Sprint 3 needs an actual SDK integration — a new `lib/ai/` (or similar) module, prompt construction for each agent's task, and response parsing into the typed payloads `lib/events/types.ts` already defines.
- **Actual scraping/analysis logic.** Fetching and parsing a prospect's website, running whatever competitor/review-mining logic Research Engine needs, and scoring logic for Opportunity Scoring — none of this exists in any form (not even a stub) today.
- **New event types and a new migration.** At minimum, something for "company discovered" and "opportunity scored," plus updating `mission_events.event_type`'s CHECK constraint to allow them.

## Broader arc after Sprint 3

**Design generation** — Copywriter and Designer agents, producing the actual redesigned content and visual layout, driving missions from `researching` through `designing`.

**Proposal/Email generation** — Proposal and Email agents, publishing `ProposalReady` and `EmailDraftReady` for real. The Email Agent's implementation must respect the trust boundary in `docs/01-Product-Vision.md`: draft creation only, and only once a real Gmail/Microsoft Graph integration exists (`docs/08-Integrations.md`) — no send capability, ever, regardless of how confident the agent's output is.

**Approval Queue UI** — the screen that finally gives `decision-service.ts::logDecision()` a real caller, and the point at which the Decision Memory layer starts accumulating genuine training data instead of sitting unused.

**CRM UI** — a read (and eventually edit) surface over the `companies` table, finally giving the Memory Vault a front end.

**Deployment** — the Deployment Agent and a real GitHub/Cloudflare-backed preview-build pipeline. Recall that Sprint 2 deliberately did not give "deployment" its own top-level mission state (`docs/06-Database.md`, `docs/ARCHITECTURE_DECISIONS.md`) — this work should surface via events as a sub-activity of `designing`/`qa`, not require a new pipeline stage.

**Billing / multi-tenant monetization** — Stripe integration, enforcing the `organizations.plan` column that already exists but currently does nothing, plus the team-management UI (invite a teammate, assign roles) that the `organization_members` schema has been ready for since Sprint 2 but which has no insert policy or UI yet.
