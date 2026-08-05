# 08 — Integrations

This document exists to prevent a common failure mode in AI-agency-style products: implying an integration works because an env var for it exists. Every integration below is labeled by its real status — verify against `.env.example` and a code search for the provider's SDK/client before assuming otherwise.

## Live today

**Supabase** (Postgres + Auth + Storage client libraries). The only real, working integration in the codebase. `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server), `lib/supabase/middleware.ts` (session refresh) are all real, working code paths exercised by every page load and the one API route. Storage is provisioned as a backend capability but has zero usage in the codebase — no file/asset upload exists yet.

## Env-ready, not called by any code

**Anthropic (`ANTHROPIC_API_KEY`)** — the designated primary AI provider per the product's original brief. Present in `.env.example`. **No code anywhere imports an Anthropic SDK or makes a call to it.** This is the single largest gap between the product's premise and Sprint 2's actual code — every agent described in `docs/04-AI-Systems.md` depends on this being wired up, and none of them exist yet.

**OpenAI (`OPENAI_API_KEY`)** — the designated fallback provider. Same status: env placeholder only, zero code.

When these are wired up (Sprint 3+), the expected shape, consistent with the layering rules in `docs/03-Software-Architecture.md`, is a new `lib/ai/` (or similar) module providing a typed client wrapper that `lib/services` (or a new `lib/agents` layer) calls — not a raw SDK call scattered inside a repository or a route handler.

## Future, not integrated at all

**Gmail API / Microsoft Graph** — for the Email Agent to create real Gmail/Outlook drafts (never send — see the trust boundary in `docs/01-Product-Vision.md`). `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` exist in `.env.example` but are currently only used for Google **OAuth sign-in** (`app/login/page.tsx`'s "Continue with Google" button), not for Gmail API scopes — signing in with Google today grants no Gmail access. Adding real Gmail draft creation will need broader OAuth scopes requested at sign-in or a separate connection flow, plus the Gmail API client itself, none of which exists.

**Stripe** — billing, for once there's a monetizable multi-tenant product. `STRIPE_SECRET_KEY` exists in `.env.example`. Zero code. Depends on the `organizations.plan` column (already in the schema — `trial`/`starter`/`pro`/`agency`/`white_label`) eventually being enforced by something, which it currently isn't; `plan` is just a stored value today with no billing logic reading or writing it beyond its default.

**GitHub** — the deployment pipeline (likely: pushing a generated site to a repo as part of a Deployment Agent's preview-build flow). `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` exist in `.env.example` but, like Google, are currently only used for **GitHub OAuth sign-in**, not any GitHub API/deployment usage.

**Cloudflare** — the other half of the deployment pipeline (likely: Cloudflare Pages or Workers for hosting a generated preview). `CLOUDFLARE_API_TOKEN` exists in `.env.example`. Zero code.

## Summary table

| Integration | Status | Real code exists? |
|---|---|---|
| Supabase (Postgres/Auth) | Live | Yes — the entire data layer |
| Google OAuth (sign-in only) | Live | Yes — `app/login/page.tsx` |
| GitHub OAuth (sign-in only) | Live | Yes — `app/login/page.tsx` |
| Anthropic | Env placeholder | No |
| OpenAI | Env placeholder | No |
| Gmail API / Microsoft Graph | Not started | No |
| Stripe | Not started | No |
| GitHub API (deployment) | Not started | No |
| Cloudflare | Not started | No |

Note the important distinction in the Google/GitHub row: the OAuth *sign-in* integration is real and working, but that is a completely separate concern from a future Gmail-draft or GitHub-deployment integration that happens to use the same provider — don't conflate "we have Google OAuth" with "we can create Gmail drafts."
