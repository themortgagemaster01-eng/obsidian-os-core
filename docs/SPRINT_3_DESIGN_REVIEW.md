# Sprint 3 Design Review — Opportunity Intelligence

**Status:** Design only. Nothing in this document has been implemented. No Sprint 3 code has been written. This exists to be reviewed and explicitly approved before any implementation begins, per the Founder Directive's standing process: every customer-facing sprint gets a lightweight design review before code.

**Revision note (v3).** This version incorporates a full CTO review of v2, which refines rather than reverses v2's four required changes (service split, Opportunity Report Service, layered data model, mandatory async execution — all still in force below). v3's corrections: the v1 scoring formula is cut down to five measurable categories with **no invented weights** (the previous six-category formula, including two signals with no data source, is replaced rather than merely flagged); a new **Insights** layer is inserted into the pipeline between Normalized Analysis and the Opportunity Score; a new **Evidence** section makes every report claim traceable to a specific measurement; the report's section ordering is now specified explicitly and leads with a narrative executive summary rather than the numeric score; the Business Opportunity section's fields are corrected to a new five-item list; a **Future AI Assessment** note formally scopes six qualitative signals (Visual Quality, Calls To Action, Brand Strength, Information Hierarchy, Trust Signals, Conversion Experience) out of v1 as a deliberate Phase 2 category, not a gap to quietly fill; and a new **Success Criteria** section states the qualitative bar this sprint is held to, separate from the engineering acceptance criteria. Sections are rewritten in place as one coherent v3, not appended as a diff on v2.

**Scope, restated exactly:** a user pastes a business URL. The system performs a website crawl, mobile analysis, SEO analysis, accessibility analysis, Lighthouse analysis, technology detection, opportunity scoring, and screenshot capture, and produces an Opportunity Report — a polished report that could be shown to a customer, identifying the business opportunity a redesign represents, not just a technical audit. Website generation (Sprint 4), proposals (Sprint 5), email drafts (Sprint 6), and the Approval Queue (Sprint 7) are explicitly out of scope. Nothing in this sprint sends anything to anyone.

---

## 1. Architecture

**New subsystem: the Analysis Engine**, split into four distinct services — each with one job, evolving independently:

- **`lib/services/analysis-service.ts`** — orchestrates the adapters and produces **raw + normalized analysis results**. The only service that talks to `lib/adapters/`. Does not score, does not generate insight language, does not know what a report looks like.
- **`lib/services/insight-service.ts`** (new in this revision) — takes Normalized Analysis and converts technical findings into **business-observation language**, each insight tagged with the specific measurement it came from (§10, Evidence). This is a distinct responsibility from both scoring (a number) and report assembly (a document) — it's the translation step between "what the tools measured" and "what a business owner would understand," and it's the thing that makes every later claim in the report traceable.
- **`lib/services/opportunity-scoring-service.ts`** — takes Normalized Analysis and computes the **Opportunity Score** (§8) from the five v1 categories. Business judgment, not orchestration — no knowledge of adapters, HTTP, or the database, only of the normalized shape and the insights it scores against.
- **`lib/services/opportunity-report-service.ts`** — takes a `website_analyses` record plus the Insights and the Score, and produces a structured **`OpportunityReport`** object (§7) in the exact section order specified in §6. The UI renders this object; it does not assemble it. This matters beyond Sprint 3: the same object is the intended input to a future PDF export.

A new `lib/adapters/` directory (net-new — doesn't exist yet) holds one adapter per third-party analysis capability, per `docs/MASTER_BLUEPRINT.md` §1's Architecture Principle 4 ("third-party APIs are isolated through adapters"). Proposed adapters, unchanged from prior revisions:

- `crawl-adapter.ts` — fetches the target URL and its immediate structure (pages, links, basic markup).
- `mobile-analysis-adapter.ts` — mobile-friendliness signals.
- `seo-adapter.ts` — SEO signals (meta tags, headings, structured data, etc.).
- `accessibility-adapter.ts` — a11y audit (likely axe-core under the hood).
- `lighthouse-adapter.ts` — performance/accessibility/best-practices/SEO scores.
- `tech-detection-adapter.ts` — technology stack fingerprinting.
- `screenshot-adapter.ts` — full-page and above-fold screenshot capture, written to Supabase Storage.

`analysis-service.ts` calls these adapters, in the order above (screenshot can run in parallel with the rest), normalizes each adapter's output into a consistent per-dimension shape (§3), and persists the result. It hands off to `insight-service.ts` and `opportunity-scoring-service.ts`, neither of which it depends on or calls itself.

Per Architecture Principle 1 (Mission Engine owns workflows), none of these four services mutates `missions.state` directly — `analysis-service.ts` calls `transitionMissionState()` (`lib/workflow/mission-workflow.ts`) at the two points that matter: entering `analyzing` when the pipeline starts, and (see §12 below) intentionally *not* auto-advancing past `analyzing` when it finishes.

Per Architecture Principle 5 (every workflow emits events), each adapter's completion is a published `DomainEvent` (§11 below), not a silent write.

## 2. Execution model — asynchronous, mandatory

**Decided, not left open: analysis never runs synchronously inside the triggering request.** Lighthouse execution in particular is never invoked inline in a Route Handler.

**Flow:** Mission Created → Analysis Job Created → Worker Executes → Report Ready.

- `POST /api/missions/:id/analyze` creates the `website_analyses` row with `status = 'pending'` and returns immediately (`202 Accepted` with the row's id) — it does not wait for analysis to run.
- The actual work — running all seven adapters, normalizing, generating insights, scoring, assembling — happens in a separate execution context, invoked but not awaited by the triggering request: a fire-and-forget invocation of a dedicated background Route Handler (or platform-native background function). It flips the row to `status = 'running'`, does the work, and ends at `'complete'` or `'failed'`.
- The client (the `/missions/[id]` report page, §6) learns the result via `GET /api/missions/:id/analysis` polling, or a Supabase Realtime subscription to the row.

**This is explicitly a lightweight v1 mechanism, not the full job-runner platform `docs/MISSION_ENGINE.md` §6 describes as unbuilt** — no retry policy, no distributed queue, no worker pool. It is the minimum change that gets a 10–30+ second, resource-heavy pipeline off the synchronous request path.

## 3. Data & processing pipeline

Five distinct conceptual stages, each owned by a different service (§1) — not "adapter output goes in a jsonb column":

**Raw Analysis → Normalized Analysis → Insights → Opportunity Score → Opportunity Report**

1. **Raw Analysis** — exactly what each adapter returns, unmodified. Raw Lighthouse JSON, raw crawl output, raw accessibility-audit output. Vendor-shaped, not guaranteed stable across adapter/library upgrades, stored as-is (§4's `*_result`/`*_findings jsonb` columns). Owned by `analysis-service.ts`; nothing outside it should ever read this layer directly.
2. **Normalized Analysis** — `analysis-service.ts`'s output: a consistent, per-dimension shape (a 0–100 score plus a short structured findings list, for every dimension) that no longer varies by which vendor or library produced it. This is `website_analyses`' named numeric columns (§4). If a future sprint swaps the Lighthouse adapter for a different tool, this is the contract that shouldn't need to change.
3. **Insights** — `insight-service.ts`'s output: Normalized Analysis translated into business-observation language, each insight tagged with the specific measurement that produced it (e.g. "Lighthouse Performance = 42" becomes "The website loads significantly slower than modern expectations," tagged `lighthouse_performance`). This is a new, distinct layer in this revision — not folded into report assembly, because insight generation ("what does this measurement mean in plain language") is a different kind of work than report assembly ("what order do we present things in, what's the narrative").
4. **Opportunity Score** — `opportunity-scoring-service.ts`'s output: the single 0–100 score from the five v1 categories (§8). Computed from Normalized Analysis's numeric scores directly, not from Insights' text — Insights and the Score are both downstream of Normalization and independent of each other, even though this pipeline lists Insights first; a design note rather than a silent assumption, since the ordering above is the conceptual/document order the review specified, not a literal data-dependency chain.
5. **Opportunity Report (presentation)** — `opportunity-report-service.ts`'s output, the `OpportunityReport` object (§7): executive-summary-level, customer-presentable, business-framed, assembled from Insights + Score + Normalized Analysis in the exact section order specified in §6. This is the *only* layer the UI or a future PDF export renders.

## 4. Database changes

**New migration `supabase/migrations/0007_website_analysis.sql`:**

New table `website_analyses` — **one row per analysis run. Versioned, never overwritten in place — reconfirmed explicitly here given the new layered model above:** a re-run of analysis on the same mission always inserts a new row rather than mutating an existing one, so Raw Analysis, Normalized Analysis, and everything downstream of them for a given run stay a single immutable, queryable snapshot. (Which row is "current" for a mission with multiple runs is still an open question — Open Question 4 — but "never overwrite" itself is not in question.)

This table carries the Raw and Normalized layers from §3. **Insights and the assembled `OpportunityReport` (§7) are not separately persisted in v1** — both are computed on read from a `website_analyses` row every time analysis is viewed. This carries forward the same decision v2 made for the report object, extended here to cover Insights too, since Insights are a deterministic function of Normalized Analysis with no external randomness — the same reasoning that justified not persisting the report applies equally to not persisting Insights. The one column that *is* persisted is `opportunity_score numeric` itself, since it's the field the Mission Control list/report header need without recomputing the full pipeline.

- `id uuid primary key default gen_random_uuid()`
- `mission_id uuid not null references missions(id) on delete cascade`
- `organization_id uuid not null references organizations(id)` — denormalized, same rationale as `mission_events.organization_id` and `decisions.organization_id` (ADR-007).
- `company_id uuid references companies(id)` — for future cross-mission history at the company level.
- `status text not null check (status in ('pending', 'running', 'complete', 'failed'))` — also the job-execution state for §2's async flow.
- `crawl_result jsonb` — raw layer.
- `mobile_score numeric`, `mobile_findings jsonb` — normalized + raw.
- `seo_score numeric`, `seo_findings jsonb` — normalized + raw.
- `accessibility_score numeric`, `accessibility_findings jsonb` — normalized + raw.
- `lighthouse_performance numeric`, `lighthouse_accessibility numeric`, `lighthouse_best_practices numeric`, `lighthouse_seo numeric` — normalized layer.
- `technology_stack jsonb` — normalized (feeds Technical Health, §8).
- `opportunity_score numeric` — the computed score (§8), distinct from `decisions.opportunity_score` (the human decision record, ADR-008).
- `screenshot_url text` — Supabase Storage path.
- `error_message text` — populated only when `status = 'failed'`.
- `started_at timestamptz`, `completed_at timestamptz`.
- `created_at timestamptz not null default now()`.

RLS: org-scoped via `is_org_member(organization_id)`, matching every table since ADR-004.

**New Supabase Storage bucket** for screenshots — first real consumer of Storage (`docs/08-Integrations.md`). Bucket-level access policy not yet designed; see Open Question 6.

**No changes to `missions.state`'s CHECK constraint** — the existing `analyzing` state is reused as-is (§12).

## 5. API changes

- **`POST /api/missions/:id/analyze`** — creates the `website_analyses` row at `status = 'pending'` and triggers the async worker (§2); returns `202 Accepted` immediately. Kept separate from `POST /api/missions` so a failed or interrupted analysis can be retried without recreating the mission/company records.
- **`GET /api/missions/:id/analysis`** — returns the current `website_analyses` row (or "not started"), and — once `status = 'complete'` — the assembled `OpportunityReport` object.
- **`POST /api/missions` (existing)** — unchanged in contract.

Both new endpoints follow the existing contract conventions in `docs/07-API.md` — no new auth model needed.

## 6. UI: the Opportunity Report

**Route:** `app/missions/[id]/page.tsx` (new). The New Mission dialog redirects here immediately after creation. **The page renders the `OpportunityReport` object — it does not assemble report content itself.**

**Three states, all using the existing dark-mode glass/graphite/navy language (`docs/09-UI-Design-System.md`):**

**In progress:** a loading view naming each of the seven analysis dimensions with a per-dimension pending/running/done indicator as events land.

**Complete — section order, specified explicitly (this is the correction in this revision; the score does not lead):**

1. **Business Name** — header, with URL and screenshot thumbnail, sourced directly from the mission/company record.
2. **Executive Summary** — a narrative paragraph in plain business language, not technical language and not the score. This is what the reader sees first. Example of the expected tone, for implementers: *"This business appears to have a strong local presence, but the website creates several barriers for potential customers — pages load slowly on mobile devices, and the site is difficult for search engines to fully understand, both of which likely cost this business inquiries it would otherwise get."* The score (§6.4) reinforces this narrative; it does not replace it, and it does not appear before it.
3. **Business Opportunity** — the five estimated-impact statements (§7), immediately following the narrative summary since it's still framing *why this matters*, before the reader gets to numbers.
4. **Opportunity Score** — the overall 0–100 score with its qualitative label, plus the **"Top Opportunities" checklist** (Mobile Experience, SEO, Accessibility, Modern Design, Conversion — sourced from `recommendations`) so the numeric section is immediately actionable, not just a number.
5. **Category Scorecards** — the five v1 categories (§8) individually, each with its score and its plain-English findings (from `findings`, sourced via Insights).
6. **Technology Stack** — detected CMS, frameworks, hosting, etc.
7. **Screenshot** — the full-page capture, embedded.
8. **Evidence** (§10) — the traceability table: every insight and recommendation above, linked to the specific measurement it came from.
9. **Recommendations** — the same Top Opportunities items from §6.4, expanded here with more detail than the checklist format allows.

**Failed:** a plain, honest error state with a retry action that re-calls `POST /api/missions/:id/analyze` — not a silent hang.

Mission Control's existing list/stat cards are unchanged in this sprint beyond linking each row to its new `/missions/[id]` detail page.

## 7. The `OpportunityReport` object

`opportunity-report-service.ts`'s sole output, assembled in the exact order of §6. Fields:

- **`executiveSummary`** — the narrative paragraph that leads the report (§6.2). Renamed from `summary` in the prior revision for clarity, since "summary" was ambiguous about whether it meant a technical recap or the business narrative — it's explicitly the latter.
- **`businessOpportunity`** — the five estimated-impact statements (below), for §6.3.
- **`scores`** — the overall Opportunity Score plus each of the five category scores, for §6.4 and §6.5.
- **`findings`** — per-category plain-English findings (sourced from Insights, §3), for the Category Scorecards (§6.5).
- **`technologyStack`** — detected technologies, for §6.6.
- **`evidence`** (new in this revision) — the insight/recommendation → source table, for §6.8. Each entry: the claim being made, and the specific adapter/metric it traces to.
- **`recommendations`** — the Top Opportunities items, for §6.4's checklist and §6.9's expanded detail.

**`businessOpportunity` fields, corrected in this revision** (replacing the four-item list from the prior revision):

- Estimated Customer Experience Impact
- Estimated Local SEO Impact
- Estimated Conversion Improvement
- Estimated Brand Modernization
- Potential Business Value

Framed as business value ("what changes for this business if they act on this"), not marketing copy, and derived from the same underlying scores and insights rather than invented independently.

Screenshot itself is not duplicated onto this object — §6.7 renders `website_analyses.screenshot_url` directly.

## 8. Opportunity score formula — v1

**Corrected in this revision: five measurable categories, each backed by a real adapter, with no invented weights.** The prior revision's six-category formula (which included Visual Quality and Calls To Action at 15%/10% with no data source behind either) is replaced, not merely flagged:

| Category | Source |
|---|---|
| Performance | Lighthouse Adapter |
| Accessibility | Accessibility Adapter + Lighthouse |
| SEO | SEO Adapter |
| Mobile | Mobile Adapter |
| Technical Health | Crawl Adapter + Tech Detection |

**No percentage weighting is specified here.** Robert did not provide weights for these five categories, and this document does not invent them — the exact weighting is Open Question 1, to be resolved before `opportunity-scoring-service.ts` can be implemented as specified. Every category in this table has a real, already-designed data source (§1); nothing in this formula depends on a signal the current adapter set can't produce, which is the correction this revision makes over the prior one.

## 9. Future AI Assessment (Phase 2 — explicitly out of scope for v1)

**Distinct from Open Question 1 above.** Visual Quality, Calls To Action, Brand Strength, Information Hierarchy, Trust Signals, and Conversion Experience are not missing-adapter gaps to fill in later — they are a deliberate, named Phase 2 category, requiring a future AI vision layer (post-screenshot analysis, i.e. an image/vision model reasoning over the captured screenshot, not a deterministic adapter). They are out of scope for v1's Opportunity Score entirely — §8's formula has no slot for them, not even an unweighted one.

**When this Phase 2 layer is eventually built, its output must be labeled "AI-derived assessments" and visually/structurally distinguished from the deterministic measurements in §8** — different section, different visual treatment, explicit labeling, not blended into the same scorecard as if they carried the same evidentiary weight. The scoring system must never imply certainty where the evidence is a model's judgment rather than a measurement. This constraint applies to whichever future sprint builds Phase 2, not to Sprint 3, but is recorded here so it isn't lost or quietly weakened by then.

## 10. Evidence & traceability

**New in this revision.** Every insight and every recommendation the report makes must trace to a specific, named measurement — this is what makes the report defensible rather than a plausible-sounding narrative. Mechanism: `insight-service.ts` (§1) tags each insight it generates with the adapter/metric it was derived from at generation time; `opportunity-report-service.ts` compiles those tags into the `evidence` field (§7) verbatim, rather than an evidence table being separately hand-authored.

Representative examples of the mapping (illustrative, not the full set):

| Insight / recommendation | Evidence source |
|---|---|
| Slow loading | Lighthouse Performance Score |
| Missing H1 | SEO Adapter |
| Mobile usability issue | Mobile Adapter |
| Accessibility issue | Accessibility Adapter |

No insight in the report is permitted to exist without a corresponding evidence entry — if `insight-service.ts` can't tag a statement to a real measurement, that statement doesn't belong in the report (this includes, by construction, why Phase 2's AI-derived assessments in §9 can't simply be added to this table once they exist — a vision model's judgment is a different *kind* of evidence than a Lighthouse score, and §9's labeling requirement exists partly to keep that distinction visible here too).

## 11. Mission Engine integration

**State used:** the existing `analyzing` state (`lib/workflow/mission-state.ts`) — no new state is added. `createMission()` lands a mission at `discovered`; the New Mission flow's call to `POST /api/missions/:id/analyze` calls `transitionMissionState(id, 'analyzing')`. When analysis completes, **the mission intentionally stays at `analyzing`** (§12) — it does not auto-advance to `researching`.

**Events emitted** (`lib/events/types.ts`): first real publisher of `WebsiteScanned` (`{ websiteUrl, findings? }`) and `SEOComplete` (`{ score?, issues? }`), both payload interfaces expanded to carry this sprint's actual normalized data (§3), consistent with ADR-010's precedent of reconciling with existing vocabulary before adding new concepts. One genuinely new event type: **`AnalysisFailed`**, requiring a small addition to `mission_events.event_type`'s CHECK constraint (part of `0007`'s job).

Every adapter's completion publishes through `EventBus.publish()` (`lib/events/event-bus.ts`), the sanctioned integration surface per `docs/MISSION_ENGINE.md` §10.

## 12. Why `analyzing` doesn't advance automatically

The alternative (auto-advance to `researching` on completion) was considered and rejected. `researching` implies a Research Engine is acting on the mission, and none exists yet — auto-advancing would make Mission Control lie about a mission's real state. Sprint 3 mission ends its life at `analyzing`, complete, with a full Opportunity Report attached — that is itself the customer-visible deliverable.

## 13. Acceptance criteria

- A user can paste a business URL into the New Mission flow and, without any further manual step, land on a report page for that mission.
- All seven analysis dimensions produce real output from real analysis — no dimension is stubbed or hardcoded.
- Analysis executes asynchronously per §2 — no code path runs Lighthouse or any adapter synchronously inside a Route Handler's response cycle.
- `analysis-service.ts`, `insight-service.ts`, `opportunity-scoring-service.ts`, and `opportunity-report-service.ts` exist as four separate modules with the boundaries described in §1.
- The Opportunity Score is computed by `opportunity-scoring-service.ts` from the five §8 categories only — no code path scores Visual Quality, Calls To Action, or any other Phase 2 signal (§9) in v1.
- Every insight and recommendation in the rendered report has a corresponding entry in the `evidence` field (§10) — none is unsourced.
- The rendered report follows the exact section order specified in §6, leading with the executive summary, not the score.
- The report is presentable to a customer as-is — meets the design system, not a debug dump of raw JSON.
- Every analysis dimension's completion (and failure) is recorded on the mission's event timeline via `mission_events`.
- A failed analysis is visible to the user as a failure, with a retry path — never a silent, permanent spinner.
- Re-running analysis on the same mission inserts a new `website_analyses` row (§4) and does not create a duplicate `companies` row or corrupt `total_missions_count`.
- No code path in this sprint sends an email, publishes a live site, or contacts the business in any way.
- `docs/MISSION_ENGINE.md`, `docs/ARCHITECTURE_DECISIONS.md` (new ADR for the decisions above), and `docs/SPRINT_STATUS.md` are updated in the same change, per Architecture Principle 7.

## 14. Success criteria

Distinct from the engineering checklist above: **this sprint succeeds when a founder pastes a business URL, the system performs a complete analysis, and a premium Opportunity Report is generated that explains what was discovered, why it matters, what business value exists, and why the opportunity is worth pursuing — polished enough that the founder would confidently share it with a prospective client.** Every item in §13 exists in service of this bar; meeting §13 without meeting this is not success, and this is the standard a demo of this sprint should actually be judged against.

## 15. Risks

1. **Resource cost of headless browser / Lighthouse execution.** Whatever runs Lighthouse and screenshot capture is meaningfully heavier than a typical serverless request; the hosting/runtime choice for the §2 background worker has real cost implications that haven't been priced out.
2. **No retry/failure policy exists** (`docs/MISSION_ENGINE.md` §5). A single failing adapter could leave a mission stuck at `analyzing` with a confusing partial state if this isn't handled deliberately per-adapter. The async execution model (§2) makes this more, not less, important.
3. **No rate limiting on the analysis trigger endpoint**, compounding an existing known gap (`docs/SPRINT_STATUS.md`).
4. **Sites that actively resist analysis** (bot-blocking, CAPTCHA walls, robots.txt disallow) need a defined, honest failure mode rather than an unhandled crash.
5. **Insight generation quality is unproven.** `insight-service.ts` (§1, §3) translating "Lighthouse Performance = 42" into readable business language is qualitatively different work from the deterministic adapters and scoring formula — it's closer to templated/rule-based natural-language generation than a pure calculation, and its output quality directly determines whether §14's success bar is met. Not resolvable in this document; flagged as an implementation risk worth prototyping early rather than assuming it'll just work.

## 16. Open questions

1. **Category weighting for the v1 formula (§8).** Performance, Accessibility, SEO, Mobile, and Technical Health are the five confirmed categories, each with a real data source — but no percentage weighting has been specified. Equal weighting (20% each) is the simplest default but hasn't been confirmed as the intended one.
2. **Which concrete third-party services or libraries** for crawl, mobile analysis, SEO, accessibility, Lighthouse, tech detection, and screenshots — cost/reliability tradeoffs need a decision independent of the (already-settled) async execution model.
3. **Event granularity** — one expanded `WebsiteScanned` event for all dimensions, or per-dimension event types?
4. **Which `website_analyses` row is "current"** for a mission with more than one analysis run — most recent by `created_at`, or an explicit `is_current` flag? Versioning itself (§4) is settled; this is about how the read path picks one when several exist.
5. **Is a stuck `analyzing` mission with an `AnalysisFailed` event sufficient failure signaling**, or does the state machine need a genuine failure state?
6. **Storage bucket policy details** for screenshots — public read vs. signed URLs, retention period, size limits.
7. **Should Insights and/or the assembled `OpportunityReport` be persisted** (e.g. cached columns) once a PDF export or repeated-view performance need exists, rather than recomputed on every read as in v1 (§4)?

---

Waiting for explicit approval before any of this is implemented.
