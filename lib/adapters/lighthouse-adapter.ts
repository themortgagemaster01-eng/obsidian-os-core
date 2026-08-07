import * as chromeLauncher from "chrome-launcher";

import type { LighthouseRawResult } from "@/lib/adapters/types";

/**
 * Lighthouse's published TS typings are inconsistent across versions and
 * don't reliably describe its CommonJS default export. Rather than couple
 * this adapter's compile-ability to whichever @types happen to be
 * installed, it's required dynamically and cast to a small local shape
 * covering only what this adapter actually reads from the result —
 * everything else in lhr is intentionally untouched by the type system
 * here, matching the "raw, vendor-shaped, not guaranteed stable" nature
 * of this layer (§3.1).
 */
interface LighthouseAuditResult {
  title: string;
  numericValue?: number;
  displayValue?: string;
}
interface LighthouseCategoryResult {
  score: number | null;
}
interface LighthouseRunnerResult {
  lhr: {
    categories?: Record<string, LighthouseCategoryResult | undefined>;
    audits?: Record<string, LighthouseAuditResult | undefined>;
  };
}
type LighthouseRunner = (
  url: string,
  flags: { port?: number; output?: string; logLevel?: string; onlyCategories?: string[] }
) => Promise<LighthouseRunnerResult | undefined>;

// lighthouse's package.json declares "type": "module" — it's ESM-only, and
// Next's webpack loader rejects a CJS require() of an ESM package outright
// ("ESM packages (lighthouse) need to be imported"), even with the package
// marked external. A dynamic import() is required; the real runner is at
// the resulting module's `.default` (docs/TECH_DEBT.md item 1).
let lighthousePromise: Promise<LighthouseRunner> | undefined;
function getLighthouseRunner(): Promise<LighthouseRunner> {
  if (!lighthousePromise) {
    lighthousePromise = import("lighthouse").then(
      (mod) => (mod as unknown as { default: LighthouseRunner }).default
    );
  }
  return lighthousePromise;
}

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

// Audit ids worth surfacing in the raw layer for later insight generation
// (§1: insight-service.ts tags each insight with the specific measurement
// it came from) — kept small and named rather than dumping Lighthouse's
// full audit list, which runs into the hundreds.
const AUDITS_OF_INTEREST = [
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
  "interactive",
];

function toScore100(score: number | null | undefined): number | null {
  if (score === null || score === undefined) return null;
  return Math.round(score * 100);
}

/**
 * lighthouse-adapter — runs Google Lighthouse against the target URL via a
 * locally launched headless Chrome (docs/SPRINT_3_DESIGN_REVIEW.md §1, §8:
 * the Performance category's sole data source, and a contributor to
 * Accessibility). Returns the four 0-100 category scores plus a handful of
 * named Core Web Vitals audits.
 *
 * Pure function: URL in, raw findings out. Launches and tears down its own
 * Chrome instance per call, same tradeoff noted in accessibility-adapter.ts.
 */
export async function runLighthouseAdapter(targetUrl: string): Promise<LighthouseRawResult> {
  const emptyScores = {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
  };

  let chrome: chromeLauncher.LaunchedChrome | null = null;
  try {
    chrome = await chromeLauncher.launch({ chromeFlags: ["--headless", "--no-sandbox"] });

    const lighthouse = await getLighthouseRunner();
    const runnerResult = await lighthouse(targetUrl, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: [...CATEGORIES],
    });

    if (!runnerResult?.lhr) {
      throw new Error("Lighthouse did not return a result.");
    }

    const { lhr } = runnerResult;

    const audits: LighthouseRawResult["audits"] = {};
    for (const auditId of AUDITS_OF_INTEREST) {
      const audit = lhr.audits?.[auditId];
      if (audit) {
        audits[auditId] = {
          title: audit.title,
          numericValue: audit.numericValue ?? undefined,
          displayValue: audit.displayValue ?? undefined,
        };
      }
    }

    return {
      scores: {
        performance: toScore100(lhr.categories?.performance?.score),
        accessibility: toScore100(lhr.categories?.accessibility?.score),
        bestPractices: toScore100(lhr.categories?.["best-practices"]?.score),
        seo: toScore100(lhr.categories?.seo?.score),
      },
      audits,
    };
  } catch (err) {
    return {
      scores: emptyScores,
      audits: {},
      fetchError: err instanceof Error ? err.message : "Failed to run Lighthouse",
    };
  } finally {
    // chrome-launcher's kill() synchronously rm's the temp user-data-dir
    // (chrome-launcher/dist/chrome-launcher.js's destroyTmp()) immediately
    // after force-killing the Chrome process; on Windows the OS can still
    // hold a file lock at that instant, throwing EPERM. That's a cleanup
    // failure, not a measurement failure — the scan above already
    // succeeded or was already recorded as a graceful fetchError — so it
    // must not crash the adapter (and, since this runs inside a
    // Promise.all with the other six adapters, must not take down the
    // entire analysis run over what's ultimately an orphaned temp dir).
    try {
      await chrome?.kill();
    } catch (err) {
      // Best-effort cleanup only; a leaked lighthouse.* temp dir under the
      // OS temp folder is a non-issue compared to losing a real result.
      // Logged (not silent) so a future failure mode worse than "temp dir
      // didn't delete" — e.g. Chrome itself didn't actually die — is still
      // visible to whoever's watching server logs.
      // eslint-disable-next-line no-console
      console.warn("[lighthouse-adapter] chrome.kill() cleanup failed:", err);
    }
  }
}
