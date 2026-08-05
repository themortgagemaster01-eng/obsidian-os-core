# Obsidian OS — Master Blueprint

**Status:** Living document. Last updated after Sprint 2 (commit `0a3a5f0`, on top of Sprint 1's `9b989ed`).

## How to use this document

If you are a future engineer, or a future instance of an AI agent picking this project up with zero memory of how it got here, **read this document before you write a line of code or make an architectural decision.** It is the project's constitution: an executive summary of every major area of the system, with links out to a focused deep-dive doc in `/docs` for the detail you'll actually need to implement something correctly. This file is deliberately a synthesis, not the full detail — when you need the real specifics (exact table columns, exact event payloads, exact component props), follow the link to the numbered doc. When you make a decision this document doesn't cover, or you change a decision it does cover, **update this file and `docs/ARCHITECTURE_DECISIONS.md` in the same change** — documentation-first is not a suggestion here, it's the one process rule every sprint has followed so far and every sprint after this one must keep following.

This document reflects the codebase as it actually exists after Sprint 2, verified against the real migrations, TypeScript source, and components — not aspirational or invented. Where something is forward-looking spec (an agent that doesn't exist yet, an integration that isn't wired up), it says so plainly rather than implying it works.

---

## 1. Executive Vision

**Obsidian OS is an AI Agency Operating System — not a website builder.** A redesigned website is one artifact a mission can produce, but the product's job is bigger: it is an autonomous, always-on client-acquisition engine for a small digital agency. It finds prospect businesses, evaluates them, does the analytical and creative work a human strategist and designer would otherwise do by hand, drafts the outreach, and lines everything up for a person to review and approve. Website generation is a capability inside this system, not the system's identity. Anyone documenting, pitching, or extending Obsidian OS who reduces it to "a tool that builds websites" has misunderstood the product.

**Product philosophy.** Three commitments hold regardless of how capable the system becomes:

1. **Autonomous client acquisition, not autonomous client-facing action.** The system does discovery, research, scoring, design, copywriting, QA, proposal assembly, and email drafting on its own. It never sends an email, never publishes a live site, never takes an action a prospect or client can see, without a human explicitly approving it first.
2. **The human wakes up to a curated set of finished opportunities**, not a queue of raw tasks. The product's job is to compress a day of an agency operator's analytical and creative labor into a five-minute review-and-approve session. If a feature makes the operator do more triage work rather than less, it's the wrong feature.
3. **More autonomy earns more scope of work, never removal of the approval gate.** As agents get better, the system is trusted to do more analysis, generate better output, and shrink the human's editing burden — but the decision to send, publish, or spend money always remains a deliberate human action. This is the single non-negotiable trust boundary in the product, and it does not move as a growth lever. See `docs/01-Product-Vision.md` for the full narrative version of this philosophy and `docs/02-Product-Requirements.md` for how it's expressed as concrete acceptance criteria.

**Long-term vision.** Obsidian OS is being built multi-tenant and white-label-ready from the start, not retrofitted later. Sprint 2 laid that groundwork explicitly (see §3 and §6): every mission, event, decision, and company record is scoped to an `organization`, not a user. The long-term shape is a SaaS product other agencies can run under their own brand, with billing, team roles, and tenant isolation as first-class citizens — none of which has UI yet, but none of which requires a schema rewrite to add.

**Success metrics** (qualitative for now, pending real usage data): missions per week a single operator can meaningfully review; the ratio of AI-recommended action to human-overridden action captured in the Decision Intelligence layer (§4, §6); time from mission creation to a human decision; and, longer-term, proposal-to-close rate tracked through the Memory Vault (§6) once outreach and outcome tracking exist.

---

## 2. Product Requirements

**Core user journey.** A mission — the system's fundamental unit of work, one prospect business tracked from discovery through a proposed engagement — moves through this arc: **new mission → nightly pipeline work → morning approval queue review → approve / reject / edit → outcome tracked in the Memory Vault.** Today (post-Sprint 2), a mission can be created manually via the "New Mission" dialog on Mission Control, and it sits at the `discovered` state indefinitely — there is no nightly pipeline, no approval queue UI, and no agent driving it forward yet. Every later stage of that journey is real infrastructure with no work attached: the state machine can represent a mission at any of the 11 pipeline states, the event bus can carry an agent's output onto the mission timeline, and the Decision Intelligence and Memory Vault schemas are ready to record a human's approve/reject/edit decision and its outcome — but nothing populates them until Sprint 3+ builds the agents that do the actual work. This gap between "the rails exist" and "trains run on them" is deliberate and should be read as the current state, not a bug.

**Functional requirements** (see `docs/02-Product-Requirements.md` for the full breakdown): a user can sign in (Google, GitHub, or email magic link — Supabase Auth), see a personal organization auto-provisioned with zero setup steps, create a mission by URL, see it and its state on a dashboard, and (not yet built) review and act on completed missions in an approval queue, with every action durably recorded.

**Non-functional requirements:** strict TypeScript throughout (no `any`, no loose `Record<string, any>`); every table has row-level security scoped to organization membership, not just to the requesting user; the UI is dark-mode-only by design intent, not an oversight; there are currently no automated tests, which is a known and flagged gap (§10) rather than an accepted permanent state.

**Definition of "done" for the product** is intentionally staged: Sprint 1 was "done" when a user could authenticate and manually queue a mission into an inert pipeline. Sprint 2 is "done" (this sprint) when that pipeline has one coherent state field, tenant isolation, an event bus, and the schema for decision/company memory — all groundwork, no new user-visible capability. The product is only "done" in the product sense once a mission can traverse the full pipeline unattended overnight and a human can meaningfully act on the result each morning — that's several sprints out (see §11).

---

## 3. Software Architecture

**Layering is strict and one-directional.** UI never owns business logic:

- `app/` and `components/` are presentation only. Server components fetch through `lib/services`; client components call API routes. Neither layer talks to Supabase directly, constructs a query, or contains a business rule (e.g. `app/page.tsx` calls `computeMissionControlStats()` and `listMissionsForOrganization()` from `lib/services/mission-service.ts` — it does not touch `supabase.from(...)` itself).
- `lib/services` orchestrates. It's where business logic and cross-cutting rules live: `mission-service.ts`, `company-service.ts`, `decision-service.ts`. Services call repositories and the workflow engine; they never construct raw SQL/PostgREST queries themselves.
- `lib/repositories` is data access — one file per table (`mission-repository.ts`, `company-repository.ts`, `decision-repository.ts`, `mission-event-repository.ts`, `profile-repository.ts`), each exposing a small set of typed, mechanical CRUD/query functions with **zero business rules**. If a repository function has an `if` statement that isn't error handling, that logic belongs one layer up.
- `lib/workflow` is the state machine: `mission-state.ts` defines the pure type/constants (states, valid transitions, guards), `mission-workflow.ts` is the engine that performs and validates transitions and publishes events. It takes its dependencies (a Supabase client, the repositories, the event bus) as an explicit `deps` argument rather than reaching for globals or singletons — this is what keeps it unit-testable independent of how it's wired into a request.
- `lib/events` is the bus: `types.ts` defines the `DomainEvent` catalog, `event-bus.ts` defines the `EventBus` port and its current `SupabaseEventBus` implementation.

Dependency rule, stated plainly: `app/`, `components/` → `lib/services` → (`lib/repositories`, `lib/workflow`, `lib/events`) → `lib/supabase`. Nothing is allowed to import upward or sideways-and-back. `lib/repositories` never imports from `lib/services`. `lib/workflow` never imports React or Next.js. See `docs/03-Software-Architecture.md` for the full folder-by-folder walkthrough and the reasoning behind each boundary.

**The independent-subsystems model.** The product's real shape, forward-looking, is a set of loosely coupled subsystems connected only through the Mission Engine and the event bus, never directly to each other:

**Mission Engine** (built) → **Discovery Engine** (Sprint 3) → **Research Engine** (Sprint 3, includes Opportunity Scoring, Competitor Analysis, Review Analysis) → **Design Engine** (later) → **Proposal Engine** (later) → **Outreach Engine** (later) → **CRM** (schema built, no UI) → **Analytics** (not started) → **Approval Queue** (not started) → **Mission Control** (built).

Each subsystem is meant to be independently swappable and independently failable: a Discovery Engine outage should never take down Mission Control, because the only thing they share is the mission state machine and the event bus, not direct function calls into each other. This is why the event bus (§4, §6, ADR log) is a port/adapter rather than a direct-call convenience — Sprint 2 built the seam so Sprint 3's agents can be plugged in without touching call sites.

---

## 4. AI Systems

**Sprint 2 status: zero agents are implemented.** This section is forward-looking specification, not a description of running code — say this plainly to anyone reading it, because the event catalog and database types already have the *shape* of agent output (e.g. `WebsiteScannedPayload`, `SEOCompletePayload` in `lib/events/types.ts`), which can look deceptively like the agents exist. They don't. Nothing publishes those event types today except the workflow engine's own `MissionStarted`, `StateChanged`, `MissionRejected`, and `MissionArchived` events, and the Decision Intelligence layer's `DecisionLogged`.

The planned roster, one agent per pipeline concern, each meant to be narrowly scoped so failures are isolated and outputs auditable:

- **Research Agent** — gathers business and market context. Subscribes to `MissionStarted`; expected to publish `WebsiteScanned`.
- **Opportunity Scoring Agent** — ranks how worthwhile a prospect is. Subscribes to `WebsiteScanned`; publishes a scoring result (event type TBD — not yet in the catalog).
- **Competitor Analysis Agent** — maps the competitive landscape. Part of the Sprint 3 Research Engine.
- **Review Analysis Agent** — mines customer reviews for signal. Part of the Sprint 3 Research Engine.
- **SEO Agent** — evaluates and improves search fundamentals; publishes `SEOComplete`.
- **Copywriter Agent** — writes the redesigned site's content.
- **Designer Agent** — produces the visual redesign.
- **QA Agent** — checks agent output before it advances; can send a mission from `qa` back to `designing` (the one built-in revise loop in the state machine).
- **Proposal Agent** — assembles the sellable package; publishes `ProposalReady`.
- **Email Agent** — drafts outreach; publishes `EmailDraftReady`. Never sends.
- **Deployment Agent** — prepares a reviewable preview build. Note: Sprint 2 deliberately removed "deployment" as a top-level mission state (see §6, ADR log) — a preview build is a sub-activity surfaced via events, not a pipeline gate.

Plus the **Decision Intelligence layer**, which is not an agent that acts but a passive learner: `lib/services/decision-service.ts::logDecision()` records every human decision (approve/reject/edit and its context) as training data from day one, with no ML or scoring logic anywhere yet. See `docs/04-AI-Systems.md` for each agent's intended input/output contract against the event bus, and for the explicit statement of what "implement this agent" will require: an LLM call (Anthropic primary, per `.env.example`'s `ANTHROPIC_API_KEY`), a failure/retry policy (none exists yet — no agent runtime exists at all), and a publish call through `EventBus.publish()` rather than a direct `mission_events` insert.

---

## 5. Mission Control

Mission Control (`app/page.tsx`) is the one user-facing screen that exists. It's a server component: it resolves the signed-in user's `default_organization_id` via `profileRepository.findById()`, fetches that organization's missions via `listMissionsForOrganization()`, and computes three real stats via `computeMissionControlStats()` — Running Missions (state not in `sent`/`archived`/`rejected`), Completed Today (state is `sent` and `state_changed_at` falls within today), Waiting Approval (state is `approval`). Five more stat cards (Revenue Pipeline, Meetings Scheduled, Proposal Queue, Draft Emails, Website Builds) render as honest `$0`/`0` with a "Coming in a future sprint" caption — never a fake shimmer or invented number, a discipline worth preserving as new stats come online.

Below the stats, `MissionList` (`components/mission-control/mission-list.tsx`) renders each mission's business name, URL, creation date, and a `StateBadge` (`components/mission-control/state-badge.tsx`) color-coded by pipeline position, or an honest empty state ("No missions yet") when there are none. `NewMissionDialog` posts to `POST /api/missions` and refreshes the list — see §7.

**What doesn't exist yet:** a mission detail/timeline view rendering `mission_events` chronologically (the activity feed the vision promises), and the Approval Queue itself — the screen where a human actually reviews a completed mission's research, design, proposal, and draft email and decides approve/reject/edit. Every `logDecision()` call this system will ever make is meant to originate from that screen. See `docs/05-Mission-Control.md` for the full dashboard spec and the Approval Queue's intended role in the mission lifecycle.

---

## 6. Database

Six migrations, applied in order, are the full schema ground truth: `supabase/migrations/0001_init.sql` through `0006_memory_vault.sql`. Summary (full column-level detail in `docs/06-Database.md`):

- **`profiles`** (0001) — one row per `auth.users` row, auto-created by the `handle_new_user()` trigger. Extended in 0002 with `default_organization_id`.
- **`organizations`** / **`organization_members`** (0002) — multi-tenancy groundwork. Every signup auto-provisions a personal organization (`handle_new_user()` was rewritten, not replaced) with the user as `owner`. Two `security definer` helper functions, `is_org_member()` and `is_org_admin()`, back every membership-scoped RLS policy from this migration forward — this avoids the "infinite recursion" trap of a naive self-referencing RLS policy on `organization_members`.
- **`missions`** (0001, reshaped by 0003) — the mission's core table. 0003 adds `organization_id` (backfilled from the owner's default org, then `NOT NULL`) and collapses the old `status` + `stage` two-field design into one `state` text column with an 11-value CHECK constraint, plus a `state_changed_at` timestamp maintained by a dedicated trigger (`set_mission_state_changed_at`), independent of the generic `updated_at` trigger. RLS moved from `owner_id = auth.uid()` to `is_org_member(organization_id)`.
- **`mission_events`** (0001, reshaped by 0004) — the mission timeline / persistence half of the event bus. 0004 adds `actor` and a **denormalized** `organization_id` (avoids a join to `missions` on every RLS check and analytics query — a deliberate performance tradeoff, see ADR log) and locks `event_type` to a 10-value CHECK constraint matching `lib/events/types.ts::DomainEventType` exactly.
- **`decisions`** (0005) — the Decision Intelligence layer. 11 `decision_type` values, `ai_recommendation`/`user_action` as free text, `before_value`/`after_value` as `jsonb` (deliberately flexible rather than rigid typed columns — schema doesn't yet know what a future recommendation engine will need to compare), plus named numeric/text context columns (`opportunity_score`, `website_score`, `proposal_price`, `industry`, etc.) for the fields expected to matter most, and a catch-all `metadata jsonb` for everything else.
- **`companies`** (0006) — the Memory Vault, the anchor of the future CRM. One row per business per organization (`unique(organization_id, website_url)`), persisting across every mission that business is ever part of: `total_missions_count`, `last_mission_id`, proposal/contact history fields, a `do_not_contact` compliance flag, and freeform `design_preferences jsonb`. `missions.company_id` links back, nullable because it postdates Sprint 1 missions.

RLS posture: every table is `is_org_member(organization_id)` for read, with write policies scoped the same way (some tables also gate writes/deletes behind `is_org_admin()` for org-level management actions). No table is reachable by an authenticated user outside their organization membership. See `docs/06-Database.md` for the exhaustive per-table column list, every index, and the exact backfill logic in 0003's migration (which state each old `stage`/`status` combination mapped to, and why).

---

## 7. API

One endpoint exists: **`POST /api/missions`** (`app/api/missions/route.ts`). Contract: requires an authenticated session (`supabase.auth.getUser()`); resolves the caller's `default_organization_id` (400 if absent, which should be unreachable in practice since signup always provisions one); accepts `{ businessName?: string, websiteUrl: string }`, normalizes and validates the URL (defaults to `https://` if no scheme given, 400 on an invalid URL), defaults `businessName` to the URL's hostname if omitted; delegates to `mission-service.createMission()`; returns `{ mission }` with `201` on success or `{ error: string }` with an appropriate status (`401`, `400`, or `500`) on failure. The route handler itself contains no business logic — auth check, input shape validation, delegate, respond.

**Auth model:** Supabase Auth (Google OAuth, GitHub OAuth, email magic link — see `app/login/page.tsx`), session managed via cookies through `@supabase/ssr`, refreshed and enforced by `middleware.ts` + `lib/supabase/middleware.ts` on every request matching the route matcher (all paths except static assets). Unauthenticated users are redirected to `/login`; authenticated users hitting `/login` are redirected to `/`. `/login` and `/auth/callback` are the only public paths.

**Error handling convention** established by this one route and expected to hold for every future one: validate inputs early and return `400` with a specific `{ error }` message; check auth first and return `401`; catch unexpected failures from the service layer and return `500` with the caught error's message (never a raw stack trace or an opaque "something went wrong"). Future endpoints (an approval-queue action endpoint, a mission-detail endpoint, a companies/CRM endpoint) should follow this exact shape rather than introducing a new pattern. See `docs/07-API.md` for the full request/response contract and a template for a new endpoint.

---

## 8. Integrations

**Live today:** Supabase (Postgres, Auth, and the client libraries) is the only real, working integration — everything in §6 and §7 runs through it.

**Env-ready, not called:** `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` exist in `.env.example` (Anthropic as primary provider, OpenAI as fallback, per the original product brief) but **no code anywhere calls either API.** This is the single biggest gap between "the product's premise" and "what's implemented" — every AI agent in §4 is unbuilt.

**Future, not integrated at all:** Gmail API / Microsoft Graph (for real email drafting, once the Email Agent exists and needs somewhere to put a draft), Stripe (billing, once there's a monetizable multi-tenant product), GitHub and Cloudflare (the deployment pipeline, for the Deployment Agent's preview builds). All four are represented only as commented placeholder env vars in `.env.example` — no client library, no wrapper module, no code path touches them. Treat any of them as "not started" rather than "partially built." See `docs/08-Integrations.md` for what each integration will need to provide once its owning agent is built.

---

## 9. UI Design System

Dark-mode-only by deliberate design intent (`darkMode: ["class"]` in `tailwind.config.ts`, `<html class="dark">` hardcoded in `app/layout.tsx`, `color-scheme: dark` forced in `app/globals.css` — there is no light theme and none is planned). The palette is black/graphite/navy: `background #0A0A0B`, `panel #121214`, hairline borders at `rgba(255,255,255,0.08)`, a navy accent (`#1E3A5F`) used sparingly, white (`#FAFAFA`) foreground text. The `.glass-panel` utility (translucent panel background + `backdrop-blur-md` + hairline border + soft shadow) is the one signature visual motif, used on the login card today and intended for every elevated surface going forward.

Typography is Inter, loaded via `next/font/google` with the `--font-inter` CSS variable, sans-serif throughout — no display/serif pairing. Spacing and radius are conservative (`0.375rem`–`0.75rem` border radii; generous container padding). **Animation is constrained to 200–300ms `ease` transitions with no bounce or spring overshoot** — every interactive hover/transition in the codebase today (`stat-card.tsx`, `mission-list.tsx` row hover) uses `duration-200 ease-in-out`, and the Tailwind config's default transition duration is set to `250ms`. This restraint is a design law, not a preference: the product should read as a serious instrument (Tesla/Apple/Linear/Vercel/Notion register), never a cheerful SaaS dashboard.

**Component inventory:** hand-rolled shadcn/ui primitives on Radix — `button`, `card`, `input`, `label`, `dialog`, `badge` (with `default`/`outline`/`navy`/`success`/`warning`/`destructive` variants via `class-variance-authority`), `separator`, `avatar`, `skeleton`. Mission Control composes these into `stat-card.tsx`, `mission-list.tsx`, `state-badge.tsx`, `new-mission-dialog.tsx`, `sign-out-button.tsx`. **Accessibility posture:** inherited from Radix primitives (keyboard nav, focus management, ARIA roles on `Dialog`, `Label`/`Input` association) but never separately audited — no accessibility pass has been run on this codebase. Flag this as a gap, not a guarantee. See `docs/09-UI-Design-System.md` for exact tokens, the full component list, and the accessibility gap in more detail.

---

## 10. Development Standards

**TypeScript strictness:** `strict: true` in `tsconfig.json`, no relaxations. The codebase-wide rule (stated in `VISION.md` and honored throughout) is no `any`, no loose `Record<string, any>` standing in for a real domain type — every table has a hand-written `Database` type in `lib/supabase/database.types.ts` matching the migrations, and every service/repository function is fully typed end to end.

**"Components never own business logic"** is enforced by convention today, not by a lint rule — there is no architectural-boundary linter in this codebase yet (a reasonable candidate for a future `eslint-plugin-boundaries` or similar addition, not yet done). Enforcement so far has been discipline: every server component fetches through `lib/services`, every client component calls an API route.

**Testing: there are currently zero automated tests in this repository.** No test runner is configured, no `*.test.ts` files exist. This is a real gap, explicitly flagged (it was flagged after Sprint 1 too, and remains unaddressed) — the highest-value first target, when testing is introduced, is `lib/workflow/mission-workflow.ts`'s transition validation logic (`transitionMissionState`'s sequential-vs-`allowNonSequential` branching, the `rejected`/`archived` terminal-state invariants), because it's pure business logic with the deps-injection pattern already built for testability, and because a state-machine bug is exactly the kind of defect that's cheap to catch with a unit test and expensive to catch in production.

**Commit conventions observed so far:** one large, well-described commit per sprint (`9b989ed` for Sprint 1, `0a3a5f0` for Sprint 2), with a summary line naming every major subsystem touched. This is a small enough team/process that squash-per-sprint has worked; it should be revisited once more than one person or agent is committing concurrently.

**Documentation-first policy:** this blueprint, the ADR log, and the sprint status doc are updated *before or alongside* code changes each sprint, not after the fact as an afterthought — Sprint 2's own migrations and workflow code are full of doc-comments explaining *why*, not just *what* (see the extensive inline commentary in every 0002–0006 migration and in `mission-state.ts`/`mission-workflow.ts`). Continue that pattern: a migration or service change without an accompanying comment explaining its reasoning, and a sprint without an updated blueprint + ADR entry, should be treated as incomplete work. See `docs/10-Development-Standards.md` for the full standards write-up.

---

## 11. Product Roadmap

**Sprint 1 (Foundation) — done.** Project scaffold (Next.js 14 App Router, TypeScript strict, Tailwind, hand-rolled shadcn/ui), Supabase schema (`profiles`, `missions`, `mission_events`) with least-privilege owner-scoped RLS, the original mission workflow engine (two-field `status`/`stage` design), Supabase Auth (Google, GitHub, email magic link), and a real Mission Control dashboard with a working New Mission flow.

**Sprint 2 (this sprint) — done.** Unified `status`+`stage` into one canonical `state` field (11 states, text+CHECK, not a native enum, with old→new backfill logic — see the ADR log for why); multi-tenancy groundwork (`organizations`, `organization_members`, auto-provisioned personal org, org-scoped RLS everywhere); a formal typed event bus (`lib/events/`) as the mission timeline's single writer, replacing direct `mission_events` inserts; the Decision Intelligence schema + `logDecision()` service (architecture only, no ML); the Memory Vault (`companies` table) with `findOrCreateCompany()` wired into mission creation so it starts accumulating data immediately; UI updated to match the new schema.

**Sprint 3 (next) — the first real AI agents.** Discovery Engine (finds businesses with poor websites — real scraping/search logic, not a stub), Opportunity Scoring (scores discovered candidates), and Research Engine (competitor + review analysis) — the first agents actually wired into the Sprint 2 event bus, meaning they call `EventBus.publish()` with real `WebsiteScanned`/`SEOComplete`-shaped payloads instead of those types existing only in `lib/events/types.ts` with nothing producing them. This requires net-new infrastructure Sprint 2 does not provide: a job runner/scheduler (nothing drives a mission forward today — it sits at `discovered` until something calls `transitionMissionState()`, and nothing does), real Anthropic API wiring (the key is in `.env.example` but unused), and the actual scraping/analysis logic itself.

**Broader arc after Sprint 3:** Design generation (Copywriter + Designer agents), Proposal/Email generation (Proposal + Email agents, still never auto-sending), the Approval Queue UI (the screen that finally calls `logDecision()` for real), a CRM UI surfacing the Memory Vault's `companies` table, the Deployment Agent and preview-build pipeline (GitHub/Cloudflare), and eventually billing + multi-tenant monetization (Stripe, team management UI on top of the `organizations`/`organization_members` schema already in place). See `docs/11-Product-Roadmap.md` for the fuller sequencing rationale and dependencies between these phases.
