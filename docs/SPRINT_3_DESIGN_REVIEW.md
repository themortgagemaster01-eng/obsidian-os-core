# Sprint 3 Design Review — Opportunity Intelligence

**Status:** Design only. Nothing in this document has been implemented. No Sprint 3 code has been written. This exists to be reviewed and explicitly approved before any implementation begins, per the Founder Directive's standing process: every customer-facing sprint gets a lightweight design review before code.

**Revision note (v2).** This version incorporates an external architecture review of v1 (conditionally approved, four required refinements): splitting the Analysis Service from a new Opportunity Scoring Service; adding an Opportunity Report Service so report assembly isn't implicit UI logic; explicitly documenting raw/normalized/presentation as three distinct data layers; and mandating asynchronous execution rather than leaving it as an open question. It also adds a v1 deterministic scoring formula (flagging a real gap in it rather than papering over it), a "Business Opportunity" section on the report, a "Top Opportunities" checklist in the wireframe, and renames the milestone itself from "Business URL Analysis" to **Opportunity Intelligence** — the product identifies business opportunities; website analysis is an input to that, not the output. Sections below are rewritten in place rather than appended as a diff, so this document reads as one coherent v2, not a patch on top of a patch.

**Scope, restated exactly:** a user pastes a business URL. The system performs a website crawl, mobile analysis, SEO analysis, accessibility analysis, Lighthouse analysis, technology detection, opportunity scoring, and screenshot capture, and produces an Opportunity Report — a polished report that could be shown to a customer, identifying the business opportunity a redesign represents, not just a technical audit. Website generation (Sprint 4), proposals (Sprint 5), email drafts (Sprint 6), and the Approval Queue (Sprint 7) are explicitly out of scope. Nothing in this sprint sends anything to anyone.

---

## 1. Architecture

**New subsystem: the Analysis Engine**, split into three distinct services per the architecture review — each with one job, evolving independently, rather than one service doing orchestration, judgment, and presentation assembly at once:

- **`lib/services/analysis-service.ts`** — orchestrates the adapters and produces **raw + normalized analysis results**. This is the only service that talks to `lib/adapters/`. It does not compute a score and does not know what a report looks like.
- **`lib/services/opportunity-scoring-service.ts`** (new, split out of analysis-service per the review) — takes normalized analysis as input and computes the **opportunity score** (§8). This is business judgment, not orchestration — it has no knowledge of adapters, HTTP, or the database, only of the normalized shape it scores.
- **`lib/services/opportunity-report-service.ts`** (new, per the review) — takes a `website_analyses` record (raw + normalized data + score) and produces a structured **`OpportunityReport`** object (§7). The UI renders this object; it does not assemble it. This matters beyond Sprint 3: the same `OpportunityReport` object is the intended input to a future PDF export (Sprint 5's proposal work will need exactly this kind of report-shaped data) — if assembly logic lived in a React component, that reuse wouldn't be possible without duplicating it.

A new `lib/adapters/` directory (net-new — doesn't exist yet) holds one adapter per third-party analysis capability, per `docs/MASTER_BLUEPRINT.md` §1's Architecture Principle 4 ("third-party APIs are isolated through adapters"). Proposed adapters, each a narrow interface with one real implementation and no leakage of vendor-specific types past its own boundary:

- `crawl-adapter.ts` — fetches the target URL and its immediate structure (pages, links, basic markup).
- `mobile-analysis-adapter.ts` — mobile-friendliness signals.
- `seo-adapter.ts` — SEO signals (meta tags, headings, structured data, etc.).
- `accessibility-adapter.ts` — a11y audit (likely axe-core under the hood).
- `lighthouse-adapter.ts` — performance/accessibility/best-practices/SEO scores.
- `tech-detection-adapter.ts` — technology stack fingerprinting.
- `screenshot-adapter.ts` — full-page and above-fold screenshot capture, written to Supabase Storage.

`analysis-service.ts` calls these adapters, in the order above (screenshot can run in parallel with the rest — it doesn't depend on other results), normalizes each adapter's output into a consistent per-dimension shape (§3), and persists the result. It hands off to `opportunity-scoring-service.ts` once normalization is done; it never computes the score itself.

Per Architecture Principle 1 (Mission Engine owns workflows), none of these three services mutates `missions.state` directly — `analysis-service.ts` calls `transitionMissionState()` (`lib/workflow/mission-workflow.ts`) at the two points that matter: entering `analyzing` when the pipeline starts, and (see §10 below) intentionally *not* auto-advancing past `analyzing` when it finishes, for the same reason ADR-005 folded SEO/Performance/Deployment sub-checks into the single `qa` state rather than giving each one its own top-level state — the analysis dimensions in this sprint are sub-activities of one macro state, not new pipeline stages.

Per Architecture Principle 5 (every workflow emits events), each adapter's completion is a published `DomainEvent` (§9 below), not a silent write.

## 2. Execution model — asynchronous, mandatory (resolves former Open Question 1 / Risk 1)

**Decided, not left open: analysis never runs synchronously inside the triggering request. Lighthouse execution in particular is never invoked inline in a Route Handler.** v1 of this document left this as the single highest-leverage open question; the review's instruction was direct — decide it, don't defer it again.

**Flow:** Mission Created → Analysis Job Created → Worker Executes → Report Ready.

- `POST /api/missions/:id/analyze` creates the `website_analyses` row with `status = 'pending'` and returns immediately (`202 Accepted` with the row's id) — it does not wait for analysis to run.
- The actual work — running all seven adapters, normalizing, scoring, assembling — happens in a separate execution context, invoked but not awaited by the triggering request: for v1, a fire-and-forget invocation of a dedicated background Route Handler (or platform-native background function, depending on the hosting target) is the specified mechanism. It flips the row to `status = 'running'`, does the work, and ends at `'complete'` or `'failed'`.
- The client (the `/missions/[id]` report page, §6) learns the result via `GET /api/missions/:id/analysis` polling, or a Supabase Realtime subscription to the row — either is a legitimate v1 implementation choice, not specified further here since it's a client-side detail, not an architectural one.

**This is explicitly a lightweight v1 mechanism, not the full job-runner platform `docs/MISSION_ENGINE.md` §6 describes as unbuilt** — no retry policy, no distributed queue, no worker pool, no cross-process durability guarantee beyond what the background function's own platform provides. It is the minimum change that gets a 10–30+ second, resource-heavy pipeline off the synchronous request path, sized to this one pipeline's actual need rather than building general-purpose job infrastructure speculatively. `docs/MISSION_ENGINE.md` §6's broader gap remains open for whenever a second, unrelated workload needs the same thing — this section does not claim to close it.

## 3. Data layers: raw, normalized, and presentation are three distinct things

Per the architecture review: this is not "adapter output goes in a jsonb column," it's three conceptually distinct layers, each owned by a different service (§1), and each design decision below should be understood as belonging to exactly one of them:

1. **Raw Analysis** — exactly what each adapter returns, unmodified. Raw Lighthouse JSON, raw crawl output, raw accessibility-audit output. Vendor-shaped, not guaranteed stable across adapter/library upgrades, stored as-is (§4's `*_result`/`*_findings jsonb` columns). Nothing outside `analysis-service.ts` should ever read this layer directly.
2. **Normalized Analysis** — `analysis-service.ts`'s output: a consistent, per-dimension shape (a 0–100 score plus a short structured findings list, for every dimension) that no longer varies by which vendor or library produced it. This is what `opportunity-scoring-service.ts` consumes, and it's what `website_analyses`' named numeric columns (`mobile_score`, `seo_score`, `lighthouse_performance`, etc., §4) represent. If a future sprint swaps the Lighthouse adapter for a different tool, the normalized shape is the contract that shouldn't need to change.
3. **Opportunity Report (presentation)** — `opportunity-report-service.ts`'s output, the `OpportunityReport` object (§7): executive-summary-level, customer-presentable, business-framed. This is the *only* layer the UI (§5) or a future PDF export renders. It is derived from normalized analysis plus the score, never from raw analysis directly.

## 4. Database changes

**New migration `supabase/migrations/0007_website_analysis.sql`:**

New table `website_analyses` — one row per analysis run (versioned, not overwritten in place; see Open Question 5), and the table that carries both the Raw and Normalized layers from §3 (the Opportunity Report layer is not persisted — see the note at the end of this section):

- `id uuid primary key default gen_random_uuid()`
- `mission_id uuid not null references missions(id) on delete cascade`
- `organization_id uuid not null references organizations(id)` — denormalized, same rationale as `mission_events.organization_id` and `decisions.organization_id` (ADR-007): avoids a join to `missions` in every RLS check on what could become a high-volume table.
- `company_id uuid references companies(id)` — for future cross-mission history at the company level, matching the Memory Vault's existing pattern.
- `status text not null check (status in ('pending', 'running', 'complete', 'failed'))` — also the job-execution state for §2's async flow; there is deliberately no separate "jobs" table for v1, this column doubles as the job's status since a `website_analyses` row and its analysis job are 1:1.
- `crawl_result jsonb` — **raw layer.** Raw crawl output, flexible shape (same `jsonb`-for-unstable-shape reasoning as ADR-008).
- `mobile_score numeric`, `mobile_findings jsonb` — **normalized layer** (score) + **raw layer** (findings detail).
- `seo_score numeric`, `seo_findings jsonb` — normalized + raw, as above.
- `accessibility_score numeric`, `accessibility_findings jsonb` — normalized + raw, as above.
- `lighthouse_performance numeric`, `lighthouse_accessibility numeric`, `lighthouse_best_practices numeric`, `lighthouse_seo numeric` — **normalized layer.** Named columns, not bundled into one jsonb blob, because these four scores are exactly the kind of "expected to matter most" signal ADR-008 named columns for (they're the values a report's scorecard renders directly).
- `technology_stack jsonb` — raw/normalized boundary is thin here (detected technologies, free-form list/object) — treated as normalized since it's already the shape the report needs.
- `opportunity_score numeric` — **normalized layer output** — `opportunity-scoring-service.ts`'s computed score (§8), distinct from `decisions.opportunity_score` (which records what a *human* saw/acted on at approval time, per ADR-008 — this column is the system's output, that one is the decision record).
- `screenshot_url text` — Supabase Storage path.
- `error_message text` — populated only when `status = 'failed'`.
- `started_at timestamptz`, `completed_at timestamptz`.
- `created_at timestamptz not null default now()`.

RLS: org-scoped via `is_org_member(organization_id)`, matching every table since ADR-004 — select/insert/update/delete policies identical in shape to `decisions`' and `companies`' policies in `0005_decisions.sql` / `0006_memory_vault.sql`.

**The Opportunity Report layer is not persisted in v1** — `opportunity-report-service.ts` computes the `OpportunityReport` object on read, from a `website_analyses` row, every time the report page (§6) loads. This is a deliberate simplicity choice for v1 (no cache-invalidation problem to solve), flagged here rather than silently decided: a future sprint's PDF export or repeated-view performance needs may want to persist a generated report (e.g. a `report_json` column, or a separate table), at which point this decision should be revisited explicitly, not retrofitted quietly.

**New Supabase Storage bucket** for screenshots. `docs/08-Integrations.md` currently states Storage is "provisioned as a backend capability but has zero usage in the codebase" — this is the first real consumer. Needs its own bucket-level access policy (org-scoped read, service-role-only write) — not yet designed in detail; see Open Question 6.

**No changes to `missions.state`'s CHECK constraint** — the existing `analyzing` state is reused as-is (§10).

## 5. API changes

- **`POST /api/missions/:id/analyze`** (new Route Handler) — creates the `website_analyses` row at `status = 'pending'` and triggers the async worker (§2); returns `202 Accepted` immediately, it does not wait for analysis to finish. Kept separate from `POST /api/missions` (mission creation) rather than folded into it, so a failed or interrupted analysis can be retried without recreating the mission/company records. The New Mission client flow calls this immediately after a successful `POST /api/missions`, so the user experience is still "paste a URL, get an analysis" in one gesture — the two-call shape is an internal retry-safety seam, not a user-facing step.
- **`GET /api/missions/:id/analysis`** (new Route Handler) — returns the current `website_analyses` row (or "not started") for a mission, and — once `status = 'complete'` — the assembled `OpportunityReport` object from `opportunity-report-service.ts`. Powers polling per §2.
- **`POST /api/missions` (existing)** — unchanged in contract. Still just creates the mission + resolves the company via `findOrCreateCompany()`.

Both new endpoints follow the existing contract conventions in `docs/07-API.md` (auth via the session cookie, org-scoped, JSON in/out) — no new auth model needed.

## 6. UI: the Opportunity Report

**Route:** `app/missions/[id]/page.tsx` (new — doesn't exist yet; today a created mission has no dedicated detail page, only its row in the Mission Control list). The New Mission dialog redirects here immediately after creation. **The page renders the `OpportunityReport` object returned by the API — it does not assemble report content itself**, per §1's service split.

**Three states the page renders, all using the existing dark-mode glass/graphite/navy language (`docs/09-UI-Design-System.md`) rather than a new visual style:**

**In progress** (`website_analyses.status` in `pending`/`running`): a loading view naming each of the seven analysis dimensions with a per-dimension pending/running/done indicator as events land — not a single opaque spinner, since the whole point of this report is to feel premium and legible, not like a black box.

**Complete** (`status = 'complete'`): the `OpportunityReport` rendered in full —
- Header: business name, URL, favicon/screenshot thumbnail.
- A large, prominent overall **Opportunity Score** (0–100) with a short qualitative label (e.g. "Strong Opportunity"), from the report's `scores` field.
- A **"Top Opportunities" checklist** paired with the score (per the review's wireframe note) — a short, scannable list such as Mobile Experience, SEO, Accessibility, Modern Design, Conversion, each flagged as an opportunity or already-strong — so the report reads as *actionable*, not just diagnostic, at the point where a reader's eye lands first. Sourced from the report's `recommendations` field.
- A scorecard grid: Mobile, SEO, Accessibility, and the four Lighthouse sub-scores, each with its number and a 2–3 line plain-English summary of what was found — from `findings`, not raw tool output.
- A **"Business Opportunity"** section (new, per the review), separate from the technical findings above and answering *why should I call them* rather than *what's wrong*: Estimated Design Impact, Estimated Customer Experience Impact, Estimated Local SEO Impact, Estimated Lead Generation Impact — framed as business value (e.g. "a modernized homepage typically improves first-impression trust for local service businesses"), not marketing copy, and explicitly derived from the same underlying scores rather than invented independently. Sourced from a new `businessOpportunity` field on the report object (§7 extends the object's shape to include it, beyond the four fields originally specified, flagged here as a deliberate extension not a silent scope change).
- A **Technology Stack** row of chips (detected CMS, frameworks, hosting, etc.).
- The full-page **screenshot**, embedded.
- The report's `summary` field, synthesizing the above into agency-pitch language (this is the part that makes it feel like a report a human prepared, not a tool dump).

**Failed** (`status = 'failed'`): a plain, honest error state with a retry action that re-calls `POST /api/missions/:id/analyze` — not a silent hang (see Risk 2).

Mission Control's existing list/stat cards are unchanged in this sprint beyond linking each row to its new `/missions/[id]` detail page.

## 7. The `OpportunityReport` object

`opportunity-report-service.ts`'s sole output, and the only shape the UI (§6) is allowed to render. Fields:

- **`summary`** — a short, human-readable narrative synthesizing the findings (the "what we found" prose, §6).
- **`findings`** — per-dimension technical findings in plain English, derived from Normalized Analysis (§3), not raw adapter output.
- **`scores`** — the opportunity score plus each per-dimension score, structured for the scorecard grid and the Top Opportunities checklist (§6).
- **`recommendations`** — the "Top Opportunities" checklist items (§6): which dimensions represent the strongest opportunity to lead a pitch with.
- **`businessOpportunity`** — (added in this revision, beyond the four fields originally specified) the four estimated-impact statements for the Business Opportunity section (§6): Estimated Design Impact, Estimated Customer Experience Impact, Estimated Local SEO Impact, Estimated Lead Generation Impact.

This object's shape is intentionally the thing a future PDF export (Sprint 5+) should be able to consume without modification — that reuse is the reason this is a service-owned object and not JSX.

## 8. Opportunity score formula — v1, deterministic

Per the review: a deterministic weighted average, not an AI/LLM-based judgment, for v1. Explicit and auditable, not a black box:

| Signal | Weight |
|---|---|
| Mobile | 20% |
| Performance | 20% |
| Accessibility | 15% |
| SEO | 20% |
| Visual Quality | 15% |
| Calls To Action | 10% |

**This formula is not fully implementable with the current adapter set, and that gap is flagged deliberately rather than resolved here** — see Open Question 4. Mobile, Performance, Accessibility, and SEO each map cleanly to an existing planned adapter (§1). **Visual Quality and Calls To Action do not** — nothing in the seven adapters proposed in §1 produces either signal. This document does not invent an eighth adapter or a data source for them; that's a follow-up decision, not something to improvise into the formula silently.

## 9. Mission Engine integration

**State used:** the existing `analyzing` state, already defined in the 11-state machine (`lib/workflow/mission-state.ts`) — no new state is added. `createMission()` already lands a mission at `discovered`; the New Mission flow's call to `POST /api/missions/:id/analyze` is what calls `transitionMissionState(id, 'analyzing')` to advance it. When analysis completes, **the mission intentionally stays at `analyzing`** — it does not auto-advance to `researching`, because no Research Engine exists yet to justify that transition (advancing to a state nothing acts on would misrepresent the mission's real position, per `docs/MISSION_ENGINE.md`'s built-vs-stubbed honesty standard). A human (or a later sprint's agent) decides when a mission with a complete analysis moves forward.

**Events emitted** (`lib/events/types.ts`): this sprint is the **first real publisher** of two event types that already exist in the catalog with unpublished placeholder payloads — `WebsiteScanned` (`{ websiteUrl, findings? }`) and `SEOComplete` (`{ score?, issues? }`). Both payload interfaces need expanding to carry this sprint's actual normalized data (§3) — crawl + mobile + accessibility + lighthouse + tech-detection results for `WebsiteScanned`; real score/issues for `SEOComplete` — expanding an existing type rather than inventing a parallel one, consistent with ADR-010's precedent of reconciling with existing vocabulary before adding new concepts. One genuinely new event type is needed: **`AnalysisFailed`**, since none of the current 10 types represent a failure — every existing event assumes success. This requires a small addition to `mission_events.event_type`'s CHECK constraint (`supabase/migrations/0004_event_bus.sql` established the pattern; this would be `0007`'s job alongside the new table).

Every adapter's completion publishes through `EventBus.publish()` (`lib/events/event-bus.ts`) exactly as `docs/MISSION_ENGINE.md` §10 describes as the two sanctioned integration surfaces — this sprint uses both (`transitionMissionState()` once, `publish()` repeatedly). Per §2, it no longer needs to "survive without" a job-runner/retry policy by accident — the async execution model is now a specified decision, not an unaddressed gap.

## 10. Why `analyzing` doesn't advance automatically

Worth stating as its own point since it's a real design choice, not an oversight: the alternative (auto-advance to `researching` on completion) was considered and rejected. `researching` implies a Research Engine is acting on the mission, and none exists yet — auto-advancing would make Mission Control lie about a mission's real state, which is exactly what `docs/MISSION_ENGINE.md`'s "reality" framing throughout this project has been careful never to do. Sprint 3 mission ends its life at `analyzing`, complete, with a full Opportunity Report attached — that is itself the customer-visible deliverable, per the Founder Directive.

## 11. Acceptance criteria

- A user can paste a business URL into the New Mission flow and, without any further manual step, land on a report page for that mission.
- All seven analysis dimensions (crawl, mobile, SEO, accessibility, Lighthouse, technology detection, screenshot) produce real output from real analysis — no dimension is stubbed or hardcoded.
- Analysis executes asynchronously per §2 — no code path runs Lighthouse or any adapter synchronously inside a Route Handler's response cycle.
- `analysis-service.ts`, `opportunity-scoring-service.ts`, and `opportunity-report-service.ts` exist as three separate modules with the boundaries described in §1 — scoring logic does not live in the analysis service, and report-assembly logic does not live in a React component.
- An opportunity score is computed by `opportunity-scoring-service.ts` from real normalized analysis output, using the §8 formula, not a placeholder constant.
- The rendered report is presentable to a customer as-is — meets the design system, not a debug dump of raw JSON — and includes both the technical findings and the Business Opportunity section (§6).
- Every analysis dimension's completion (and failure) is recorded on the mission's event timeline and visible via `mission_events`.
- A failed analysis is visible to the user as a failure, with a retry path — never a silent, permanent spinner.
- Re-running analysis on the same mission does not create a duplicate `companies` row or corrupt `total_missions_count` (exercises `findOrCreateCompany()`'s existing idempotency).
- No code path in this sprint sends an email, publishes a live site, or contacts the business in any way — this sprint only ever reads the target's existing public website.
- `docs/MISSION_ENGINE.md`, `docs/ARCHITECTURE_DECISIONS.md` (new ADR for the event-type/state/execution-model decisions above), and `docs/SPRINT_STATUS.md` are updated in the same change, per Architecture Principle 7.

## 12. Risks

1. **Resource cost of headless browser / Lighthouse execution.** Whatever runs Lighthouse and screenshot capture is meaningfully heavier than a typical serverless request; the hosting/runtime choice for the §2 background worker has real cost implications that haven't been priced out.
2. **No retry/failure policy exists** (`docs/MISSION_ENGINE.md` §5). A single failing adapter (e.g., a site that blocks the crawler) could leave a mission stuck at `analyzing` with a confusing partial state if this isn't handled deliberately per-adapter. The async execution model (§2) makes this more, not less, important — a background worker that dies silently is worse than a synchronous call that at least surfaces an error to the caller.
3. **No rate limiting on the analysis trigger endpoint**, compounding an existing known gap (`POST /api/missions` already lacks rate limiting per `docs/SPRINT_STATUS.md`). An endpoint that fans out to multiple potentially-metered third-party services is a real cost-control exposure if left unprotected.
4. **Sites that actively resist analysis** (bot-blocking, CAPTCHA walls, robots.txt disallow) need a defined, honest failure mode rather than an unhandled crash — this is a near-certainty at some rate once real URLs are tried, not an edge case.
5. **The v1 scoring formula (§8) cannot be fully computed** — two of its six weighted inputs (Visual Quality, Calls To Action, 25% of the formula's weight combined) have no data source in the current design. Shipping the formula as specified without resolving Open Question 4 first would mean either silently omitting 25% of the intended weighting or inventing ungrounded values for it — neither is acceptable without an explicit decision.

*(The former Risk 1 — synchronous execution / no job runner — is resolved by §2 and is no longer an open risk in this revision.)*

## 13. Open questions

1. **Visual Quality and Calls To Action have no data source.** The §8 formula names them as 15% and 10% of the opportunity score respectively, but no adapter in §1 produces either signal, and this document deliberately does not invent one. Does Visual Quality come from a future dedicated adapter (e.g. an aesthetic-scoring model or heuristic), get derived from existing Lighthouse/crawl data, or get dropped from v1's formula with the remaining four signals reweighted to 100%? Same question for Calls To Action (crawl-derived heuristic — presence/prominence of a CTA element — is plausible but unspecified). This needs a decision before `opportunity-scoring-service.ts` can be implemented as specified.
2. **Which concrete third-party services or libraries** for crawl, mobile analysis, SEO, accessibility, Lighthouse, tech detection, and screenshots — e.g. self-hosted headless Chrome + Lighthouse vs. a hosted API (Google PageSpeed Insights, a commercial screenshot API, etc.)? Cost and reliability tradeoffs need a decision; the async execution model (§2) is settled independent of this choice, but the choice still affects background-worker runtime requirements.
3. **Event granularity.** Does one expanded `WebsiteScanned` event carry all seven dimensions' results, or do some dimensions deserve their own event type for a more legible timeline? Leaning toward one bundled event per §9's reasoning, but worth confirming before the schema/type changes are written.
4. **Is a stuck `analyzing` mission with an `AnalysisFailed` event sufficient failure signaling**, or does the state machine need a genuine failure state? (`rejected` is documented as a human decision, not a system failure — using it for a crawl error would be a misuse of an existing state's meaning.)
5. **Versioning `website_analyses` rows.** Re-running analysis on a mission: overwrite the existing row, or insert a new one and keep history? This design assumes the latter (matching the Memory Vault's accumulate-history philosophy) but it changes the read query shape (latest-by-mission vs. one-to-one) and should be confirmed.
6. **Storage bucket policy details** for screenshots — public read vs. signed URLs, retention period, size limits — not designed here, needed before `0007`'s migration is finalized.
7. **Should the `OpportunityReport` object be persisted** (e.g. a cached `report_json` column) once a PDF export or repeated-view performance need exists, rather than recomputed on every read as in v1 (§4)? Not needed for Sprint 3, flagged for whenever that consumer arrives.

---

Waiting for explicit approval before any of this is implemented.
