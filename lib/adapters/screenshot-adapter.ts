import puppeteer from "puppeteer";

import type { ScreenshotRawResult } from "@/lib/adapters/types";

const NAV_TIMEOUT_MS = 20_000;
const VIEWPORT = { width: 1440, height: 900 };

/**
 * Uploads a screenshot buffer somewhere and returns the URL/path a caller
 * can later use to display it. Injected rather than hardcoded to Supabase
 * Storage so this adapter stays a pure "screenshot in, bytes out (+
 * wherever you told me to put them)" function — it doesn't know or care
 * that the caller happens to be using Supabase, matching the "no hidden
 * dependencies" preference from the CTO review. analysis-service.ts is
 * the one that knows about Supabase and passes in the real uploader (see
 * lib/services/analysis-service.ts's uploadScreenshot helper).
 */
export type ScreenshotUploader = (fileName: string, buffer: Buffer) => Promise<string>;

/**
 * screenshot-adapter — captures a full-page and an above-the-fold
 * screenshot of the target URL via headless Chrome
 * (docs/SPRINT_3_DESIGN_REVIEW.md §1, §4: "full-page and above-fold
 * screenshot capture, written to Supabase Storage"). Per §4, writing to
 * Storage is this adapter's job, not analysis-service's — but the actual
 * Supabase client/bucket details are kept out of this file via the
 * `upload` callback above.
 */
export async function runScreenshotAdapter(
  targetUrl: string,
  upload: ScreenshotUploader
): Promise<ScreenshotRawResult> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });

    const aboveFoldBuffer = (await page.screenshot({ type: "png" })) as Buffer;
    const fullPageBuffer = (await page.screenshot({ type: "png", fullPage: true })) as Buffer;

    const [aboveFoldUrl, fullPageUrl] = await Promise.all([
      upload("above-fold.png", aboveFoldBuffer),
      upload("full.png", fullPageBuffer),
    ]);

    return {
      fullPageUrl,
      aboveFoldUrl,
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      fullPageUrl: null,
      aboveFoldUrl: null,
      capturedAt: new Date().toISOString(),
      fetchError: err instanceof Error ? err.message : "Failed to capture screenshot",
    };
  } finally {
    await browser?.close();
  }
}
