/**
 * Fix C (Design Intelligence Gap Map) — shared Chrome-launch resolution for
 * the three adapters that need a real headless Chrome: screenshot-adapter.ts
 * and accessibility-adapter.ts (via Puppeteer), and lighthouse-adapter.ts
 * (via chrome-launcher). Real production incidents (Video Game Plus and
 * Dante's Trattoria, 2026-09-11) confirmed Puppeteer's own
 * installed-at-build-time Chrome binary doesn't reliably persist into the
 * Vercel Fluid Compute request runtime — there is no Chrome binary present
 * at request time at all, so no `executablePath`/`CHROME_PATH` override
 * alone can fix this. A real, serverless-packaged Chromium is required.
 *
 * @sparticuz/chromium-min (the "-min" variant, not the ~50MB+ full
 * `@sparticuz/chromium` package) fetches its Chromium binary from a remote
 * tar on first cold start and caches it to /tmp for reuse across warm
 * Fluid Compute invocations of the same instance. The "-min" package was
 * chosen specifically to stay clear of Vercel's 250MB unzipped
 * function-size limit — the same function already bundles
 * lighthouse/axe-core/cheerio, and the full package's bundled Chromium
 * alone exceeds 50MB compressed. The tradeoff: the first Chrome launch on
 * each cold instance now pays a real network-fetch latency it didn't pay
 * before (subsequent warm invocations reuse the cached /tmp binary).
 *
 * Version pairing: @sparticuz/chromium-min@130.0.0 packages Chromium
 * 130.0.6723.x, matching puppeteer-core@23.6.0's own pinned Chrome build
 * (130.0.6723.58, per puppeteer-core's lib/cjs/puppeteer/revisions.js) —
 * see https://pptr.dev/chromium-support for how these two version numbers
 * are meant to be kept in lockstep. Bumping puppeteer/puppeteer-core
 * without bumping @sparticuz/chromium-min to match (or vice versa) is a
 * real way to reintroduce this exact failure class.
 *
 * Only active on Vercel (`process.env.VERCEL` is set for every Vercel
 * deployment, preview or production) — @sparticuz/chromium-min's binary is
 * Linux-only and won't run on a local Windows/macOS dev machine, so local
 * dev keeps using the ordinary `puppeteer` package's own auto-downloaded
 * Chrome, byte-for-byte the same behavior as before this fix.
 */

const REMOTE_CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v130.0.0/chromium-v130.0.0-pack.tar";

export function isServerlessChromeRuntime(): boolean {
  return !!process.env.VERCEL;
}

async function resolveServerlessExecutablePath(): Promise<string> {
  const chromium = (await import("@sparticuz/chromium-min")).default;
  return chromium.executablePath(REMOTE_CHROMIUM_PACK_URL);
}

export interface ChromeLaunchConfig {
  /** `chromePath` for chrome-launcher — undefined lets it auto-detect a local install, matching pre-fix behavior. */
  chromePath: string | undefined;
  chromeFlags: string[];
}

/** For lighthouse-adapter.ts's chrome-launcher.launch({ chromePath, chromeFlags }). */
export async function resolveChromeLaunchConfig(): Promise<ChromeLaunchConfig> {
  if (!isServerlessChromeRuntime()) {
    return { chromePath: undefined, chromeFlags: ["--headless", "--no-sandbox"] };
  }
  const chromium = (await import("@sparticuz/chromium-min")).default;
  return { chromePath: await resolveServerlessExecutablePath(), chromeFlags: chromium.args };
}

/** For screenshot-adapter.ts and accessibility-adapter.ts's puppeteer.launch(). */
export async function launchChrome(): Promise<import("puppeteer-core").Browser> {
  if (!isServerlessChromeRuntime()) {
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    // puppeteer ships its own duplicate copy of puppeteer-core's Browser
    // declaration file, so TypeScript treats the two as nominally distinct
    // (a private class field defeats structural comparison) even though
    // `puppeteer` is a thin runtime wrapper around `puppeteer-core` and
    // this is a real puppeteer-core Browser instance either way.
    return browser as unknown as import("puppeteer-core").Browser;
  }
  const chromium = (await import("@sparticuz/chromium-min")).default;
  const puppeteerCore = (await import("puppeteer-core")).default;
  return puppeteerCore.launch({
    args: chromium.args,
    executablePath: await resolveServerlessExecutablePath(),
    headless: true,
  });
}
