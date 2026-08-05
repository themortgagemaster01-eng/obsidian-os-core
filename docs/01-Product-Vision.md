# 01 — Product Vision

This document supersedes and expands the original `docs/VISION.md` (kept in place as a short pointer to this file so nothing that already links to it breaks). It reflects the product as understood after Sprint 2.

## What it is

Obsidian OS is an Autonomous Client Acquisition Operating System — a more precise label than the looser "AI Agency Operating System," and categorically not a website builder. A website redesign is one artifact a mission can produce inside the Design stage of an explicit pipeline (Discovery → Qualification → Research → Design → Proposal → Email → CRM → Learning → Analytics — see `docs/MASTER_BLUEPRINT.md` §1), but the product's job is to run that entire pipeline autonomously, always-on, for a small digital agency: it finds prospects, qualifies and researches them, does the analytical and creative work a human strategist and designer would do, drafts the outreach, and lines everything up for a person to review and approve each morning. The unit of work is a **mission** — one prospect business, tracked from first discovery through a proposed engagement — and the product is the console an operator uses to watch, steer, and approve missions at scale.

The name is deliberate: obsidian is forged under pressure into something sharp and useful. The interface reflects that — a dark, quiet, "mission control" surface, not a cheerful SaaS dashboard (see `docs/09-UI-Design-System.md`).

## The daily workflow (target state — not yet implemented)

Obsidian OS is designed to run on a nightly cycle. While the operator sleeps, the system is meant to:

1. **Discover leads** — surface candidate businesses worth pursuing, using whatever discovery sources are configured (directories, search, referrals). *Sprint 3 scope; not built.*
2. **Analyze** each candidate's current web presence, business context, and competitive position. *Sprint 3 scope; not built.*
3. **Score the opportunity** — not every business is worth pursuing; rank candidates so human attention goes to the best-fit ones first. *Sprint 3 scope; not built.*
4. **Redesign** — generate a concrete, opinionated redesign concept for the business's web presence, grounded in the analysis. *Not built.*
5. **QA the output** — check the work for quality and coherence before it's allowed to progress. The mission state machine already has a dedicated `qa` state with a built-in revise loop back to `designing` (see `docs/06-Database.md`), but nothing populates or drives it yet.
6. **Generate a proposal** — package the analysis and redesign into something a business owner could read and say yes to. *Not built.*
7. **Create a Gmail draft** — write the outreach email and save it as a draft. It does not send. *Not built; no Gmail/Microsoft Graph integration exists yet — see `docs/08-Integrations.md`.*

By morning, the intent is for the operator to wake up to a set of completed missions sitting in an **approval queue** (no UI yet — see `docs/05-Mission-Control.md`). They review each one — the analysis, the redesign, the proposal, the draft email — and decide what goes out.

**Nothing auto-sends. Nothing auto-deploys. The system does the work; the human keeps the keys.** This is the central trust boundary of the product and it does not move as the system gets more capable — more autonomy earns more scope of work, never removal of the approval gate. This principle predates Sprint 2 and Sprint 2 did nothing to weaken it: the Decision Memory layer built this sprint (`docs/06-Database.md`, `docs/04-AI-Systems.md`) exists specifically to make a human's approve/reject/edit decision a first-class, permanently recorded event — reinforcing the gate, not routing around it.

## The mission pipeline, as it exists after Sprint 2

Sprint 1 modeled a mission's position with two separate fields — `status` (lifecycle: active/waiting_approval/completed/failed/archived) and `stage` (pipeline position: recon/research/copywriting/design/seo/performance/proposal/deployment/outreach/waiting_approval) — that could in principle drift out of sync. Sprint 2 replaced both with a single canonical `state` field. The current 11 states, in their primary sequence:

**discovered → analyzing → researching → designing → qa → proposal → email → approval → sent → archived**

with `rejected` reachable as an explicit side-transition from most non-terminal states (not from `sent`, since rejecting a mission that already shipped isn't a meaningful action — only archiving it is), and a `qa → designing` revise loop as the one built-in non-linear forward path. See `docs/06-Database.md` for the exact transition rules and `docs/ARCHITECTURE_DECISIONS.md` for why this unification happened and how the old vocabulary maps onto the new one.

## The agent roster (target state — not yet implemented)

Each stage of work is intended to be owned by a narrowly-scoped AI agent with one responsibility, not a single do-everything model — this keeps failures isolated and outputs auditable:

- **Research Agent** — gathers business and market context.
- **Opportunity Scoring Agent** — ranks how worthwhile a prospect is.
- **Competitor Analysis Agent** — maps the competitive landscape.
- **Review Analysis Agent** — mines customer reviews for signal.
- **SEO Agent** — evaluates and improves search fundamentals.
- **Copywriter Agent** — writes the redesigned site's content.
- **Designer Agent** — produces the visual redesign.
- **QA Agent** — checks agent output before it advances.
- **Proposal Agent** — assembles the sellable package.
- **Email Agent** — drafts the outreach message.
- **Deployment Agent** — prepares a live, reviewable preview.

None of these exist as code today. Sprint 2 built the mechanism every future agent will use to report its work — the typed event bus in `lib/events/` — so that once an agent exists, it publishes progress as events on the mission's timeline rather than mutating state silently. See `docs/04-AI-Systems.md` for the full input/output contract each agent is expected to honor.

## Design language

Black, graphite, and deep navy tones with white typography; glass panels with subtle translucency and backdrop blur; soft shadows; thin, barely-there borders; generous, premium spacing. The reference points are Tesla, Apple, Linear, Vercel, and Notion — quiet, confident interfaces that never shout. No loud gradients, no cartoon graphics, no gimmicks. Motion is restrained: 200–300ms ease transitions, never a bounce or spring overshoot. It should feel like a serious instrument, not a marketing site. See `docs/09-UI-Design-System.md` for the exact tokens as implemented.

## Tech stack

Next.js 14 (App Router) with TypeScript in strict mode, Tailwind CSS, and hand-rolled shadcn/ui primitives on the frontend. Supabase for Postgres, Auth, and Storage. Anthropic's Claude as the primary AI provider with OpenAI as a fallback — both env-ready (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` in `.env.example`) but **not called by any code yet**. Gmail API and Microsoft Graph for email, Stripe for billing, GitHub and Cloudflare for the deployment pipeline — all environment placeholders only, wired in later sprints. See `docs/08-Integrations.md`.

## Long-term vision

Multi-tenant and white-label-ready. Sprint 2 built the `organizations`/`organization_members` schema and rewrote every table's row-level security to be organization-scoped rather than user-scoped, specifically so a future "invite your team" and "run this under your agency's brand for your clients" product doesn't require a schema rewrite. See `docs/02-Product-Requirements.md` and the ADR log for the retrofit-cost argument behind building this now instead of later.

## Roadmap

**Sprint 1 (Foundation) — done.** Project scaffold, Supabase schema and RLS policies, the original mission workflow engine, Supabase Auth, and a real Mission Control dashboard with a working New Mission flow. No analysis, scraping, or AI generation — by design.

**Sprint 2 (Mission State Machine + Multi-Tenancy + Event Bus + Decision Memory + Memory Vault) — done, this sprint.** See `docs/SPRINT_STATUS.md` for the full accounting.

**Sprint 3 (next) — the first real AI agents.** Discovery, Opportunity Scoring, and Research engines, wired into the Sprint 2 event bus for real. See `docs/11-Product-Roadmap.md`.

**Later sprints** — Design generation (Copywriter, Designer, QA), Proposal/Email generation, the Approval Queue UI, CRM UI, Deployment previews (GitHub/Cloudflare), and Billing (Stripe) on top of the multi-tenant schema.
