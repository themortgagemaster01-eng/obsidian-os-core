# 04 — AI Systems

**Read this first: no AI agent described in this document is implemented.** Sprint 2 built the infrastructure every future agent will plug into (the mission state machine, the typed event bus) and the event *catalog* that anticipates what agents will publish, but zero lines of code call Anthropic or OpenAI, and zero background processes run any agent logic. Every "subscribes to / publishes" statement below is forward-looking specification for Sprint 3 and beyond, written now so the contract is decided before the implementation, not invented after the fact. Treat this document as a spec to implement against, not a description of running behavior.

## The event bus contract every agent must honor

`lib/events/types.ts` defines `DomainEvent` as a discriminated union with a fixed catalog of 10 types, each carrying `missionId` and `organizationId` at the top level plus a typed `payload`. `lib/events/event-bus.ts` defines the `EventBus` port:

```ts
interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(handler: EventHandler): () => void;
}
```

An agent's job, once implemented, is: read what it needs (from the mission row, from prior events, from its own external calls), do its work, and call `eventBus.publish(...)` with a properly typed event — never insert into `mission_events` directly (the repository layer's insert function exists for the event bus's internal use, not for agents to call around it). This is the same discipline `mission-workflow.ts` already follows for `MissionStarted`, `StateChanged`, `MissionRejected`, and `MissionArchived`.

## The event catalog (current)

| Event type | Payload | Currently published by |
|---|---|---|
| `MissionStarted` | `{ businessName, websiteUrl }` | `mission-workflow.ts::createMission` |
| `WebsiteScanned` | `{ websiteUrl, findings? }` | *nobody yet — intended: Research/Discovery Agent* |
| `SEOComplete` | `{ score?, issues? }` | *nobody yet — intended: SEO Agent* |
| `ProposalReady` | `{ proposalId?, price? }` | *nobody yet — intended: Proposal Agent* |
| `EmailDraftReady` | `{ subject?, length? }` | *nobody yet — intended: Email Agent* |
| `MissionApproved` | `{ approvedBy }` | *nobody yet — intended: Approval Queue action* |
| `MissionRejected` | `{ reason? }` | `mission-workflow.ts::rejectMission` |
| `MissionArchived` | `{ archivedBy? }` | `mission-workflow.ts::archiveMission` |
| `StateChanged` | `{ fromState, toState }` | `mission-workflow.ts::transitionMissionState` (every transition) |
| `DecisionLogged` | `{ decisionType }` | `decision-service.ts::logDecision` |

Note the gap: there is no scoring-specific or discovery-specific event type yet (e.g. nothing named `OpportunityScored` or `CompanyDiscovered`). Sprint 3 will need to extend `DomainEventType` and the matching `mission_events.event_type` CHECK constraint (a new migration) before the Discovery and Opportunity Scoring agents can publish anything typed for their own output — reusing `WebsiteScanned` for discovery-adjacent findings is a reasonable stopgap but should be a deliberate decision, not an accident.

## The planned agent roster

For each, "subscribes to" describes the event that should trigger the agent's work once a job runner exists (see `docs/11-Product-Roadmap.md` — no such runner exists yet), and "publishes" describes the event it should emit on completion.

- **Research Agent** — gathers business and market context on a newly discovered prospect. Subscribes to `MissionStarted` (or a future `CompanyDiscovered`). Publishes `WebsiteScanned`. Drives the mission from `discovered` to `analyzing`/`researching`.
- **Opportunity Scoring Agent** — ranks how worthwhile a prospect is, so human attention (once there's a queue) goes to the best-fit candidates first. Subscribes to `WebsiteScanned`. Publishes a scoring result — no event type exists for this yet; adding one is Sprint 3 work. Writes to `decisions.opportunity_score`-shaped context eventually, via the Decision Intelligence layer once a human acts on the score.
- **Competitor Analysis Agent** — maps the competitive landscape around a prospect. Part of the Sprint 3 "Research Engine" grouping alongside Opportunity Scoring and Review Analysis.
- **Review Analysis Agent** — mines customer reviews (Google, Yelp, etc.) for signal about the business's reputation and pain points. Also part of the Research Engine.
- **SEO Agent** — evaluates and improves search fundamentals for the prospect's current site. Publishes `SEOComplete` with a `score` and `issues[]`. Drives `researching → designing` or is folded into the `qa` state's work (see `docs/06-Database.md` on why SEO doesn't have its own top-level pipeline state).
- **Copywriter Agent** — writes the redesigned site's content, grounded in the Research Agent's findings.
- **Designer Agent** — produces the visual redesign. Drives the mission into/through `designing`.
- **QA Agent** — checks the Copywriter/Designer/SEO output for quality and coherence before it's allowed to progress. This is the one agent with a built-in failure path already modeled in the state machine: `mission-workflow.ts::transitionMissionState` explicitly permits `qa → designing` as a non-sequential-but-always-allowed transition (the "revise loop"), so a QA agent that finds a problem can send the mission back for another design pass without needing an `allowNonSequential` override.
- **Proposal Agent** — assembles the analysis, redesign, and pricing into a sellable package. Publishes `ProposalReady`.
- **Email Agent** — drafts the outreach message as a saved draft. Publishes `EmailDraftReady`. Per the product's core trust boundary (`docs/01-Product-Vision.md`), this agent must never call a send API — only a draft-creation API, once Gmail/Microsoft Graph integration exists (`docs/08-Integrations.md`).
- **Deployment Agent** — prepares a live, reviewable preview build (not a publish). Note that Sprint 2 deliberately removed "deployment" as a top-level mission state (see `docs/ARCHITECTURE_DECISIONS.md`) — this agent's work should be tracked via events (e.g. a future `PreviewBuildReady` event) as a sub-activity of `designing`/`qa`, not as its own pipeline stage.

## Failure, retry, and logging — none of this exists yet

There is no agent runtime, so there is no retry policy, no failure state, no timeout handling, and no structured agent logging beyond whatever the eventual LLM SDK call logs on its own. When this is built, a few things the current architecture already implies:

- **Failures should be events, not silent state.** A failed agent run should publish something onto the mission timeline (a new event type, e.g. `AgentFailed`, does not exist yet and will need to be added to the catalog) rather than leaving the mission stuck at its current state with no visible explanation.
- **Retries should not double-publish side effects.** Because `SupabaseEventBus.publish()` both persists to `mission_events` and fans out to in-process subscribers synchronously, a naive retry-the-whole-agent-function approach risks duplicate events on the timeline. A retry policy should retry the *external call* (the LLM/scraping call) and only publish once a clean result is obtained, not retry the publish step itself.
- **A durable, cross-process transport will be needed before real retries are possible at all.** The current `SupabaseEventBus`'s in-process subscriber fan-out is explicitly documented (in `event-bus.ts`) as non-durable and non-cross-process — it doesn't survive a restart and doesn't fan out to other server instances. Sprint 3's job runner will need either Supabase Realtime or a real job queue (Inngest, Trigger.dev, or similar) behind the same `EventBus` interface before agents can run as independent, retryable background workers. See the ADR log for why this was deliberately deferred rather than built speculatively in Sprint 2.

## The Learning / Decision Intelligence layer

Distinct from the action-taking agents above, the Decision Intelligence layer (`lib/services/decision-service.ts`, `docs/06-Database.md`'s `decisions` table) is a passive learner, not an agent: it does not decide anything or call an LLM. Its entire job is `logDecision()` — recording every meaningful human decision (what the AI recommended, what the human actually did, before/after values for edits, and the business/opportunity context at the time) as clean, structured training data from day one. No ML or recommendation logic exists anywhere in the codebase. The explicit intent (per the migration's own comment in `0005_decisions.sql`) is that by the time a future recommendation/prediction system is worth building, there's already a real dataset of human judgment to train or evaluate it against, rather than starting that effort with zero data.
