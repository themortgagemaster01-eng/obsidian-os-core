import * as cheerio from "cheerio";

import type { MobileRawResult } from "@/lib/adapters/types";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_STYLESHEETS = 3;
const USER_AGENT = "ObsidianOS-AnalysisBot/1.0 (+https://obsidianos.example/bot)";
const SMALL_FONT_PX_THRESHOLD = 12;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function countMediaQueries(css: string): number {
  return (css.match(/@media[^{]+\{/gi) ?? []).length;
}

function countSmallFontDeclarations(css: string): number {
  const matches = css.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi) ?? [];
  return matches.filter((decl) => {
    const value = parseFloat(decl.replace(/[^\d.]/g, ""));
    return value > 0 && value < SMALL_FONT_PX_THRESHOLD;
  }).length;
}

/**
 * mobile-analysis-adapter — mobile-friendliness signals independent of
 * Lighthouse (docs/SPRINT_3_DESIGN_REVIEW.md §1, §8: Lighthouse covers
 * Performance; this adapter is the Mobile category's data source). Static
 * HTML/CSS analysis rather than a real device-emulation pass — checks for
 * a viewport meta tag (and whether it disables user zoom, an accessibility
 * anti-pattern), counts responsive @media breakpoints across a bounded
 * sample of linked stylesheets plus inline <style> blocks, and flags
 * small (<12px) font-size declarations that are hard to read on a phone.
 *
 * Pure function: URL in, raw findings out. No headless browser dependency,
 * so it stays cheap and fast even though it can't see computed/rendered
 * layout the way a real device emulation would.
 */
export async function runMobileAnalysisAdapter(targetUrl: string): Promise<MobileRawResult> {
  let response: Response;
  let html: string;
  try {
    response = await fetchWithTimeout(targetUrl);
    html = await response.text();
  } catch (err) {
    return {
      hasViewportMeta: false,
      viewportContent: null,
      usesUserScalableNo: false,
      mediaQueryCount: 0,
      stylesheetsChecked: 0,
      smallFontDeclarationCount: 0,
      fetchError: err instanceof Error ? err.message : "Failed to fetch target URL",
    };
  }

  const $ = cheerio.load(html);
  const finalUrl = response.url || targetUrl;

  const viewportContent = $('meta[name="viewport"]').attr("content") ?? null;
  const hasViewportMeta = viewportContent !== null;
  const usesUserScalableNo = /user-scalable\s*=\s*no/i.test(viewportContent ?? "");

  let combinedCss = "";
  $("style").each((_, el) => {
    combinedCss += $(el).text() + "\n";
  });

  const stylesheetHrefs = $('link[rel="stylesheet"][href]')
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter((href): href is string => Boolean(href))
    .slice(0, MAX_STYLESHEETS);

  let stylesheetsChecked = 0;
  for (const href of stylesheetHrefs) {
    try {
      const cssUrl = new URL(href, finalUrl).toString();
      const cssResponse = await fetchWithTimeout(cssUrl);
      combinedCss += (await cssResponse.text()) + "\n";
      stylesheetsChecked += 1;
    } catch {
      // A single unreachable stylesheet shouldn't fail the whole adapter.
    }
  }

  return {
    hasViewportMeta,
    viewportContent,
    usesUserScalableNo,
    mediaQueryCount: countMediaQueries(combinedCss),
    stylesheetsChecked,
    smallFontDeclarationCount: countSmallFontDeclarations(combinedCss),
  };
}
