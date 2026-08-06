# CLAUDE.md

Read this before starting any implementation session. It's the condensed operating manual —
the full source is `docs/CLAUDE_OPERATING_DIRECTIVE.md` (Claude Operating System Directive
v1.0); the commit/PR hygiene rules are in `CONTRIBUTING.md`. This file is just the five-minute
version of "how do I build on Obsidian OS correctly."

## Product mission

Obsidian OS is an **Autonomous Client Acquisition Operating System** — not a website builder.
Website generation is one artifact the pipeline produces, not the product's identity. The full
pipeline: Business Discovery → Mission Created → Website Analysis → Business Insights →
Opportunity Score → Opportunity Report → Website Generation → Proposal Generation → Draft Email
→ Founder Review → Approval → Send → Decision Memory → Learning → Analytics. Every feature should
be checkable against this pipeline — if it doesn't advance the customer journey, it doesn't belong.

## Development philosophy

Optimize for customer value, not engineering elegance. Prefer simplicity, readability, and
maintainability over abstraction. Don't build for hypothetical future problems — build what the
current pipeline stage actually needs. When customer value and architectural purity conflict,
customer value wins.

## Repository rules

GitHub is the canonical source of truth. Any given Claude session is disposable — nothing that
matters should live only in one session's working state. Small commits, frequent pushes, no
rewritten history, no force pushes without approval. Every phase gets its own commit; every sprint
review gets committed. The repo should always be fully recoverable from GitHub alone.

## Coding standards

Strict TypeScript, no `any`. Documentation changes land in the same commit as the architecture
change they describe — `docs/MASTER_BLUEPRINT.md` and `docs/ARCHITECTURE_DECISIONS.md` stay
synchronized with reality, not updated in a follow-up pass. If code and docs disagree, that's a bug.

## Mission Engine rules

The Mission Engine owns workflow. No service, route handler, or component modifies mission state
directly. Only `transitionMissionState()` and `EventBus.publish()` are allowed to change mission
progression. React never owns workflow — it only renders state.

## Architecture principles

- **Services have one job each.** Sprint 3's split is the model to follow: `AnalysisService`
  collects facts → `BusinessInsightService` explains facts → `OpportunityScoringService` evaluates
  facts → `OpportunityReportService` presents facts → UI displays the report. Never merge
  responsibilities into one service.
- **Adapters are I/O only.** Crawl, SEO, Lighthouse, Screenshot, Accessibility, Technology, and any
  future adapter gather information from an external system and return it raw. No business logic,
  no scoring, no interpretation — that all happens one layer up, in a service.
- **Evidence first.** Every recommendation in the Opportunity Report must trace to a specific
  measurement (e.g. "slow loading" → Lighthouse, "missing H1" → SEO Adapter). If the evidence
  doesn't exist, the statement doesn't get made. No unsupported claims, no exaggerated marketing
  language, business language over technical jargon.
- **Confidence ratings are mandatory.** Every report section carries a confidence level (High /
  Medium / Low) and a reason. A category whose underlying check failed reads as low-confidence or
  unavailable — never a confident-sounding score standing in for a measurement that didn't happen.
- **Founder approval gates everything customer-facing.** Nothing sends an email, publishes a
  proposal, or contacts a business without explicit founder review first. This is non-negotiable
  and does not get automated away as the system gets more capable.
- **Decision Memory is permanent history.** Founder edits (proposals, emails, pricing,
  recommendations, approvals, rejections) become learning data. Never overwritten, always preserved.

## Testing expectations

Every phase gets tested in this order: unit tests → integration tests → real website validation →
founder review. Mock data is fine during development, but nothing is considered complete until it's
been run against a real public website — a synthetic target like `example.com` doesn't satisfy
this bar. Report honestly what was verified and what wasn't; don't paper over a gap.

## Workflow

Design → Review → Approval → Implementation → Testing → Sprint Review → Merge → Next Sprint. Within
a sprint, review each phase separately (e.g. Infrastructure → Business Logic → Presentation →
Validation) rather than saving everything for one large end-of-sprint review. Don't start the next
phase or the next sprint until the current one is reviewed and approved. Don't redesign the
platform mid-implementation unless it reveals a genuine architectural issue — flag it and get a
decision, don't just proceed on a new plan.
