import puppeteer from "puppeteer";
import { source as axeSource } from "axe-core";

import type { AccessibilityRawResult, AccessibilityViolation } from "@/lib/adapters/types";

const NAV_TIMEOUT_MS = 20_000;

interface AxeResultLike {
  violations: Array<{
    id: string;
    impact: string | null;
    description: string;
    help: string;
    nodes: unknown[];
  }>;
  passes: unknown[];
  incomplete: unknown[];
}

export interface AccessibilityAdapterOptions {
  /**
   * Real, already-authenticated session cookies (docs/
   * SPRINT_4_PHASE_4_DESIGN_REVIEW.md §4.6/§4.7's disclosed dependency: an
   * authenticated route has nothing for a cookie-less headless Chrome to
   * load). Optional and additive — every existing caller (the Analysis
   * Engine, auditing a target business's public site) passes none and gets
   * byte-for-byte the same behavior as before this option existed.
   */
  cookies?: { name: string; value: string; domain: string; path?: string }[];
}

/**
 * accessibility-adapter — runs a real axe-core audit against the rendered
 * page via headless Chrome (docs/SPRINT_3_DESIGN_REVIEW.md §1, §8: the
 * Accessibility category's primary data source, alongside Lighthouse's
 * accessibility category). Launches its own isolated browser instance per
 * call rather than sharing one with lighthouse-adapter or screenshot-
 * adapter — simpler and safer than pooling given each adapter runs
 * independently and this is v1, at the cost of some redundant Chrome
 * startup time (§15 risk #1 already flags headless-browser cost as an
 * open resourcing question).
 *
 * Pure function: URL in, raw findings out. No Supabase, no mission
 * concept.
 */
export async function runAccessibilityAdapter(
  targetUrl: string,
  options: AccessibilityAdapterOptions = {}
): Promise<AccessibilityRawResult> {
  const emptyByImpact = { minor: 0, moderate: 0, serious: 0, critical: 0 };

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    if (options.cookies && options.cookies.length > 0) {
      await page.setCookie(
        ...options.cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path ?? "/" }))
      );
    }
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });

    await page.evaluate(axeSource);
    const axeResult = (await page.evaluate(() => {
      // @ts-expect-error — axe is injected onto window by axeSource above.
      return window.axe.run();
    })) as AxeResultLike;

    const violations: AccessibilityViolation[] = axeResult.violations.map((v) => ({
      id: v.id,
      impact: (v.impact as AccessibilityViolation["impact"]) ?? null,
      description: v.description,
      help: v.help,
      nodeCount: v.nodes.length,
    }));

    const violationCountByImpact = { ...emptyByImpact };
    for (const v of violations) {
      if (v.impact && v.impact in violationCountByImpact) {
        violationCountByImpact[v.impact] += 1;
      }
    }

    return {
      violations,
      passCount: axeResult.passes.length,
      incompleteCount: axeResult.incomplete.length,
      violationCountByImpact,
    };
  } catch (err) {
    return {
      violations: [],
      passCount: 0,
      incompleteCount: 0,
      violationCountByImpact: emptyByImpact,
      fetchError: err instanceof Error ? err.message : "Failed to run accessibility audit",
    };
  } finally {
    await browser?.close();
  }
}
