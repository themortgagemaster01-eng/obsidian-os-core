# Technical Debt Log

Tracked, deliberate debt — not a blocker list for the sprint currently in flight. Each entry is something explicitly deferred rather than fixed at the time it was found, recorded here so it doesn't get forgotten. Per Architecture Principle 7 (`docs/MASTER_BLUEPRINT.md`), an entry here is not a substitute for fixing the thing — it's a promise to come back to it.

Format: Title, Description, Steps to Reproduce, Impact, Proposed Investigation.

---

## 1. Lighthouse adapter import breaks webpack's build-trace step during `next build`

**Status:** Resolved 2026-08-07. Filed Sprint 3 Phase 3 (2026-08-06).

**Title:** Lighthouse adapter import breaks webpack's build-trace step during `next build`.

**Description:** During `next build`'s "Collecting page data" step, any route that transitively imports `lib/adapters/lighthouse-adapter.ts` — via `lib/services/analysis-service.ts`, reached either directly or through `lib/services/analysis-types.ts`'s re-export of Phase 1's scoring helpers — triggers:

```
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of URL. Received undefined
    at Object.fileURLToPath (node:internal/url:1606:11)
```

Root cause is Lighthouse's own dependency chain (`lighthouse/core/*`, `@sentry/node`, `@opentelemetry/instrumentation`, `require-in-the-middle`) using dynamic `require()` and `import.meta.url` patterns that Next's webpack bundling can't statically resolve when traced into the Node server runtime — the same import chain also emits "Critical dependency" warnings earlier in the same build. The build does **not** fail (exit code 0): Next.js catches the error internally during page-data-collection tracing and continues, and every route still generates successfully.

**Steps to Reproduce:**
1. `npm run build`
2. Watch the console between `Collecting page data ...` and `Generating static pages`
3. One `TypeError [ERR_INVALID_ARG_TYPE]` stack trace prints per route that transitively imports `lib/adapters/lighthouse-adapter.ts` — currently `POST /api/missions/:id/analyze`, `GET /api/missions/:id/analysis`, and `/missions/[id]` (3 occurrences as of Sprint 3 Phase 3, up from 1 after the Sprint 3 Phase 2 build fix, since each new route touching the shared analysis pipeline adds another).

**Impact:** Originally filed as build-trace-only and non-blocking at runtime. **Corrected 2026-08-07** during the first real end-to-end validation against a live local Supabase instance: the same `lighthouse`/webpack bundling problem *does* reproduce at actual request time under `npm run dev`, not just during `next build`'s tracing pass. Running a real analysis (`POST /api/missions/:id/analyze`) against `katzsdelicatessen.com` produced `lighthouse_result.fetchError: "lighthouse is not a function"` — the bundled `lighthouse` import resolves to something non-callable at runtime. The adapter's own error handling caught this gracefully (no crash, no fake score — Performance renders as "Unavailable confidence" in the Opportunity Report, per the evidence-first architecture principle), so this is a missing-measurement bug, not a stability bug. Still worth resolving so Performance scoring actually works.

**Proposed Investigation:** Look at `next.config.mjs`'s `experimental.serverComponentsExternalPackages` (or `transpilePackages`) to mark `lighthouse` (and possibly `@sentry/node` / `@opentelemetry/instrumentation`) as external so webpack stops trying to bundle/trace through it — the standard fix for native/CJS-dynamic-require packages breaking Next's build tracer. Alternatively, evaluate whether a newer `lighthouse` major version has cleaner ESM/CJS interop that avoids the `import.meta` / dynamic-require patterns entirely.

**Resolution (2026-08-07):** Confirmed root cause, not guessed — verified directly against this repo's actual dependency shapes and against plain `node -e` reproductions outside any bundler, before touching code:

- Next 14.2.35 ships a built-in default list of packages it never bundles for the server (`node_modules/next/dist/lib/server-external-packages.json`). `puppeteer`/`puppeteer-core` are on that list already — which is exactly why puppeteer-based code (the screenshot adapter, and `accessibility-adapter.ts`'s own `puppeteer.launch()` call) already worked while `lighthouse`, `chrome-launcher`, and `axe-core` didn't: they simply aren't on it. Added all three to `next.config.mjs`'s `experimental.serverComponentsExternalPackages` (the correct key for Next 14.x — confirmed against this repo's own installed `next` source; the stable top-level `serverExternalPackages` doesn't exist until Next 15). This is what stops webpack from tracing into `lighthouse`'s own internal dynamic-`require()`/`import.meta.url` patterns, which is what the `ERR_INVALID_ARG_TYPE` build-trace TypeErrors above were actually coming from — those traces are gone from `next build` output entirely now, not just quieter.
- Marking `lighthouse` external was necessary but not sufficient for the runtime error on its own. `lighthouse`'s `package.json` declares `"type": "module"` — it's ESM-only. `node -e "console.log(typeof require('lighthouse'))"` (plain Node, Node 24, no webpack involved at all) prints `object`, not `function`: Node's own native `require(esm)` interop wraps an ESM module's exports as `{ default, ...namedExports, __esModule: true }` rather than handing back the default export directly. The adapter's `const lighthouse = require("lighthouse")` was therefore never going to be callable, regardless of bundling — that's the literal, direct cause of `"lighthouse is not a function"`. Worse, once `lighthouse` was marked external, Next's own webpack loader started rejecting the `require()` call outright at compile time (`Module not found: ESM packages (lighthouse) need to be imported. Use 'import' to reference the package instead.`) — Next explicitly disallows `require()` of an ESM package even when external. Fixed in `lib/adapters/lighthouse-adapter.ts` by replacing the top-level `require("lighthouse")` with a cached dynamic `import("lighthouse")`, unwrapped to `.default`.
- A second, distinct bug surfaced only once the above got far enough to actually invoke Lighthouse and reach cleanup: `chrome-launcher`'s `kill()` synchronously `rm`'s its temp user-data-dir (`chrome-launcher/dist/chrome-launcher.js`'s `destroyTmp()`) immediately after force-killing Chrome; on this Windows machine the OS was still holding a file lock at that instant often enough to be effectively deterministic in this environment, throwing `EPERM`. Because this happened in the adapter's own `finally` block, it wasn't caught by the adapter's `try/catch`, and because all seven adapters run under one `Promise.all` in `analysis-service.ts`, it took down the *entire* analysis run — including the six other adapters (among them `axe-core`) whose results never got persisted, not because they failed, but because Lighthouse's cleanup did. Fixed by wrapping `chrome?.kill()` in its own `try/catch` in `lighthouse-adapter.ts`: a failure to delete a temp directory is housekeeping, not a measurement failure, and must never discard six adapters' worth of real, already-succeeded results.

Verified via two independent real end-to-end runs (`katzsdelicatessen.com`, `veslofamilyrestaurant.com`) after the fix: both produced real Lighthouse scores (`performance`, `accessibility`, `bestPractices`, `seo`, all non-null) and real named-audit values (LCP, TBT, CLS, Speed Index, TTI), zero `fetchError`. `npm run build` and `npm test` (27/27) both still pass.

---

## 2. `storage.objects` has no RLS policy for the `website-screenshots` bucket

**Status:** Open. Carried forward from Sprint 3 design doc Open Question 6, made concrete during Phase 3 UI work (2026-08-06). Non-blocking.

**Title:** No `storage.objects` RLS policy exists for the private `website-screenshots` bucket, so signed-URL screenshot rendering silently returns unavailable.

**Description:** `supabase/migrations/0007_website_analysis.sql` creates the `website-screenshots` Storage bucket as private (`public = false`) but adds no `storage.objects` RLS policy granting org members `select` on it. `lib/presentation/resolve-screenshot-url.ts` (Phase 3) calls `createSignedUrl()` using the requesting user's own RLS-scoped session, deliberately never the service-role client (`lib/supabase/service-role.ts` is documented as being for the background worker only). Without a policy, `createSignedUrl()` returns a permission error for every user, so the report's Screenshot section always renders its honest "unavailable" placeholder instead of the real capture, regardless of whether a screenshot was actually captured.

**Steps to Reproduce:**
1. Run an analysis to completion for a mission where the screenshot adapter succeeds (`website_analyses.screenshot_url` is non-null).
2. Load `/missions/[id]` (or `GET /api/missions/:id/analysis`) as an org member.
3. `resolveScreenshotUrl()` returns `null` — the Screenshot section shows "No screenshot is available for this analysis" even though one exists in Storage.

**Impact:** Screenshots never render in the Opportunity Report today, independent of whether the screenshot adapter itself succeeds — a real Storage/RLS gap, not a UI bug and not an adapter failure. Design doc Open Question 6 ("public read vs. signed URLs, retention period, size limits") is the right place to resolve this; Phase 3 deliberately did not add a migration to work around it, since that's a backend policy decision outside Presentation Layer scope.

**Proposed Investigation:** Add a `storage.objects` RLS policy scoped to the `website-screenshots` bucket, gated by the same `is_org_member(organization_id)` pattern used everywhere else — likely requires parsing `organization_id` out of the object's storage path (`${organizationId}/${missionId}/${analysisId}/${fileName}`, per `analysis-service.ts`'s `uploadScreenshot`) inside the policy's `using`/`with check` expression. Needs a founder decision on retention/size limits per Open Question 6 before finalizing.

**Resolution:** Fixed 2026-08-06 — see `supabase/migrations/0008_screenshot_storage_policy.sql`. Verified working during the 2026-08-07 real end-to-end validation run: `resolveScreenshotUrl()` returned a valid signed URL (three `200 OK` responses observed) and the screenshot rendered in the Opportunity Report UI for a real analysis.

---

## 3. `axe-core` accessibility adapter fails at runtime with `exports is not defined`

**Status:** Resolved 2026-08-07. Filed 2026-08-07 during the first real end-to-end validation run.

**Title:** The accessibility adapter (`axe-core`, invoked server-side) fails on every real analysis with `exports is not defined`, so Accessibility always renders as "Unavailable confidence" in the Opportunity Report.

**Description:** Running a real analysis against `katzsdelicatessen.com` produced `accessibility_result.fetchError: "exports is not defined"` with zero violations, zero passes, and zero incomplete checks recorded — the audit never actually ran. This has the same shape as tech debt item 1 (Lighthouse): a Node-native/CJS library (`axe-core`, likely driven through Puppeteer server-side) hitting a CJS/ESM interop failure when bundled by Next's webpack for the server runtime. The failure is caught gracefully — no crash, no fabricated score, an honest "unavailable" is shown, consistent with the evidence-first architecture principle — but Accessibility measurement does not currently work at all in this pipeline, which is a significant gap given accessibility is one of the report's four scored categories and directly cited as a "high" severity recommendation in the same report (from the SEO/crawl-based accessibility-adjacent findings, not from axe-core itself).

**Steps to Reproduce:**
1. Run a real website analysis (`POST /api/missions/:id/analyze`) against any live site.
2. Query `website_analyses.accessibility_result` — `fetchError` is `"exports is not defined"`, `accessibility_score` defaults to `0`.
3. The Opportunity Report's Accessibility section shows "Unavailable confidence" instead of a real score.

**Impact:** Accessibility scoring has likely never worked in any local or hosted run to date — this is not a regression, it's a previously-undiscovered gap that real end-to-end validation surfaced for the first time (prior testing evidently never checked `website_analyses.accessibility_result.fetchError` directly). One of four report categories is effectively non-functional.

**Proposed Investigation:** Same family of fix as item 1 — mark `axe-core` (and whatever Puppeteer/axe integration package is used) as an external package via `next.config.mjs`'s `serverComponentsExternalPackages` so webpack stops bundling/tracing through its CJS internals. Worth investigating items 1 and 3 together, since they're likely the same root cause hitting two different adapters.

**Resolution (2026-08-07):** Root cause confirmed to genuinely be webpack-bundling-specific (unlike item 1's lighthouse, this one really is exactly what it looked like). `axe-core`'s own main entry is plain CJS (no `"type": "module"`), and `require("axe-core").source` — the exact call `accessibility-adapter.ts` makes — works correctly under plain `node -e`, no bundler involved, returning the expected ~1.3MB UMD source string cleanly. That confirms the package itself isn't broken; something specific to Next's webpack bundling of it was. Added `axe-core` to `next.config.mjs`'s `experimental.serverComponentsExternalPackages` alongside `lighthouse`/`chrome-launcher` (see item 1's resolution for why that's the correct config key for this repo's Next 14.2.35, and why `puppeteer` — used in this same adapter — never needed it). No code changes were needed in `accessibility-adapter.ts` itself; the existing `require`-free `import { source as axeSource } from "axe-core"` was always correct, it just needed webpack to leave the package alone. Verified via two independent real end-to-end runs (`katzsdelicatessen.com`: 3 real violations, 90-something passes; `veslofamilyrestaurant.com`: 2 real violations, 41 passes, 3 incomplete) — zero `fetchError`, real violation data with real `impact`/`nodeCount` values in both.

---

## 4. Windows Chrome Temporary Directory Cleanup

**Description:** Temporary Chrome profile directories may remain after analysis if Windows prevents deletion during browser shutdown.

**Impact:** Low

**Severity:** Low

**Risk:** Temporary disk usage increases over time.

**Recommended Resolution:** Investigate retry logic or deferred cleanup after browser termination.

**Status:** Deferred

**Note:** Not a Sprint 3 blocker.

**Engineering detail (for the "investigate" step, when picked up):** Surfaced 2026-08-07 while validating the item 1 fix above — with `lighthouse` finally invocable, `runLighthouseAdapter()` in `lib/adapters/lighthouse-adapter.ts` reached its `finally` block for the first time, where `chrome-launcher`'s `kill()` synchronously calls `destroyTmp()` (`chrome-launcher/dist/chrome-launcher.js`), which `rm`'s the launched instance's temp user-data-dir immediately after force-killing the Chrome process via `taskkill`. On this Windows machine, the OS can still be holding a file lock on that directory at the instant `rmSync` runs — observed reliably in this environment — throwing `EPERM`. Because this happened inside the adapter's own `finally` block, it wasn't caught by the adapter's `try/catch` around the actual Lighthouse scan, and because all seven Sprint 3 adapters run under one `Promise.all` in `lib/services/analysis-service.ts`, an uncaught `EPERM` here failed the *entire* analysis run — discarding six other adapters' real, already-succeeded results (including axe-core's, item 3 above) over what is ultimately a housekeeping failure, not a measurement failure.

**Why the current guard is safe:** `lib/adapters/lighthouse-adapter.ts`'s `finally` block wraps only `chrome?.kill()` in its own `try/catch`, logging via `console.warn` on failure rather than staying silent. This is scoped narrowly to cleanup: it runs after the Lighthouse scan has already either returned a real result or been recorded as a graceful `fetchError` in the adapter's own `catch` block above it, so swallowing a cleanup exception here cannot mask, alter, or fabricate a measurement — it only prevents a disk-cleanup failure from crashing a request that has already done its real work. The `console.warn` keeps the failure visible in server logs (not hidden) so a future, worse failure mode than "temp dir didn't delete" — e.g. Chrome not actually terminating — would still surface to whoever is watching logs, rather than failing silently forever.

**Remaining limitations:** The directory leak itself is not fixed, only prevented from crashing the analysis run — an orphaned `lighthouse.*` directory under the OS temp folder persists on disk after an `EPERM`. No retry loop or deferred cleanup was implemented (that's the "Recommended Resolution" above, deliberately left for a future pass). Whether this is Windows-dev-only or could recur on the eventual production hosting platform is unconfirmed — not tested on Linux/CI in this pass. Confidence is high that the guard itself (catch + log, never crash) is correct and safe regardless of platform; confidence is lower on how often the underlying race actually fires outside this specific machine.
