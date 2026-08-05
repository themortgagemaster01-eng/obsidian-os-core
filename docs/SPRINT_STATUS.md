# Sprint 1 — Foundation — Status

## What's actually done

**Project scaffold**
- Next.js 14 App Router + TypeScript strict mode, Tailwind CSS, hand-written
  shadcn/ui primitives (`components/ui/button.tsx`, `card.tsx`, `input.tsx`,
  `label.tsx`, `dialog.tsx`, `badge.tsx`, `separator.tsx`, `avatar.tsx`,
  `skeleton.tsx`) built on Radix primitives.
- Dark-only design system wired through `tailwind.config.ts` (background,
  panel, border, navy accent tokens) and `app/globals.css` (forced dark,
  glass-panel utility class). Inter loaded via `next/font/google` in
  `app/layout.tsx`.
- `.env.example` with every Sprint 1 and future-sprint env var placeholder,
  no real values anywhere.

**Supabase integration**
- `lib/supabase/client.ts` — typed browser client (`createBrowserClient`).
- `lib/supabase/server.ts` — typed server client for Server
  Components/Route Handlers/Server Actions (`createServerClient`, cookie
  read/write with the try/catch-in-Server-Component pattern documented
  inline).
- `lib/supabase/middleware.ts` + root `middleware.ts` — session refresh and
  route protection. Unauthenticated users are redirected to `/login`;
  authenticated users hitting `/login` are redirected to `/`.
- `lib/supabase/database.types.ts` — hand-written `Database` type for
  `profiles`, `missions`, `mission_events` matching the migration exactly,
  in the shape `supabase gen types` produces (Row/Insert/Update per table).
- `supabase/migrations/0001_init.sql` — all three tables, the
  `handle_new_user()` trigger on `auth.users` insert, an `updated_at`
  trigger, indexes on `missions(owner_id)`, `missions(status)`, and
  `mission_events(mission_id, created_at)`, and least-privilege RLS
  policies scoped to `auth.uid()` on every table (mission_events policies
  go through a subquery against `missions.owner_id`).

**Mission workflow engine**
- `lib/workflow/types.ts` — `MissionStage`, `MissionStatus`,
  `MISSION_STAGES`, `STAGE_LABELS`, `NEXT_STAGE`, plus type guards.
- `lib/workflow/mission-workflow.ts` — `createMission()` (insert at
  `recon`/`active` + seed `mission_created` event) and
  `transitionMissionStage()` (validates the target is a real stage,
  enforces sequential transitions by default with an explicit
  `allowNonSequential` override, flips status to `waiting_approval` when
  entering that stage, writes a human-readable `stage_changed` event).
  Dependencies (`missionRepository`, `missionEventRepository`, the
  Supabase client) are passed in as a typed `deps` object — no framework,
  no globals.

**Data-access + service layers**
- `lib/repositories/mission-repository.ts`,
  `lib/repositories/mission-event-repository.ts`,
  `lib/repositories/profile-repository.ts` — pure query functions, no
  business logic.
- `lib/services/mission-service.ts` — `createMission()` (thin wrapper
  around the workflow engine), `listMissionsForOwner()`, and
  `computeMissionControlStats()` (real aggregation over missions: running,
  completed today, waiting approval).

**Auth**
- `app/login/page.tsx` — glass panel on black background, Google + GitHub
  OAuth buttons, email input with magic-link sign-in. Magic link was chosen
  over password auth for the no-friction feel; documented inline in the
  component.
- `app/auth/callback/route.ts` — exchanges the OAuth/magic-link `code` for
  a session.

**Mission Control dashboard**
- `app/page.tsx` — server component, root `/`, fetches real data through
  `lib/services/mission-service.ts` only (no direct Supabase calls in the
  component). Eight stat cards: Running Missions, Completed Today, Waiting
  Approval are computed for real from `missions`; Revenue Pipeline,
  Meetings Scheduled, Proposal Queue, Draft Emails, Website Builds render
  as honest `$0`/`0` states with a "Coming in a future sprint" caption —
  no fake shimmer, no mocked numbers.
- `components/mission-control/mission-list.tsx` — real mission list
  (business name, URL, stage pill, created date) with a genuine empty
  state when there are zero missions.
- `components/mission-control/new-mission-dialog.tsx` — shadcn Dialog with
  URL + optional name inputs, client-side plausible-URL validation, posts
  to `POST /api/missions`, then `router.refresh()`s the list.
- `app/api/missions/route.ts` — thin route handler: auth check, input
  validation/normalization, delegates to `mission-service.createMission`.
  Explicitly does not run any analysis/scraping — comment says so.

**Docs**
- `docs/VISION.md`, this file.

## Known gaps / TODOs

- No automated tests yet (unit tests for the workflow engine and services
  would be the natural first addition — `transitionMissionStage`'s
  sequential-vs-override logic is the highest-value target).
- `transitionMissionStage()` exists in the workflow engine but nothing
  calls it yet — there's no background process or agent driving a mission
  from `recon` onward. Missions currently sit at `recon`/`active` forever
  once created.
- No Storage bucket usage yet (Supabase Storage is provisioned as a
  backend but Sprint 1 has no file/asset uploads).
- No rate limiting or abuse protection on `POST /api/missions`.
- OAuth providers (Google, GitHub) and SMTP/magic-link delivery need to be
  configured in the Supabase project dashboard before login actually
  works end-to-end — the code path is complete but depends on project-side
  provider configuration that only exists once real Supabase credentials
  are in place.
- `mission_events` has no UI beyond being written to — there's no timeline
  view on a mission yet (mentioned below as Sprint 2+ scope).
- Dialog/toast error states are minimal (inline text, no toast system).

## What Sprint 2 ("Mission Engine + Discovery") should tackle

1. **Real discovery agent** — an actual source of candidate businesses
   (directory scraping, search-based discovery, or manual seed list to
   start) that creates missions instead of relying on the manual "New
   Mission" flow alone.
2. **Opportunity scoring** — a scoring service and a `score` column (or
   related table) on missions, surfaced in Mission Control.
3. **Background job runner** — something that actually drives
   `transitionMissionStage()` over time (a queue, a cron-triggered route,
   or a durable job system) rather than leaving missions parked at
   `recon`.
4. **Connect stage transitions to real agent work** — each pipeline stage
   should trigger the corresponding agent (Research, Copywriter, Designer,
   etc.) via Claude/OpenAI, writing real output and `mission_events`
   entries as it goes, instead of the engine being purely a state machine
   with no work attached.
5. **Richer mission_events timeline UI** — a per-mission detail page
   rendering the event history chronologically, replacing the current
   list-only Mission Control view.
