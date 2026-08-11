# 05 — Mission Control

## What exists today

Mission Control is `app/page.tsx`, the sole authenticated screen in the product. It is a Next.js Server Component — data is fetched server-side on every load, not via client-side polling or a subscription. The load sequence: get the authenticated user (`supabase.auth.getUser()`) → look up their profile and `default_organization_id` (`profileRepository.findById`) → fetch every mission belonging to that organization (`listMissionsForOrganization`) → compute stats client-side-free, in a pure function (`computeMissionControlStats`) → render.

Nothing on this page makes a direct Supabase call outside of the initial auth check and the one `profileRepository` lookup — everything else routes through `lib/services/mission-service.ts`, consistent with the layering rule in `docs/03-Software-Architecture.md`.

## The Line

**Visual Redesign (this entry):** the five-stat-card grid (`stat-card.tsx`, now deleted) is gone, replaced by **The Line** (`components/mission-control/production-line.tsx`) — a single horizontal read of the real production pipeline: `Research -> Brief -> Approval -> Build -> QA -> Preview`. Each node shows a real, honest count computed by `computeProductionLineCounts()` (`lib/services/mission-service.ts`), which maps each mission's real `state` onto one of five Line positions via `getProductionLineStage()`:

- **Research** — `discovered`, `analyzing`
- **Brief** — `researching` (Design Brief generation)
- **Approval** — `reviewing` (the Founder Approval Gate — same gate the old "Waiting Approval" tile counted, `supabase/migrations/0011_founder_approval_gate.sql`)
- **Build** — `designing` (Design Generation + Refinement)
- **QA** — `qa` (Design QA)

**Preview**, the sixth node, is deliberately not a `MissionState` bucket — it reuses `stats.previewReady`, the same real `computeMissionsWithPreview()` count the old "Preview Ready" tile showed (a completed `website_designs` row). A mission can show as both "in QA" and "preview-ready" at once, honestly: Design Generation can produce a renderable design before `design-qa-service.ts` ever runs and moves `state` to `qa`.

`archived`, `rejected`, and the downstream proposal/email/approval/sent sales-pipeline states (still unwired, see "What doesn't exist yet: the Approval Queue" below) map to `null` and are excluded from the Line's counts — rejecting or archiving a mission overwrites `state`, so how far it actually got is not recoverable from this field, and is never guessed at.

The Approval node gets a "Needs decision" callout (and the Preview node a "Ready to share" callout) whenever their count is greater than zero — text-based, not color-only, per the accessibility posture below.

**Final Dashboard Polish (this entry):** the first cut of the Line read as six independent tiles rather than one connected pipeline, and the original mobile treatment (a horizontally-scrollable row) hid Build/QA/Preview behind scroll the founder had to discover. Both fixed without touching `computeProductionLineCounts()` or any data/state logic:

- **Desktop** — a single continuous 1px rule now runs behind all six stages (`components/mission-control/production-line.tsx`'s `hidden sm:block` variant), with a small tick-mark dot at each stage position sitting exactly on that rule (verified geometrically: each dot's vertical center matches the rule's `y` to the pixel). The six real counts read as one line with six positions, not six separate cards.
- **Mobile (< `sm`)** — replaced the horizontal-scroll row with a vertical spine (`sm:hidden` variant): a continuous vertical rule with a tick per stage, one stage per row, numeral right-aligned. All six stages are always visible with no scrolling to discover — verified at 375px: `document.documentElement.scrollWidth === clientWidth` (no overflow), and all six stage labels present in the DOM.

If revenue/meetings/proposals/email/CRM ever get real backing data, that's a new capability with its own home — not a tile bolted back onto this dashboard.

## The mission list

`components/mission-control/mission-list.tsx` groups every mission into exactly one of three sections via `groupMissionsForDisplay()` (`lib/services/mission-service.ts`) — nothing is hidden, the three groups always sum to the full mission count:

- **Needs your review** — `state === "reviewing"`. Same amber left-accent border, tinted background, and uppercase label treatment the Dashboard Product Pass introduced.
- **Ready to present** — not reviewing, and has a completed Design Preview. Gets a direct "View Preview →" link to `/missions/[id]/preview`, the same existing, RLS-scoped route, never a new one.
- **In production** — everything else (including `archived`/`rejected`, so nothing silently disappears from the list).

A section renders only when it has at least one mission — no empty "Ready to present" heading with nothing under it. When there are zero missions total, the existing empty state renders instead ("No missions yet / Start your first one to begin building the pipeline").

**Signal Room stage tracker:** each row in "Needs your review" and "In production" additionally renders a compact six-step tracker (`components/mission-control/stage-tracker.tsx`, fed by `computeMissionStageTrack()`) showing the same six Line stages for that one mission — completed stages filled, the active stage ringed and bold, upcoming stages hollow, every state also spelled out in screen-reader-only text (never color alone). The tracker is omitted (not fabricated) for a mission whose `state` maps to `null` on the Line — archived/rejected/off-Line missions rely on the existing `StateBadge` alone, which already renders "Rejected"/"Archived" honestly. `StateBadge` (`components/mission-control/state-badge.tsx`) still color-codes every row's badge by pipeline position: `success` (green) for `sent`, `warning` (amber) for `approval`/`reviewing`, `destructive` (red) for `rejected`, `outline` for `archived`, `navy` for every other in-progress state.

## What doesn't exist yet: development/test-data flagging

**Final Dashboard Polish (this entry):** checked whether the app has any mechanism to distinguish development/test missions from real ones in the UI — it doesn't. `missions` (`supabase/migrations/0001_init.sql`) has no `is_test`/`is_demo`/`environment` column or equivalent, there's no seed script that tags the rows it creates, and no env var (`NODE_ENV`, `DEMO_MODE`, or similar) gates anything in `app/page.tsx` or `lib/services/mission-service.ts`. The local dev database's test-oriented business names (e.g. "(evidence-payoff validation)", "(reject test)") are real rows created through the real UI/API during prior validation passes (`docs/SPRINT_STATUS.md`) — indistinguishable from a real mission at the schema level except by reading `business_name`. Per explicit instruction this pass did not build a flagging mechanism, delete rows, or alter any historical data — flagged here as a disclosed gap for a future decision, not fixed.

## What doesn't exist yet: the activity feed / mission timeline

`mission_events` already has every row needed to render a per-mission chronological timeline (message, event_type, actor, created_at), and `missionEventRepository.listByMission()` already exists as the query to fetch it — but there is no UI that calls it. A mission detail page rendering this timeline (what the vision doc calls the audit trail an operator can trust) is unbuilt scope, a natural companion to whichever sprint first has an agent actually publishing interesting events to look at.

## What doesn't exist yet: the Approval Queue

The single most important unbuilt screen in the product. Per the product vision (`docs/01-Product-Vision.md`), the operator's actual daily interaction with Obsidian OS is meant to be reviewing a queue of missions sitting at `approval`, seeing their accumulated research/design/proposal/email output, and taking one clear action per mission (approve, reject, or a specific edit type — see the 11 `decision_type` values in `docs/06-Database.md`'s `decisions` table). Every such action should call `lib/services/decision-service.ts::logDecision()`, which both records the decision for the Decision Memory layer and transitions the mission's state. As of Sprint 2, `logDecision()` is a complete, tested-by-inspection function with no caller — this is the highest-leverage next UI to build once Sprint 3's agents give it something real to review.

## Mission lifecycle as experienced by the user (current vs. target)

**Today:** create a mission → see it sit at `discovered` forever, badge unchanging, no further interaction possible.

**Target (post Sprint 3+):** create a mission → watch its state badge progress overnight as agents work → it lands at `approval` → review it in the Approval Queue → approve (state → `sent`, `MissionApproved` + `DecisionLogged` events fire) or reject (state → `rejected` via `rejectMission()`, `MissionRejected` + `DecisionLogged` events fire) or request an edit (state stays, an edit-type decision is logged, the relevant artifact gets revised) → eventually the mission is archived (`archiveMission()`, from either `sent` or `rejected`) and its outcome data lives permanently on the linked `companies` row in the Memory Vault.
