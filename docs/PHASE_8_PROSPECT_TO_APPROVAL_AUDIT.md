# Phase 8 — Prospect-to-Approval Workflow Audit

**Status:** Architecture audit only. No application code written or modified. No commit, no push.

**Protected baseline:** Phase 7, commit `b623065471e7acd747c6d88905ec1d0b47f22b6f`. `main`/`origin/main` match.

**Method:** every claim below is traced directly against the current source tree (file/line citations throughout) — nothing here is inferred or assumed from prior research documents. Where a prior audit's characterization ("little or no implementation after QA") is checked against the real code, the result is stated explicitly.

---

## A. CURRENT REAL STATE

### A1. Where a prospect enters the system, and how it reaches a mission

Traced end to end:

1. **Discovery**: `lib/services/lead-hunter-service.ts` finds real candidate businesses (via `lib/adapters/discovery-adapter.ts`), producing rows in the `leads` table (`supabase/migrations/0018_lead_hunter.sql`). A lead starts `status: "pending"`.
2. **Qualification/scoring**: `lib/services/lead-scoring-service.ts` scores a pending lead — `website_score` (cheap, crawl-only proxy for how good the current site already is), `opportunity_score` (how worthwhile as a makeover prospect), `confidence_score` (how much real data was actually captured), plus `main_weaknesses` (jsonb), `main_opportunity`, `recommended_hero_pattern`, `recommended_design_strategy`, and real captured evidence (`contact_evidence`, `social_links`, `crawl_result`). A qualified lead becomes `status: "candidate"`; qualification that finds nothing worth pursuing sets `status: "rejected"` with a `rejection_reason` — never silently dropped.
3. **Promotion**: `lib/services/lead-promotion-service.ts`'s `promoteLeadToMission` is the **one write path** from a qualified lead into the real pipeline. It validates the lead is `candidate` with a real `website_url`, calls the existing, unchanged `mission-service.ts::createMission` (the same entry point the plain "new mission" dialog uses), then writes `leads.status = "promoted"` plus `company_id`/`mission_id`/`promoted_at` back onto the lead row. **This is the exact "TARGET LOCAL BUSINESS → qualification" bridge Phase 8 needs — it already exists, is tested, and needs no changes.**
4. **The object that identifies the prospect through the rest of the pipeline is the `mission_id`** (a `missions` row) — not the lead. Once promoted, the lead becomes a historical record (`leads.mission_id` points forward at it) and everything downstream (Design Brief → Generation → Refinement → Capability Execution → QA) is keyed on `mission_id`/`website_design_id`, confirmed throughout `design-qa-service.ts`, `design-generation-service.ts`, etc. (already deeply traced in Phases 6.8/6.9/7 of this engagement).
5. **`companies`** (`supabase/migrations`, `lib/repositories/company-repository.ts`) is a separate, deliberately-thin entity for repeat-business tracking across multiple missions for the same business (`total_missions_count`, `last_mission_id`) — created via `findOrCreateCompany` at mission-creation time (`lib/workflow/mission-workflow.ts:91`). Confirmed only identity fields (`business_name`, `website_url`, `industry`, `business_category`, `first_discovered_at`, counts) are ever actually written; `last_contacted_at`, `last_proposal_amount`, `last_proposal_sent_at`, `follow_up_date`, `design_preferences` are real columns on this table that **nothing in the current codebase ever writes to** — verified by grep, zero non-schema matches.

### A2. `mission-state.ts` — what it represents versus what is executable

`lib/workflow/mission-state.ts` defines `MISSION_STATE_SEQUENCE`: `discovered → analyzing → researching → reviewing → designing → qa → proposal → email → approval → sent → archived`, plus the side state `rejected`. `NEXT_STATE` (`mission-state.ts:102-115`) encodes this as the single source of truth for "what's the next state."

`lib/workflow/mission-workflow.ts::transitionMissionState` (lines 145-200) is the **actual enforcement** — traced directly:
- A transition is only implicitly allowed when it is (a) the exact `NEXT_STATE` successor, (b) a legitimate reject (`canReject`), (c) the `qa → designing` revise loop, or (d) `rejected → archived`. Anything else throws unless the caller explicitly passes `{ allowNonSequential: true }`.
- **Nothing in the current codebase ever calls `transitionMissionState(..., "proposal", ...)`, `"email"`, `"approval"`, or `"sent"`** — confirmed by grep across `lib/` and `app/`. The only caller that ever moves a mission out of `designing`/`qa` is `runDesignQa` itself, which transitions `designing → qa` on success and nothing further.
- **Confirmed directly, not inferred: a mission that reaches `qa` today has no sanctioned way to ever leave it**, except sideways to `rejected` (via `rejectMission`, exposed at `POST /api/missions/[id]/reject`) or the `qa → designing` revise loop. This validates Robert's own suspicion exactly, and sharpens the earlier "prospect/delivery workflow" finding from `docs/POST_PHASE_6.9_PHASE_7_DIRECTION.md` §6: it is not merely that email/delivery infrastructure doesn't exist — the mission **cannot structurally progress past `qa`** under any current, real code path.

### A3. The most important finding of this audit: the schema and event vocabulary for this exact workflow already exist, unconsumed

This was not assumed — it was found by direct inspection, and it changes the shape of "what's genuinely new" for Phase 8:

- **`decisions` table** (`lib/repositories/decision-repository.ts`, `lib/services/decision-service.ts`) — a fully real, tested, already-migrated table whose own `DecisionType` union is: `"approve" | "reject" | "not_a_fit" | "edit_subject" | "edit_email" | "edit_proposal" | "change_price" | "skip_industry" | "approve_immediately" | "wait_until_later" | "archive"`. Its row shape carries `ai_recommendation`, `user_action`, `before_value`/`after_value` (jsonb), `proposal_price`, `email_subject`, `email_length`, `website_theme` — an almost verbatim match for exactly the founder-decision vocabulary Phase 8 needs. `decision-service.ts`'s own doc comment states its purpose in plain language: *"the goal is capturing perfect training data from day one for every meaningful approve/reject/edit decision, even though no UI calls this yet."* **Confirmed: zero callers of `logDecision` exist anywhere in production code today.**
- **`DomainEventType`** (`lib/events/types.ts:29-...`, the closed union `DomainEvent` consumes) already includes `"ProposalReady"`, `"EmailDraftReady"`, and `"MissionApproved"` as real, typed event variants, with real payload shapes (`ProposalReadyPayload { proposalId?, price? }`, `EmailDraftReadyPayload { subject?, length? }`, `MissionApprovedPayload { approvedBy }`). **`lib/events/event-bus.ts`'s own `describeEvent` function already has a working `case` for all three**, meaning the mission timeline UI already knows how to render them if they were ever published. Confirmed: nothing anywhere publishes any of these three today.
- This is the same "designed ahead, shipped inert, never wired to a real consumer" pattern this engagement has found repeatedly (Narrative Arc Planner before Phase 6.8, `CapabilityAdapter.qaContract()` before Phase 6.9) — except this time at the level of the entire proposal/email/approval layer, not one QA check. **The correct framing for Phase 8 is: wire up an already-designed but never-connected layer, not invent a new one from scratch.**

### A4. Where evidence for a proposal already exists

- **`OpportunityReport`** (`lib/services/opportunity-report-service.ts:15-...`) is a rich, already-built, already-founder-facing object: `executiveSummary`, `businessOpportunity` (customer-experience/local-SEO/conversion/brand-modernization impact estimates + potential business value), `scores` (overall/performance/accessibility/seo/mobile/technicalHealth), `findings` (per-category real statements), `evidence` (`{claim, source}` pairs), `recommendations` (`{title, detail, severity}`), and a closing `executiveConclusion` plus per-section `confidence`. It is rendered today via a full set of presentational components (`components/mission-detail/report/*.tsx`) inside `app/missions/[id]/page.tsx`.
- **Critical, verified data-boundary fact: `OpportunityReport` is never persisted.** It is recomputed live, on every page load, from `NormalizedAnalysis` + insights + `scoreResult` (`app/missions/[id]/page.tsx:60`, `app/api/missions/[id]/analysis/route.ts:55`). There is no `opportunity_reports` table; the report is a derived view, not a stored artifact.
- **`leads.main_weaknesses` / `main_opportunity` / `recommended_design_strategy`** — the qualification-time evidence for *why this specific business was chosen* — is real, captured, and persisted on the lead row, but is **never carried forward onto the `missions`/`website_designs` row after promotion**. Once a lead is promoted, this qualification rationale is only reachable by looking up the original `leads` row via `leads.mission_id` — not duplicated, not lost, but not currently surfaced anywhere past promotion either.
- **`DesignBrief`** (`lib/services/design-brief-service.ts`) carries `citedInsights`, `positioning`, `heroThesis`, `signatureElement`, `referencesConsidered` — the design rationale for *why this specific design direction was chosen*. Already fully real and persisted (`design_briefs.brief`).
- **`DesignQaReport`** (`lib/services/design-qa-service.ts`) — the complete, already-persisted (`website_designs.qa_result`) verdict/confidence/findings/evidence for every category, including Phase 6.8's narrative-consistency and Phase 6.9's rendered-capability checks. Already fully real.

### A5. The demo URL — a real, load-bearing gap, verified directly

`middleware.ts` gates **every route except `/login` and `/auth/callback`** behind an authenticated Supabase session (lines 5-9, 15-19). `app/missions/[id]/preview/page.tsx` (the actual rendered demo) sits behind this gate identically to every other page in the app. **Confirmed directly: there is no public, unauthenticated, or tokenized way for a prospect to open their own generated demo today.** A link to `/missions/[id]/preview` in an email would redirect an unauthenticated recipient straight to `/login`.

This is a real, named prerequisite for the *sending* phase — but per Robert's own scoping ("the first question is the internal workflow, not external delivery"), it does **not** block Phase 8's draft-only slice: the draft can reference the existing authenticated URL today, with the limitation explicitly disclosed (see §H) rather than silently assumed away or solved prematurely.

### A6. Existing founder-review UI pattern, already established twice

- `components/mission-detail/design-brief-panel.tsx` — renders the Design Brief, generation status, and (line 419) `<QaReportView report={qaResult} />`, plus the one existing approval action in the whole app: `approve-design-brief` (`app/api/missions/[id]/approve-design-brief/route.ts`), which gates `reviewing → designing`.
- `POST /api/missions/[id]/reject` (`rejectMission`) is a **generic, already-callable-from-any-non-terminal-state** rejection path, not scoped to one stage — directly reusable as-is for a Phase 8 "REJECT" action at the approval boundary, no new mechanism needed.

---

## B. EXACT FLOW DIAGRAM

### B1. Current, real, executable pipeline (traced, not assumed)

```
Lead Hunter scan → leads (pending)
   → lead-scoring-service.ts → leads (candidate | rejected, with real evidence)
      → [FOUNDER reviews in app/leads UI — already built]
      → lead-promotion-service.ts::promoteLeadToMission
         → mission-service.ts::createMission → missions (discovered)
            → analyzing → researching → reviewing
               [OpportunityReport shown, derived-only, app/missions/[id]/page.tsx]
               → approve-design-brief → designing
                  → generateWebsiteStructure (Wireframe/Components/RefinedDesign)
                     → runDesignQa → missions.state = "qa"
                        ⛔ DEAD END — no sanctioned transition out of "qa" exists in current code,
                           except sideways to "rejected", or the qa→designing revise loop.
```

### B2. Proposed smallest Phase 8 vertical slice (ONE prospect, manually driven)

```
missions.state = "qa"  (QA already passed — Phases 6.8/6.9/7's own work)
   │
   │  [NEW, SMALL] assembleProposal(missionId) — pure, reuses OpportunityReport +
   │  DesignBrief + DesignQaReport + the original leads row's qualification evidence.
   │  Persists a proposal artifact (see §D). Publishes the EXISTING "ProposalReady" event.
   ▼
missions.state = "proposal"  (transitionMissionState, the EXISTING sanctioned NEXT_STATE move)
   │
   │  [NEW, SMALL] generateEmailDraft(missionId) — pure/deterministic composition
   │  (name, demo link, 2-3 proposal highlights, CTA) into a DRAFT, editable, never sent.
   │  Publishes the EXISTING "EmailDraftReady" event.
   ▼
missions.state = "email"  (EXISTING sanctioned NEXT_STATE move)
   │
   │  [NEW, SMALL] Founder Approval Panel — renders: business identity, the generated
   │  demo (existing preview route, opened in a new tab), the existing DesignQaReport
   │  (existing QaReportView, reused verbatim), the new proposal artifact, the editable
   │  email draft.
   ▼
missions.state = "approval"  (EXISTING sanctioned NEXT_STATE move, on presenting the panel)
   │
   │  Founder chooses APPROVE / HOLD / REJECT.
   │    REJECT  → rejectMission (100% EXISTING, unchanged) → missions.state = "rejected"
   │    HOLD    → no transition; mission stays in "approval" for later review
   │    APPROVE → [NEW, SMALL] logDecision(...) using the EXISTING, unconsumed
   │              decision-service.ts, decision_type: "approve" (or "edit_email"/
   │              "edit_proposal" if the founder edited first) → transitionMissionState
   │              to "sent" (EXISTING sanctioned NEXT_STATE move)
   ▼
missions.state = "sent"   ← "sent-ready", per Robert's own framing — an approved,
                             frozen, ready-to-send record. NOT an actual email send.
                             That is explicitly the next, separate phase.
```

Every state in this slice (`proposal`, `email`, `approval`, `sent`) is an **already-existing member of the closed `MissionState` union** — Phase 8 needs zero new enum values, zero changes to `mission-state.ts`, and zero changes to `transitionMissionState`'s validation logic. It only needs real callers for transitions that were always structurally anticipated and never invoked.

---

## C. FILE/MODULE MAP

| File/module | Current responsibility | Phase 8 treatment |
|---|---|---|
| `lib/services/lead-promotion-service.ts` | Lead → mission handoff | **Untouched** — already exactly right |
| `lib/workflow/mission-workflow.ts` (`transitionMissionState`, `rejectMission`) | State-transition enforcement | **Reused unchanged** — the four new transitions are ordinary `NEXT_STATE` moves this function already supports |
| `lib/workflow/mission-state.ts` | Closed state vocabulary | **Untouched** — `proposal`/`email`/`approval`/`sent` already exist |
| `lib/events/types.ts`, `lib/events/event-bus.ts` | Domain event vocabulary + persistence + timeline description | **Reused unchanged** — `ProposalReady`/`EmailDraftReady`/`MissionApproved` already fully typed and described; Phase 8 just needs to `publish()` them |
| `lib/repositories/decision-repository.ts`, `lib/services/decision-service.ts` | Decision Memory storage + write path | **Reused unchanged** — first real caller of `logDecision`, using its already-correct `DecisionType`/field shape |
| `lib/services/opportunity-report-service.ts` | Derived business-opportunity report | **Reused, read-only** — primary evidence source for the proposal artifact |
| `lib/services/design-brief-service.ts` | Design rationale (`DesignBrief`) | **Reused, read-only** — design-rationale evidence source for the proposal |
| `lib/services/design-qa-service.ts` (`DesignQaReport`) | QA verdicts/evidence | **Reused, read-only** — already the exact "is this good enough to send" signal |
| `lib/repositories/lead-repository.ts` (`leads` row, post-promotion) | Original qualification evidence | **Reused, read-only** — `main_weaknesses`/`main_opportunity`/scores, looked up via `leads.mission_id` |
| `components/mission-detail/qa-report-view.tsx` | QA report display | **Reused verbatim** inside the new Founder Approval panel |
| `app/api/missions/[id]/reject/route.ts`, `rejectMission` | Generic mission rejection | **Reused unchanged** as the approval panel's REJECT action |
| `app/missions/[id]/preview/page.tsx` | Renders the generated demo | **Reused unchanged** as "the demo" the approval panel links to — auth-gated, a disclosed limitation, not solved this phase |
| `companies` table (`last_proposal_amount`, `last_proposal_sent_at`, `follow_up_date`, `design_preferences`) | Rollup fields for repeat-business tracking | **Candidate for reuse, not required for the vertical slice** — see §D/§H |
| `mission-service.ts::createMission` | Mission creation | **Untouched** |

---

## D. MINIMUM NEW PIECES

Only what's genuinely necessary, given everything reusable above:

1. **`lib/services/proposal-service.ts`** (new, small) — pure `assembleProposal(missionId)`: reads `OpportunityReport` (recomputed, same call already made elsewhere), `DesignBrief`, `DesignQaReport`, and the original `leads` row (via `mission_id`), and composes a small, structured proposal object (see §D3). Persists it (see the open storage-location decision in §H) and calls `transitionMissionState(..., "proposal")` + publishes `ProposalReady`.
2. **`lib/services/email-draft-service.ts`** (new, small) — pure `generateEmailDraft(missionId)`: composes a subject + body referencing the proposal's own highlights and the demo URL, using a fixed template (not an LLM call — no new model surface needed for a first slice; a deterministic template is the smaller, safer default, matching this codebase's own "Generation is deterministic, Design Intelligence is the only LLM layer" discipline). Persists a draft (editable), transitions to `"email"`, publishes `EmailDraftReady`.
3. **Founder Approval panel** (new, small UI addition to `app/missions/[id]/page.tsx` or a new `components/mission-detail/approval-panel.tsx`) — renders business identity + demo link + `QaReportView` (reused) + proposal + editable email draft, with APPROVE/HOLD/REJECT actions.
4. **One new API route**, e.g. `app/api/missions/[id]/approve/route.ts` — mirrors `approve-design-brief`/`reject`'s exact existing shape: auth check, RLS-scoped lookup, call `logDecision` (existing) + `transitionMissionState(..., "sent")` (existing), return the updated mission. `reject` already exists and needs no new route.
5. **A small persistence location for the proposal + email-draft content** — the one place a genuinely new schema decision is required. See §H for the two credible options; this audit does not resolve it, since it is a real, if small, product/architecture judgment call.

**Explicitly not needed**: any new mission state, any change to `transitionMissionState`'s validation, any new event type, any new Decision Memory field, any LLM call, any email provider integration, any new capability token, any change to scoring/ranking/qualification logic.

---

## E. DATA BOUNDARY

| Data | Kind | Where |
|---|---|---|
| `missions.state` | Persisted | `missions` table — unchanged shape, new real values (`proposal`/`email`/`approval`/`sent`) actually reached |
| `OpportunityReport` | **Derived, not persisted** | Recomputed live from `website_analyses` + insight/score functions every time it's read — unchanged by Phase 8 |
| `DesignBrief`, `RefinedDesign`, `DesignQaReport` | Persisted | `design_briefs`/`website_designs` rows — unchanged, read-only for Phase 8 |
| `leads.main_weaknesses`/`main_opportunity`/scores | Persisted | `leads` table, reachable via `leads.mission_id` — read-only for Phase 8 |
| **Proposal content** | **New — must be persisted** (a founder needs to review/edit/approve a stable snapshot, not a value recomputed differently each time) | Location genuinely undecided — §H |
| **Email draft content** | **New — must be persisted**, and must remain **editable** until approval | Location genuinely undecided — §H |
| **Decision record** (approve/reject/edit) | Persisted | `decisions` table — existing, unconsumed, exactly fits |
| Domain events (`ProposalReady`, `EmailDraftReady`, `MissionApproved`) | Persisted | `mission_events` table via the existing `EventBus` — unchanged |
| Demo URL | **Not a stored artifact — a route** | `/missions/[id]/preview` already exists; no new storage, but currently auth-gated (see §A5/§H) |

---

## F. FOUNDER WORKFLOW — exactly what happens manually, for one prospect

1. Founder reviews Lead Hunter results (existing `app/leads` UI), promotes one qualified lead (existing "Launch Makeover" action).
2. Existing pipeline runs unattended through analysis → design brief → generation → QA, exactly as today, with the founder approving the design brief once (existing `approve-design-brief` action) — nothing here changes.
3. **New**: founder triggers (or the system auto-triggers on `runDesignQa` success) proposal assembly and email-draft generation — two fast, deterministic, non-LLM compositions.
4. **New**: founder opens the Approval panel — reviews business identity, opens the demo in a new tab (existing preview route), reads the existing QA report, reads the proposal, reads and optionally edits the email draft.
5. **New**: founder clicks APPROVE (records the decision via the existing Decision Memory write path, mission moves to `"sent"` — meaning "ready," not "actually emailed"), HOLD (does nothing, mission stays in `"approval"` for later), or REJECT (existing `rejectMission` action, unchanged).
6. Nothing beyond this point happens automatically. No email leaves the system. No provider is contacted.

---

## G. FUTURE AUTOMATION COMPATIBILITY

**Geographic expansion (Mahopac → Carmel → Putnam → Westchester → beyond)** requires, eventually, not built now:
- Lead Hunter's discovery-adapter already parameterizes on a search area (confirmed present in `lib/adapters/discovery-adapter.ts`'s existing shape from Phase 2's own work) — expanding search geography is already a config-level concern, not an architecture change.
- Nothing in the Phase 8 slice above is geography-specific; `assembleProposal`/`generateEmailDraft` are pure functions of `missionId`, reusable at any volume.

**Overnight batch generation ("N prospects/demos, approved-ready drafts by morning")** requires, eventually:
- A **queue/scheduler** to run the existing pipeline (already fire-and-forget/event-driven per ADR-012, per this codebase's own established pattern) across many leads unattended — an orchestration concern layered *above* the existing per-mission services, not a rewrite of them.
- The Founder Approval panel becoming a **list view** (many missions sitting in `"approval"` simultaneously) rather than the single-mission view Phase 8 builds — an additive UI change, not a data-model change, since `missions.state` already supports arbitrarily many rows sitting in `"approval"` concurrently today.
- **This is exactly why building the vertical slice on top of the real state machine (rather than a bespoke one-off script) matters**: a batch run is just "call the same real services N times," never a parallel, second implementation.

**Reply monitoring (research only, per Robert's explicit instruction not to build this)** would eventually need:
- A `sent` mission to gain a **reply-state axis independent of `missions.state`** — likely a small new column or side table (`reply_status: "awaiting" | "replied" | "positive" | "negative" | "other" | "needs_review"`), since `missions.state` is a single linear pipeline position, not a secondary conversation-thread status, and conflating the two would break the existing state machine's own single-axis discipline.
- A strict, non-negotiable boundary (matching this codebase's own founder-approval-gates-everything principle, `CLAUDE.md`): any inbound reply must always land in a `needs_founder_review`-equivalent state, never trigger an autonomous AI reply or any further state transition on its own. This is a design constraint to hold, not a component to build now.

---

## H. RISKS / OPEN DECISIONS (genuine product judgment only)

1. **Where does proposal/email-draft content live?** Two credible options exist and this audit does not choose between them (see §I).
2. **The demo link problem is real and unresolved by this slice.** The email draft's demo link will point at an auth-gated route. This is fine for a draft nobody outside the founder ever sees, but must be solved (a public/tokenized preview mechanism) before any actual send phase — flagged here explicitly so it is never silently assumed solved.
3. **Is `"sent"` state confusing terminology for "approved and ready," before any email ever actually sends?** The existing `MISSION_STATE_SEQUENCE` already names it this way; renaming it is a larger, unnecessary change for a smaller, real gain in clarity — recommend keeping the existing name and documenting the distinction rather than renaming a state four other things may already assume.
4. **Should proposal/email generation be founder-triggered (a button) or automatic on QA success?** Either is small; automatic-on-success is marginally smaller (one fewer UI action) but removes a natural "founder decides whether this mission is even worth a proposal" checkpoint QA's own PASS/WARN/FAIL/INCOMPLETE verdict doesn't fully answer alone (e.g., an INCOMPLETE-verdict mission might not deserve a proposal yet). Recommend founder-triggered for the first slice, matching this codebase's own consistent bias toward an explicit gate over an implicit one.
5. **Should HOLD be a real, distinct state or just "no action taken"?** The existing state machine doesn't have a "held" state, and `approval` itself already IS the natural "awaiting decision" state — recommend HOLD simply means "do nothing, stay in `approval`," not a new state, avoiding the exact kind of unnecessary new-state proliferation this audit is otherwise trying to prevent.

---

## I. RANKED IMPLEMENTATION OPTIONS

**Option 1 (recommended) — New, minimal `proposals` table.** `proposals(id, mission_id, content jsonb, email_subject text, email_body text, status, created_at, updated_at)`. Mirrors this codebase's own established "one small table per distinct artifact" precedent (`experience_refinements`, `mission_events`) rather than overloading the deliberately lean `missions` row. Cleanest separation, smallest blast radius, easiest to query/list later for the batch/overnight future (§G). Cost: one new migration, one new repository file (both small, both matching existing conventions exactly).

**Option 2 — New nullable columns directly on `missions`** (`proposal jsonb`, `email_draft jsonb`). Marginally smaller (no new table/repository), but works against `missions`' own deliberate leanness (today: identity + state only) and against the entity-separation discipline this codebase states explicitly elsewhere (`0018_lead_hunter.sql`'s own comment: "keep these entities separated, not one giant object"). Would need to be revisited anyway once batch/multi-draft-revision scenarios arrive (§G).

**Option 3 — Store proposal/email content only inside `decisions.before_value`/`after_value`.** Rejected: `decisions` is explicitly an append-only history of what was *decided*, not a place to hold the *current, still-editable* draft a founder hasn't acted on yet — using it as live storage would conflate two different data lifecycles this codebase is otherwise careful to keep apart (mirrors why `experience_refinements` is insert-only history while `website_designs.refined_design` is the current value).

**Recommendation: Option 1.**

---

## J. RECOMMENDATION

**Build the smallest possible vertical slice described in §B2, using Option 1's storage shape, for exactly one real, already-QA-passed mission.** Concretely: one new small `proposals` table + repository, `proposal-service.ts::assembleProposal`, `email-draft-service.ts::generateEmailDraft`, one new Founder Approval panel/component, one new `approve` API route — every one of them a thin, deterministic layer over infrastructure that already exists and was already designed for exactly this purpose (`decisions`, `ProposalReady`/`EmailDraftReady`/`MissionApproved` events, the `proposal`/`email`/`approval`/`sent` states, `OpportunityReport`, `DesignQaReport`, `rejectMission`). Do not solve the public-demo-URL problem, reply monitoring, or batch/overnight generation in this phase — they are correctly named, real, future prerequisites, not blockers for proving the internal workflow with one prospect first.

---

## Status

Audit complete. No code written. No tracked file modified. No historical untracked file touched. No commits made. Awaiting Robert's review and explicit approval before any implementation begins.
