import puppeteer from "puppeteer";

import type { RenderedPreviewCookie } from "@/lib/adapters/rendered-preview-adapter";

/**
 * qa-preview-access.ts — the "smallest secure mechanism" evaluated by
 * docs/SPRINT_4_PHASE_4_DESIGN_REVIEW.md §4.5/§4.6/§4.7's disclosed
 * dependency: the Design Preview route (app/missions/[id]/preview/page.tsx)
 * requires a real authenticated session, and headless QA tooling
 * (rendered-preview-adapter.ts, accessibility-adapter.ts,
 * lighthouse-adapter.ts) has no session of its own.
 *
 * What this deliberately does NOT do, per the founder's explicit
 * instruction: make the preview route public, bypass RLS, use a
 * service-role client to fetch preview data, or grant QA tooling any
 * broader access than a real user already has. What it DOES do: drive the
 * exact same real, existing magic-link sign-in flow a human already uses
 * (app/login/page.tsx's own `supabase.auth.signInWithOtp` call, the real
 * GoTrue mailer, the real local Mailpit inbox, the real
 * app/auth/callback/route.ts code-exchange) end to end, automated only in
 * the sense that a script reads the email out of Mailpit's REST API instead
 * of a human clicking a link — the identical real-auth path
 * docs/SPRINT_STATUS.md's own "Rendering capability" validation entry
 * already used by hand ("Signed in as the existing local validation user
 * via the real magic-link flow (Mailpit)"). The resulting session cookies
 * are a real, RLS-scoped `is_org_member(organization_id)` identity — QA
 * tooling can only ever see what that one real account can see, same as
 * any other user.
 *
 * Every input is environment configuration, none hardcoded, and every one
 * is required — if any is missing, `resolveQaPreviewAccessConfig()` returns
 * null and Rendered QA reads UNAVAILABLE rather than silently defaulting to
 * some account. This is deliberately opt-in: a production deployment with
 * no QA_PREVIEW_* env vars configured gets zero behavior change and zero
 * new attack surface from this module.
 */

export interface QaPreviewAccessConfig {
  /** e.g. "http://localhost:3000" — the running Next.js app to authenticate against. */
  appBaseUrl: string;
  /** e.g. "http://localhost:54324" — local Mailpit's REST API base. */
  mailpitBaseUrl: string;
  /** A real, already-existing org-member account this QA run signs in as — never created or granted access by this module itself. */
  validationUserEmail: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function resolveQaPreviewAccessConfig(env: NodeJS.ProcessEnv = process.env): QaPreviewAccessConfig | null {
  const appBaseUrl = env.QA_PREVIEW_APP_BASE_URL;
  const mailpitBaseUrl = env.QA_PREVIEW_MAILPIT_URL;
  const validationUserEmail = env.QA_PREVIEW_VALIDATION_USER_EMAIL;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!appBaseUrl || !mailpitBaseUrl || !validationUserEmail || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  return { appBaseUrl, mailpitBaseUrl, validationUserEmail, supabaseUrl, supabaseAnonKey };
}

export interface QaPreviewAccessAvailable {
  available: true;
  cookies: RenderedPreviewCookie[];
  /** Same cookies, pre-joined for Lighthouse's `extraHeaders.Cookie` (lib/adapters/lighthouse-adapter.ts). */
  cookieHeader: string;
}
export interface QaPreviewAccessUnavailable {
  available: false;
  reason: string;
}
export type QaPreviewAccess = QaPreviewAccessAvailable | QaPreviewAccessUnavailable;

/**
 * Finds the real Supabase verify link inside a magic-link email body —
 * pure and independently testable against a static fixture, unlike the rest
 * of this module (real network calls). Supabase's default magic-link
 * template points at `${SUPABASE_URL}/auth/v1/verify?token=...&type=
 * magiclink&redirect_to=...` — GoTrue verifies the token server-side and
 * redirects to `redirect_to` (app/auth/callback's `code` param, for this
 * app's PKCE flow — see app/login/page.tsx's `emailRedirectTo`), so
 * navigating a real browser straight to this link performs the entire real
 * verification + redirect + cookie-setting chain exactly as a human
 * clicking it would.
 */
export function extractConfirmationLink(emailBody: string, supabaseUrl: string): string | null {
  const escapedBase = supabaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedBase}/auth/v1/verify[^"'\\s<>]*`, "i");
  const match = emailBody.match(pattern);
  if (!match) return null;
  return match[0].replace(/&amp;/g, "&");
}

interface MailpitMessageSummary {
  ID: string;
  To: { Address: string }[];
}

interface MailpitMessageFull {
  HTML?: string;
  Text?: string;
}

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

async function pollForConfirmationLink(config: QaPreviewAccessConfig): Promise<string | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const listResponse = await fetch(`${config.mailpitBaseUrl}/api/v1/messages?limit=25`).catch(() => null);
    if (listResponse?.ok) {
      const list = (await listResponse.json()) as { messages?: MailpitMessageSummary[] };
      const match = (list.messages ?? []).find((m) =>
        (m.To ?? []).some((t) => t.Address === config.validationUserEmail)
      );
      if (match) {
        const messageResponse = await fetch(`${config.mailpitBaseUrl}/api/v1/message/${match.ID}`).catch(() => null);
        if (messageResponse?.ok) {
          const full = (await messageResponse.json()) as MailpitMessageFull;
          const link = extractConfirmationLink(full.HTML ?? full.Text ?? "", config.supabaseUrl);
          if (link) return link;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null;
}

const EMAIL_SENT_TIMEOUT_MS = 10_000;

/**
 * acquireQaPreviewAccess — the orchestration function. Drives the entire
 * real sign-in flow through ONE Puppeteer page/browser context, exactly as
 * a human would: navigates to the app's own /login page, fills in and
 * submits the real form (app/login/page.tsx's own `handleMagicLink`,
 * calling the app's real browser Supabase client — lib/supabase/client.ts,
 * which uses @supabase/ssr's PKCE flow by default), waits for the real
 * confirmation email, then navigates that SAME page to the link. Driving
 * the OTP request through the app's own UI (rather than a separate,
 * out-of-band `signInWithOtp` call) matters concretely, not just
 * stylistically: @supabase/ssr's browser client stores a PKCE code_verifier
 * in a cookie at request time, and only a page holding that same cookie can
 * complete the code exchange when the confirmation link redirects back —
 * a separate Node client requesting the OTP produces a link this Puppeteer
 * page can't actually complete the exchange for.
 *
 * Real network/browser I/O throughout; never throws — every failure path
 * (the login page doesn't respond, no email arrives, the link doesn't
 * yield a session) resolves to `{ available: false, reason }` so a caller
 * reports UNAVAILABLE honestly rather than crashing the whole QA run over
 * an auth dependency.
 */
export async function acquireQaPreviewAccess(config: QaPreviewAccessConfig): Promise<QaPreviewAccess> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    await page.goto(`${config.appBaseUrl}/login`, { waitUntil: "networkidle2", timeout: 20_000 });
    await page.waitForSelector("#email", { timeout: 10_000 });
    await page.type("#email", config.validationUserEmail);
    await page.click('button[type="submit"]');

    try {
      await page.waitForFunction(
        (email: string) => document.body.innerText.includes(email),
        { timeout: EMAIL_SENT_TIMEOUT_MS },
        config.validationUserEmail
      );
    } catch {
      return {
        available: false,
        reason: `The login form did not confirm a sign-in link was sent within ${EMAIL_SENT_TIMEOUT_MS / 1000}s.`,
      };
    }

    const confirmationLink = await pollForConfirmationLink(config);
    if (!confirmationLink) {
      return {
        available: false,
        reason: `No sign-in email arrived for ${config.validationUserEmail} in Mailpit within ${POLL_TIMEOUT_MS / 1000}s.`,
      };
    }

    // "domcontentloaded", not "networkidle2": all this navigation needs is
    // the Set-Cookie response from the real code-exchange redirect chain
    // (verify -> app/auth/callback -> the app's home page) — the
    // destination page's own client JS/websocket activity (e.g. Next dev's
    // HMR connection) can keep a stricter network-idle condition from ever
    // resolving, which is irrelevant to whether the session cookie was
    // actually set.
    await page.goto(confirmationLink, { waitUntil: "domcontentloaded", timeout: 20_000 });

    const allCookies = await page.cookies(config.appBaseUrl);
    const sessionCookies = allCookies.filter((c) => c.name.startsWith("sb-"));
    if (sessionCookies.length === 0) {
      return {
        available: false,
        reason: `Magic-link navigation completed but produced no session cookie (landed at ${page.url()}).`,
      };
    }

    const cookies: RenderedPreviewCookie[] = sessionCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
    }));
    return { available: true, cookies, cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : "Failed to acquire authenticated QA preview access.",
    };
  } finally {
    await browser?.close();
  }
}
