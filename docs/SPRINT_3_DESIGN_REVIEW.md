# Sprint 3 Design Review — Business URL Analysis

**Status:** Design only. Nothing in this document has been implemented. No Sprint 3 code has been written. This exists to be reviewed and explicitly approved before any implementation begins, per the Founder Directive's standing process: every customer-facing sprint gets a lightweight design review before code.

**Scope, restated exactly:** a user pastes a business URL. The system performs a website crawl, mobile analysis, SEO analysis, accessibility analysis, Lighthouse analysis, technology detection, opportunity scoring, and screenshot capture, and produces a Premium Opportunity Report — a polished report that could be shown to a customer. Website generation (Sprint 4), proposals (Sprint 5), email drafts (Sprint 6), and the Approval Queue (Sprint 7) are explicitly out of scope. Nothing in this sprint sends anything to anyone.

---

## 1. Architecture

**New subsystem: the Analysis Engine**, living at `lib/services/analysis-service.ts` (orchestration) plus a new `lib/adapters/` directory (net-new — doesn't exist yet) holding one adapter per third-party analysis capability, per `docs/MASTER_BLUEPRINT.md` §1's Architecture Principle 4 ("third-party APIs are isolated through adapters"). Proposed adapters, each a narrow interface with one real implementation and no leakage of vendor-specific types past its own boundary:

- `crawl-adapter.ts` — fetches the target URL and its immediate structure (pages, links, basic markup).
- `mobile-analysis-adapter.ts` — mobile-friendliness signals.
- `seo-adapter.ts` — SEO signals (meta tags, headings, structured data, etc.).
- `accessibility-adapter.ts` — a11y audit (likely axe-core under the hood).
- `lighthouse-adapter.ts` — performance/accessibility/best-practices/SEO scores.
- `tech-detection-adapter.ts` — technology stack fingerprinting.
- `screenshot-adapter.ts` — full-page and above-fold screenshot capture, written to Supabase Storage.

`analysis-service.ts` is the only thing that calls these adapters, in the order above (screenshot can run in parallel with the rest — it doesn't depend on other results). It is also the only thing that computes the **opportunity score** from the combined results — scoring logic is business logic, not a third-party capability, so it does not live behind an adapter.

Per Architecture Principle 1 (Mission Engine owns workflows), `analysis-service.ts` does not mutate `missions.state` directly — it calls `transitionMissionState()` (`lib/workflow/mission-workflow.ts`) at the two points that matter: entering `analyzing` when the pipeline starts, and (see §6 below) intentionally *not* auto-advancing past `analyzing` when it finishes, for the same reason ADR-005 folded SEO/Performance/Deployment sub-checks into the single `qa` state rather than giving each one its own top-level state — the analysis dimensions in this sprint are sub-activities of one macro state, not new pipeline stages.

Per Architecture Principle 5 (every workflow emits events), each adapter's completion is a published `DomainEvent` (§5 below), not a silent write.

## 2. Database changes

**New migration `supabase/migrations/0007_website_analysis.sql`:**

New table `website_analyses` — one row per analysis run (versioned, not overwritten in place; see Open Question 6):

- `id uuid primary key default gen_random_uuid()`
- `mission_id uuid not null references missions(id) on delete cascade`
- `organization_id uuid not null references organizations(id)` — denormalized, same rationale as `mission_events.organization_id` and `decisions.organization_id` (ADR-007): avoids a join to `missions` in every RLS check on what could become a high-volume table.
- `company_id uuid references companies(id)` — for future cross-mission history at the company level, matching the Memory Vault's existing pattern.
- `status text not null check (status in ('pending', 'running', 'complete', 'failed'))`
- `crawl_result jsonb` — raw crawl output, flexible shape (same `jsonb`-for-unstable-shape reasoning as ADR-008).
- `mobile_score numeric`, `mobile_findings jsonb`
- `seo_score numeric`, `seo_findings jsonb`
- `accessibility_score numeric`, `accessibility_findings jsonb`
- `lighthouse_performance numeric`, `lighthouse_accessibility numeric`, `lighthouse_best_practices numeric`, `lighthouse_seo numeric` — named columns, not bundled into one jsonb blob, because these four scores are exactly the kind of "expected to matter most" signal ADR-008 named columns for (they're the values a report's scorecard renders directly).
- `technology_stack jsonb` — detected technologies, free-form list/object.
- `opportunity_score numeric` — the Analysis Engine's own computed score, distinct from `decisions.opportunity_score` (which records what a *human* saw/acted on at approval time, per ADR-008 — this column is the system's output, that one is the decision record).
- `screenshot_url text` — Supabase Storage path.
- `error_message text` — populated only when `status = 'failed'`.
- `started_at timestamptz`, `completed_at timestamptz`.
- `created_at timestamptz not null default now()`.

RLS: org-scoped via `is_org_member(organization_id)`, matching every table since ADR-004 — select/insert/update/delete policies identical in shape to `decisions`' and `companies`' policies in `0005_decisions.sql` / `0006_memory_vault.sql`.

**New Supabase Storage bucket** for screenshots. `docs/08-Integrations.md` currently states Storage is "provisioned as a backend capability but has zero usage in the codebase" — this is the first real consumer. Needs its own bucket-level access policy (org-scoped read, service-role-only write) — not yet designed in detail; see Open Question 7.

**No changes to `missions.state`'s CHECK constraint** — the existing `analyzing` state is reused as-is (§6).

## 3. API changes

- **`POST /api/missions/:id/analyze`** (new Route Handler) — triggers analysis for an existing mission. Kept separate from `POST /api/missions` (mission creation) rather than folded into it, so a failed or interrupted analysis can be retried without recreating the mission/company records. The New Mission client flow calls this immediately after a successful `POST /api/missions`, so the user experience is still "paste a URL, get an analysis" in one gesture — the two-call shape is an internal retry-safety seam, not a user-facing step.
- **`GET /api/missions/:id/analysis`** (new Route Handler) — returns the current `website_analyses` row (or "not started") for a mission. Powers polling if the UI goes that route (see Open Question 1).
- **`POST /api/missions` (existing)** — unchanged in contract. Still just creates the mission + resolves the company via `findOrCreateCompany()`.

Both new endpoints follow the existing contract conventions in `docs/07-API.md` (auth via the session cookie, org-scoped, JSON in/out) — no new auth model needed.

## 4. UI: the Premium Opportunity Report

**Route:** `app/missions/[id]/page.tsx` (new — doesn't exist yet; today a created mission has no dedicated detail page, only its row in the Mission Control list). The New Mission dialog redirects here immediately after creation.

**Two states the page renders, both using the existing dark-mode glass/graphite/navy language (`docs/09-UI-Design-System.md`) rather than a new visual style:**

**In progress** (mission at `analyzing`, `website_analyses.status` in `pending`/`running`): a loading view naming each of the seven analysis dimensions with a per-dimension pending/running/done indicator as events land — not a single opaque spinner, since the whole point of this report is to feel premium and legible, not like a black box.

**Complete** (`website_analyses.status = 'complete'`): the report itself —
- Header: business name, URL, favicon/screenshot thumbnail.
- A large, prominent overall **Opportunity Score** (0–100) with a short qualitative label (e.g. "Strong Opportunity").
- A scorecard grid: Mobile, SEO, Accessibility, and the four Lighthouse sub-scores, each with its number and a 2–3 line plain-English summary of what was found — not raw tool output.
- A **Technology Stack** row of chips (detected CMS, frameworks, hosting, etc.).
- The full-page **screenshot**, embedded.
- A short narrative "what we found" section synthesizing the above into agency-pitch language (this is the part that makes it feel like a report a human prepared, not a tool dump).

**Failed** (`website_analyses.status = 'failed'`): a plain, honest error state with a retry action that re-calls `POST /api/missions/:id/analyze` — not a silent hang (see Risk 2).

Mission Control's existing list/stat cards are unchanged in this sprint beyond linking each row to its new `/missions/[id]` detail page.

## 5. Mission Engine integration

**State used:** the existing `analyzing` state, already defined in the 11-state machine (`lib/workflow/mission-state.ts`) — no new state is added. `createMission()` already lands a mission at `discovered`; the New Mission flow's call to `POST /api/missions/:id/analyze` is what calls `transitionMissionState(id, 'analyzing')` to advance it. When analysis completes, **the mission intentionally stays at `analyzing`** — it does not auto-advance to `researching`, because no Research Engine exists yet to justify that transition (advancing to a state nothing acts on would misrepresent the mission's real position, per `docs/MISSION_ENGINE.md`'s built-vs-stubbed honesty standard). A human (or a later sprint's agent) decides when a mission with a complete analysis moves forward.

**Events emitted** (`lib/events/types.ts`): this sprint is the **first real publisher** of two event types that already exist in the catalog with unpublished placeholder payloads — `WebsiteScanned` (`{ websiteUrl, findings? }`) and `SEOComplete` (`{ score?, issues? }`). Both payload interfaces need expanding to carry this sprint's actual data (crawl + mobile + accessibility + lighthouse + tech-detection results for `WebsiteScanned`; real score/issues for `SEOComplete`) — expanding an existing type rather than inventing a parallel one, consistent with ADR-010's precedent of reconciling with existing vocabulary before adding new concepts. One genuinely new event type is needed: **`AnalysisFailed`**, since none of the current 10 types represent a failure — every existing event assumes success. This requires a small addition to `mission_events.event_type`'s CHECK constraint (`supabase/migrations/0004_event_bus.sql` established the pattern; this would be `0007`'s job alongside the new table).

Every adapter's completion publishes through `EventBus.publish()` (`lib/events/event-bus.ts`) exactly as `docs/MISSION_ENGINE.md` §10 describes as the two sanctioned integration surfaces — this sprint uses both (`transitionMissionState()` once, `publish()` repeatedly) and needs neither of the two gaps `MISSION_ENGINE.md` §5/§6 flag as unbuilt (retry policy, job runner) to *exist* in order to ship, but does need a decision about how it survives without them (see Risk 1 and Open Question 1) — it cannot simply ignore that those gaps exist.

## 6. Why `analyzing` doesn't advance automatically

Worth stating as its own point since it's a real design choice, not an oversight: the alternative (auto-advance to `researching` on completion) was considered and rejected. `researching` implies a Research Engine is acting on the mission, and none exists yet — auto-advancing would make Mission Control lie about a mission's real state, which is exactly what `docs/MISSION_ENGINE.md`'s "reality" framing throughout this project has been careful never to do. Sprint 3 mission ends its life at `analyzing`, complete, with a full report attached — that is itself the customer-visible deliverable, per the Founder Directive.

## 7. Acceptance criteria

- A user can paste a business URL into the New Mission flow and, without any further manual step, land on a report page for that mission.
- All seven analysis dimensions (crawl, mobile, SEO, accessibility, Lighthouse, technology detection, screenshot) produce real output from real analysis — no dimension is stubbed or hardcoded.
- An opportunity score is computed from real analysis output, not a placeholder constant.
- The report is presentable to a customer as-is — meets the design system, not a debug dump of raw JSON.
- Every analysis dimension's completion (and failure) is recorded on the mission's event timeline and visible via `mission_events`.
- A failed analysis is visible to the user as a failure, with a retry path — never a silent, permanent spinner.
- Re-running analysis on the same mission does not create a duplicate `companies` row or corrupt `total_missions_count` (exercises `findOrCreateCompany()`'s existing idempotency).
- No code path in this sprint sends an email, publishes a live site, or contacts the business in any way — this sprint only ever reads the target's existing public website.
- `docs/MISSION_ENGINE.md`, `docs/ARCHITECTURE_DECISIONS.md` (new ADR for the event-type/state decisions above), and `docs/SPRINT_STATUS.md` are updated in the same change, per Architecture Principle 7.

## 8. Risks

1. **No job runner exists** (`docs/MISSION_ENGINE.md` §6). Lighthouse analysis in particular commonly takes 10–30+ seconds; a synchronous Route Handler risks serverless function timeouts depending on hosting plan. This sprint cannot silently inherit that gap — it needs an explicit, even if lightweight, answer (see Open Question 1) before implementation, not a plan to "figure it out while coding."
2. **No retry/failure policy exists** (`docs/MISSION_ENGINE.md` §5). A single failing adapter (e.g., a site that blocks the crawler) could leave a mission stuck at `analyzing` with a confusing partial state if this isn't handled deliberately per-adapter.
3. **Resource cost of headless browser / Lighthouse execution.** Whatever runs Lighthouse and screenshot capture is meaningfully heavier than a typical serverless request; the hosting/runtime choice has real cost implications that haven't been priced out.
4. **No rate limiting on the analysis trigger endpoint**, compounding an existing known gap (`POST /api/missions` already lacks rate limiting per `docs/SPRINT_STATUS.md`). An endpoint that fans out to multiple potentially-metered third-party services is a real cost-control exposure if left unprotected.
5. **Sites that actively resist analysis** (bot-blocking, CAPTCHA walls, robots.txt disallow) need a defined, honest failure mode rather than an unhandled crash — this is a near-certainty at some rate once real URLs are tried, not an edge case.
6. **Opportunity scoring is currently undefined.** "Opportunity scoring" is named as a requirement but no formula, weighting, or rubric exists anywhere in the docs — this is a product decision as much as an engineering one and shouldn't be improvised during implementation.

## 9. Open questions

1. **Synchronous vs. asynchronous execution.** Does analysis run inline within the triggering request (simplest, but bounded by function timeout limits), or does it need a lightweight async mechanism (e.g., a background function plus client polling or a Supabase Realtime subscription to `website_analyses`) even before a full job-runner exists? This is the single highest-leverage decision blocking implementation — recommend deciding this explicitly before writing code, not discovering the timeout limit in production.
2. **Opportunity scoring formula.** What inputs, what weights, what output range/labels? Needs founder/product input, not an engineering guess.
3. **Which concrete third-party services or libraries** for crawl, mobile analysis, SEO, accessibility, Lighthouse, tech detection, and screenshots — e.g. self-hosted headless Chrome + Lighthouse vs. a hosted API (Google PageSpeed Insights, a commercial screenshot API, etc.)? Cost, reliability, and the async-execution question (Open Question 1) are coupled — a hosted API sidesteps needing to run headless Chrome yourself, for instance.
4. **Event granularity.** Does one expanded `WebsiteScanned` event carry all seven dimensions' results, or do some dimensions deserve their own event type for a more legible timeline? Leaning toward one bundled event per §5's reasoning, but worth confirming before the schema/type changes are written.
5. **Is a stuck `analyzing` mission with an `AnalysisFailed` event sufficient failure signaling**, or does the state machine need a genuine failure state? (`rejected` is documented as a human decision, not a system failure — using it for a crawl error would be a misuse of an existing state's meaning.)
6. **Versioning `website_analyses` rows.** Re-running analysis on a mission: overwrite the existing row, or insert a new one and keep history? This design assumes the latter (matching the Memory Vault's accumulate-history philosophy) but it changes the read query shape (latest-by-mission vs. one-to-one) and should be confirmed.
7. **Storage bucket policy details** for screenshots — public read vs. signed URLs, retention period, size limits — not designed here, needed before `0007`'s migration is finalized.

---

Waiting for explicit approval before any of this is implemented.
