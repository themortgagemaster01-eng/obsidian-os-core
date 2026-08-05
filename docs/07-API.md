# 07 — API

## Current surface: one endpoint

**`POST /api/missions`** — `app/api/missions/route.ts`. The only API route in the codebase.

### Request

```
POST /api/missions
Content-Type: application/json

{
  "websiteUrl": "https://example-business.com",   // required
  "businessName": "Acme Plumbing Co."              // optional
}
```

### Behavior, in order

1. Get the authenticated user via `supabase.auth.getUser()`. No session → `401 { "error": "Unauthorized" }`.
2. Look up the user's `profiles` row and `default_organization_id`. Missing (should be unreachable — every signup provisions one) → `400 { "error": "No default organization found for this user." }`.
3. Parse the JSON body. Malformed → `400 { "error": "Invalid JSON body" }`.
4. Validate `websiteUrl` is present (trimmed, non-empty) → `400 { "error": "websiteUrl is required" }` if missing.
5. Normalize the URL: prepend `https://` if no scheme is present, then run it through the `URL` constructor. Invalid → `400 { "error": "websiteUrl must be a valid URL" }`.
6. Default `businessName` to the normalized URL's hostname if not supplied or empty after trim.
7. Delegate to `lib/services/mission-service.ts::createMission()`, which delegates to the workflow engine's `createMission()` (insert at `discovered`, Memory Vault link, seed `MissionStarted` event — see `docs/03-Software-Architecture.md`).
8. Success → `201 { "mission": <MissionRow> }`. Any thrown error from the service layer → `500 { "error": <message> }`.

### What this endpoint deliberately does NOT do

It does not run any analysis, scraping, scoring, or AI generation — the route handler's own comment says so explicitly. Creating a mission only queues it at `discovered`; nothing currently picks it up from there (see `docs/11-Product-Roadmap.md`).

## Auth model

Supabase Auth, three sign-in paths (`app/login/page.tsx`): Google OAuth, GitHub OAuth, and an email magic link (chosen over password auth for a no-friction feel — see `docs/02-Product-Requirements.md`). Both OAuth and magic-link flows redirect to `app/auth/callback/route.ts`, which exchanges the `code` query param for a session via `supabase.auth.exchangeCodeForSession(code)` and redirects to `redirect_to` (defaulting to `/`).

Session state is cookie-based via `@supabase/ssr`. `middleware.ts` (root) + `lib/supabase/middleware.ts::updateSession()` run on every request matching the route matcher (everything except `_next/static`, `_next/image`, `favicon.ico`, and static image extensions): refresh the session, then enforce route protection — unauthenticated users hitting any non-public path are redirected to `/login`; authenticated users hitting `/login` are redirected to `/`. `/login` and `/auth/callback` (and any subpath of either) are the only public paths (`PUBLIC_PATHS` in `middleware.ts`).

Route handlers (like `POST /api/missions`) additionally check `supabase.auth.getUser()` themselves rather than relying solely on middleware having run — defense in depth, and necessary because middleware's redirect doesn't protect a route handler from being hit directly with a missing/expired session in edge cases.

## Error handling conventions (establish these for every future endpoint)

- **Auth failures → `401`** with `{ "error": "Unauthorized" }` or an equivalently short, non-leaky message.
- **Input validation failures → `400`** with a specific, actionable `{ "error": "<what's wrong>" }` — never a generic "bad request."
- **Business-rule violations surfaced by the service/workflow layer** (e.g. `transitionMissionState` throwing on an invalid transition) **→ `500`** today, since no route currently calls anything that throws a "this is actually a `4xx`" business error. As soon as a future endpoint calls something like `rejectMission()` (which throws a clear `Error` on an invalid state), that endpoint should catch the specific error and map it to `409 Conflict` or `422 Unprocessable Entity` rather than lumping every thrown error into `500` — the current single endpoint hasn't needed to make this distinction yet, but the next one will.
- **Never leak stack traces.** Catch the error, extract `err.message` if it's an `Error` instance, fall back to a generic string otherwise (`app/api/missions/route.ts`'s catch block is the template: `err instanceof Error ? err.message : "Failed to create mission"`).
- **Route handlers stay thin.** Auth check → input validation/normalization → delegate to a service function → shape the response. No business logic, no direct repository or Supabase table access, in the route handler itself.

## Shape for future endpoints

Based on the one existing endpoint and the unbuilt-but-scoped Approval Queue (`docs/05-Mission-Control.md`) and CRM (`docs/06-Database.md`) surfaces, future endpoints should follow this template:

- `GET /api/missions/[id]` — mission detail + its `mission_events` timeline, via `missionEventRepository.listByMission()`.
- `POST /api/missions/[id]/decisions` — the Approval Queue's primary write path, calling `decision-service.ts::logDecision()` and, depending on `decisionType`, a corresponding `transitionMissionState`/`rejectMission`/`archiveMission` call.
- `GET /api/companies` / `GET /api/companies/[id]` — the future CRM UI's read path over the `companies` table.

Every one of these should: require auth the same way, resolve `organization_id` the same way (never trust a client-supplied org id — always derive it from the authenticated user's membership), validate input explicitly, delegate all actual work to `lib/services`, and return errors in the same `{ "error": string }` shape with an accurate status code.
