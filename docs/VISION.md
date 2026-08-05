# Obsidian OS — Vision

## What it is

Obsidian OS is an AI Agency Operating System — not a website builder. A website
redesign is one artifact a mission can produce, but the product's job is to run an
autonomous, always-on operations layer for a small digital agency: it finds
prospects, evaluates them, does the analytical and creative work a human strategist
and designer would do, drafts the outreach, and lines everything up for a person to
review and approve each morning. The unit of work is a **mission** — one prospect
business, tracked from first discovery through a proposed engagement — and the
product is the console an operator uses to watch, steer, and approve missions at
scale.

The name is deliberate: obsidian is forged under pressure into something sharp and
useful. The interface reflects that — a dark, quiet, "mission control" surface, not
a cheerful SaaS dashboard.

## The daily workflow

Obsidian OS runs on a nightly cycle. While the operator sleeps, the system:

1. **Discovers leads** — surfaces candidate businesses worth pursuing, using
   whatever discovery sources are configured (directories, search, referrals).
2. **Analyzes** each candidate's current web presence, business context, and
   competitive position.
3. **Scores the opportunity** — not every business is worth pursuing; the system
   ranks candidates so human attention goes to the best-fit ones first.
4. **Redesigns** — generates a concrete, opinionated redesign concept for the
   business's web presence, grounded in the analysis.
5. **QAs** the output — checks the work for quality and coherence before it's
   allowed to progress.
6. **Generates a proposal** — packages the analysis and redesign into something a
   business owner could read and say yes to.
7. **Creates a Gmail draft** — writes the outreach email and saves it as a draft.
   It does not send.

By morning, the operator wakes up to roughly ten completed missions sitting in an
**approval queue**. They review each one — the analysis, the redesign, the
proposal, the draft email — and decide what goes out. Nothing auto-sends. Nothing
auto-deploys. The system does the work; the human keeps the keys. This is the
central trust boundary of the product and it does not move as the system gets more
capable — more autonomy earns more scope of work, never removal of the approval
gate.

## The mission pipeline

Every mission moves through a fixed, ordered sequence of stages:

**Recon → Research → Copywriting → Design → SEO → Performance → Proposal →
Deployment → Outreach → Waiting Approval**

Recon is the first pass at a target (do they have a site, what shape is it in).
Research digs into the business and its market. Copywriting and Design produce the
actual redesigned content and layout. SEO and Performance harden the result.
Proposal turns the work into something sellable. Deployment prepares (but does not
publish) a live preview. Outreach drafts the human-facing communication. Waiting
Approval is the terminal stage before a human decides what happens next — at which
point mission status becomes `waiting_approval`, distinct from the stage of the
same name, so the system can distinguish "sitting at the outreach step" from "done
with the pipeline and blocked on a person."

A mission's `status` (active, waiting_approval, completed, failed, archived) is
tracked separately from its `stage`, because status is about lifecycle and stage is
about pipeline position — a mission can be `active` at any stage, but only reaches
`waiting_approval` status once the pipeline itself is finished with it.

## The agent roster

Each stage of work is owned by a narrowly-scoped AI agent with one responsibility,
not a single do-everything model. This keeps failures isolated and outputs
auditable:

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

Every agent publishes progress as events on the mission's timeline (the
`mission_events` table in Sprint 1) rather than mutating state silently — the
timeline is the audit trail an operator can trust.

## Design language

Black, graphite, and deep navy tones with white typography; glass panels with
subtle translucency and backdrop blur; soft shadows; thin, barely-there borders;
generous, premium spacing. The reference points are Tesla, Apple, Linear, Vercel,
and Notion — quiet, confident interfaces that never shout. No loud gradients, no
cartoon graphics, no gimmicks. Motion is restrained: 200–300ms ease transitions,
never a bounce or spring overshoot. It should feel like a serious instrument, not a
marketing site.

## Tech stack

Next.js 14 (App Router) with TypeScript in strict mode, Tailwind CSS, and shadcn/ui
on the frontend. Supabase for Postgres, Auth, and Storage. Anthropic's Claude as
the primary AI provider with OpenAI as a fallback. Gmail API and Microsoft Graph
for email in later sprints, Stripe for billing, GitHub and Cloudflare for the
deployment pipeline — all wired as environment placeholders now, implemented later.

## Architecture rules

Business logic never lives inside React components. Components render and call
typed service functions — nothing more. The layering is strict: `lib/supabase`
holds typed client factories and hand-written database types; `lib/repositories`
is a thin, mechanical data-access layer with one file per table and no business
rules; `lib/services` holds the actual business logic and orchestrates repositories
plus the workflow engine; `lib/workflow` is the mission state machine, built to
accept its dependencies (repositories, a Supabase client) as arguments rather than
reaching for globals, so it stays testable independent of how it's wired up.
Everything is strongly typed — no `any`, no loose `Record<string, any>` standing in
for a real domain type.

## Roadmap

**Sprint 1 (Foundation) — done.** Project scaffold, Supabase schema and RLS
policies, the mission workflow engine, Supabase Auth (Google, GitHub, email magic
link), and a real Mission Control dashboard with a working New Mission flow. No
analysis, scraping, or AI generation yet — by design.

**Sprint 2 (Mission Engine + Discovery)** — a real discovery agent, opportunity
scoring, a background job runner that drives the workflow engine, and stage
transitions wired to actual agent work.

**Later sprints** — Analysis agents (competitor, review, SEO), Website Generation
(copywriter, designer, QA), CRM surfacing, Email Drafts via Gmail, Deployment
previews via GitHub/Cloudflare, and Billing via Stripe.
