# 05 — Mission Control

## What exists today

Mission Control is `app/page.tsx`, the sole authenticated screen in the product. It is a Next.js Server Component — data is fetched server-side on every load, not via client-side polling or a subscription. The load sequence: get the authenticated user (`supabase.auth.getUser()`) → look up their profile and `default_organization_id` (`profileRepository.findById`) → fetch every mission belonging to that organization (`listMissionsForOrganization`) → compute stats client-side-free, in a pure function (`computeMissionControlStats`) → render.

Nothing on this page makes a direct Supabase call outside of the initial auth check and the one `profileRepository` lookup — everything else routes through `lib/services/mission-service.ts`, consistent with the layering rule in `docs/03-Software-Architecture.md`.

## The stat cards

Eight cards render in a responsive grid (`components/mission-control/stat-card.tsx`), split into two honesty tiers:

**Real, computed stats (3):**
- **Running Missions** — count of missions whose `state` is not `sent`, `archived`, or `rejected`. This is "everything still in motion," not "everything at a specific active state."
- **Completed Today** — count of missions at `state = "sent"` whose `state_changed_at` falls on or after local midnight today. Sprint 1 had a correctness bug here: it used `updated_at`, which could change for reasons unrelated to a state transition. Sprint 2 fixed this by introducing `state_changed_at`, maintained by a dedicated Postgres trigger (`set_mission_state_changed_at` in `0003_mission_state_machine.sql`) that only fires when `state` itself actually changes.
- **Waiting Approval** — count of missions at `state = "approval"`.

**Honest placeholder stats (5):** Revenue Pipeline, Meetings Scheduled, Proposal Queue, Draft Emails, Website Builds. Each renders a literal `$0` or `0` with a `caption="Coming in a future sprint"` prop rather than a fake number or a loading shimmer. This is a deliberate product discipline documented directly in `mission-service.ts`'s doc comment — as agents come online in future sprints and start producing real data for these, each one graduates from a placeholder to a real computed value, one at a time, the same way the three real stats already have.

## The mission list

`components/mission-control/mission-list.tsx` renders every mission as a row: business name, website URL, formatted creation date, and a `StateBadge`. `StateBadge` (`components/mission-control/state-badge.tsx`) color-codes by where the state sits in the pipeline: `success` (green) for `sent`, `warning` (amber) for `approval`, `destructive` (red) for `rejected`, `outline` for `archived`, and a `navy` badge for every other in-progress state — a single "in progress" visual bucket rather than 7 different colors for the 7 non-terminal, non-approval states. When there are zero missions, an empty state renders instead ("No missions yet / Start your first one to begin building the pipeline") — never an empty table with just headers.

## What doesn't exist yet: the activity feed / mission timeline

`mission_events` already has every row needed to render a per-mission chronological timeline (message, event_type, actor, created_at), and `missionEventRepository.listByMission()` already exists as the query to fetch it — but there is no UI that calls it. A mission detail page rendering this timeline (what the vision doc calls the audit trail an operator can trust) is unbuilt scope, a natural companion to whichever sprint first has an agent actually publishing interesting events to look at.

## What doesn't exist yet: the Approval Queue

The single most important unbuilt screen in the product. Per the product vision (`docs/01-Product-Vision.md`), the operator's actual daily interaction with Obsidian OS is meant to be reviewing a queue of missions sitting at `approval`, seeing their accumulated research/design/proposal/email output, and taking one clear action per mission (approve, reject, or a specific edit type — see the 11 `decision_type` values in `docs/06-Database.md`'s `decisions` table). Every such action should call `lib/services/decision-service.ts::logDecision()`, which both records the decision for the Decision Intelligence layer and transitions the mission's state. As of Sprint 2, `logDecision()` is a complete, tested-by-inspection function with no caller — this is the highest-leverage next UI to build once Sprint 3's agents give it something real to review.

## Mission lifecycle as experienced by the user (current vs. target)

**Today:** create a mission → see it sit at `discovered` forever, badge unchanging, no further interaction possible.

**Target (post Sprint 3+):** create a mission → watch its state badge progress overnight as agents work → it lands at `approval` → review it in the Approval Queue → approve (state → `sent`, `MissionApproved` + `DecisionLogged` events fire) or reject (state → `rejected` via `rejectMission()`, `MissionRejected` + `DecisionLogged` events fire) or request an edit (state stays, an edit-type decision is logged, the relevant artifact gets revised) → eventually the mission is archived (`archiveMission()`, from either `sent` or `rejected`) and its outcome data lives permanently on the linked `companies` row in the Memory Vault.
