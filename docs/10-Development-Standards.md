# 10 — Development Standards

## TypeScript strictness

`tsconfig.json` sets `"strict": true` with no relaxing flags. The codebase-wide convention (stated in the original vision doc and honored consistently through Sprint 2) is: no `any`, no loose `Record<string, any>` filling in for a real type. Every database table has a hand-written `Database` type (`lib/supabase/database.types.ts`) with `Row`/`Insert`/`Update` shapes matching the live migrations exactly, in the format `supabase gen types typescript` would produce — the stated intent is that once a live Supabase project exists, running the real codegen and dropping its output in here should be a minimal diff, not a rewrite. Domain unions (`MissionState`, `DomainEventType`, `DecisionType`) are defined once, in the layer that owns the corresponding DB constraint (`mission-state.ts` for `MissionState`, `decision-repository.ts` for `DecisionType`), and imported everywhere else rather than redefined.

## "Components never own business logic"

Enforced by convention and code review discipline, **not by an automated boundary linter** — no `eslint-plugin-boundaries` or import-restriction rule exists yet to catch a violation mechanically. Every server component today fetches through `lib/services`; every client component calls an API route rather than a repository or service function directly (client components can't import server-only Supabase clients anyway, which provides some natural enforcement, but that's an accident of the Next.js client/server boundary, not a deliberate architectural guardrail). As the codebase grows past what a single reviewer can eyeball, adding a real lint rule enforcing the dependency direction in `docs/03-Software-Architecture.md` is a reasonable investment — not done yet.

## Testing: a real, flagged gap

**There are zero automated tests in this repository.** No test runner (Jest, Vitest, Playwright, etc.) is configured in `package.json`, no `*.test.ts`/`*.spec.ts` files exist anywhere. This was flagged as a gap after Sprint 1 and remains unaddressed after Sprint 2 — worth stating plainly rather than letting it go unmentioned a second sprint running.

**Highest-value first target, when this is picked up:** `lib/workflow/mission-workflow.ts::transitionMissionState()`'s branching logic — the sequential-vs-`allowNonSequential` decision, the hard invariants (`archived` never transitions further, `rejected` only ever goes to `archived`), and the three implicitly-allowed non-sequential transitions (`qa → designing` revise loop, any-non-terminal-except-`sent` → `rejected`, `rejected → archived`). This is pure, deterministic business logic, already shaped for testability via the `MissionWorkflowDeps` injection pattern (`docs/03-Software-Architecture.md`) — a test can construct fake repositories and a fake `EventBus` and assert on transition outcomes with zero real database involved. A state-machine bug here (e.g. accidentally allowing `sent → rejected`, or breaking the `rejected`-is-a-dead-end invariant) is exactly the kind of defect that's cheap to catch with a unit test and expensive to catch after a real mission gets stuck or double-processed in production.

**Second-highest value:** `lib/services/company-service.ts::findOrCreateCompany()` and `normalizeWebsiteUrl()` — the URL-normalization logic in particular is the kind of string-manipulation code that silently drifts wrong (what happens to a URL with a trailing query string? a `www.` prefix? mixed case?) without a test pinning down its exact behavior.

**Not yet worth testing:** anything that's pure plumbing with no branching (most repository functions), and nothing agent-related, since no agents exist yet.

## Commit conventions observed so far

One large, thoroughly-described commit per sprint: `9b989ed` ("Sprint 1: Foundation — scaffold, Supabase schema, mission workflow engine, auth, Mission Control dashboard, new mission flow") and `0a3a5f0` ("Sprint 2: mission state machine, multi-tenant orgs, event bus, decision intelligence + memory vault schema"). Each summary line names every major subsystem touched, not just a vague "sprint 2 work." This squash-per-sprint pattern has worked because the team size (effectively one contributor/agent per sprint so far) doesn't create merge-conflict pressure — revisit this convention (smaller, more frequent commits; a PR-per-feature model) once more than one person or agent is committing concurrently within a sprint, since a single sprint-sized commit becomes much harder to review or bisect at that point.

## Documentation-first policy

Every sprint updates `docs/MASTER_BLUEPRINT.md`, `docs/ARCHITECTURE_DECISIONS.md`, and `docs/SPRINT_STATUS.md` as part of the sprint's own deliverables — not as an afterthought written once the code is already "done" and forgotten about. Sprint 2's migrations and workflow code demonstrate this in miniature: nearly every migration file and the core workflow/event-bus modules carry substantial doc comments explaining **why** a decision was made, not just what the code does (e.g. `0003_mission_state_machine.sql`'s comment on why `deployment` folds into `qa`, `event-bus.ts`'s comment on why the in-process fan-out isn't durable and what should replace it). Continue this: a migration, service, or architectural change that ships without an explanatory comment, and a sprint that ships without an updated blueprint + a new ADR entry, should both be treated as incomplete — not "the code part is done, docs can follow later."

## Linting

`eslint-config-next` via `next lint`, default Next.js 14 rules, no custom rule set added yet. No pre-commit hook enforces it currently (no `husky`/`lint-staged` in `package.json`).

## Environment/config conventions

`.env.example` is kept exhaustive and current — every variable any current or near-future integration needs is listed, with a comment noting whether it's live or a placeholder for a future sprint (see `docs/08-Integrations.md`). No real secret has ever been committed; this discipline should hold as more integrations are added.
