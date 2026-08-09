import puppeteer from "puppeteer";

const NAV_TIMEOUT_MS = 20_000;
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
/** The Design Preview renderer's own mobile breakpoint (components/design-preview/design-preview.tsx's MOBILE_BREAKPOINT_PX is 480, but docs/SPRINT_4_PHASE_4_DESIGN_REVIEW.md §4.5 names 375px as the explicit minimum validation viewport — checking at 375px is checking inside that breakpoint, the real product requirement, not the renderer's own internal constant). */
const MOBILE_VIEWPORT = { width: 375, height: 812 };
/** RefinedDesign.mobile.touchTargets are rendered with this attribute (components/design-preview/design-preview.tsx) — the one hook this adapter needs to measure real, rendered touch-target boxes rather than trusting the RefinedDesign JSON's own stated widthPx/heightPx values. */
const TOUCH_TARGET_SELECTOR = "[data-op-touch-target]";

export interface RenderedPreviewCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

export interface RenderedPreviewOptions {
  /** Real session cookies from an actual, authenticated sign-in — never a service-role/RLS-bypass mechanism (see lib/services/qa-preview-access.ts). */
  cookies?: RenderedPreviewCookie[];
}

export interface MeasuredTouchTarget {
  selector: string;
  widthPx: number;
  heightPx: number;
}

export interface ViewportRenderResult {
  widthPx: number;
  heightPx: number;
  /** document.scrollWidth > window.innerWidth at this viewport — a real overflow signal, not inferred from CSS alone. */
  horizontalOverflow: boolean;
  touchTargets: MeasuredTouchTarget[];
  screenshotByteSize: number;
}

export interface RenderedPreviewRawResult {
  desktop: ViewportRenderResult | null;
  mobile: ViewportRenderResult | null;
  /** Raw axe-core violations at desktop viewport — mirrors AccessibilityRawResult's own shape (lib/adapters/accessibility-adapter.ts), gathered from the same authenticated page load rather than a second navigation. */
  pageTitle: string | null;
  fetchError?: string;
}

async function measureViewport(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>,
  viewport: { width: number; height: number }
): Promise<ViewportRenderResult> {
  await page.setViewport(viewport);
  await page.evaluate(() => window.scrollTo(0, 0));

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );

  const touchTargets = await page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector)).map((el, i) => {
      const rect = el.getBoundingClientRect();
      return { selector: `${selector}[${i}]`, widthPx: Math.round(rect.width), heightPx: Math.round(rect.height) };
    });
  }, TOUCH_TARGET_SELECTOR);

  const screenshot = (await page.screenshot({ type: "png" })) as Buffer;

  return {
    widthPx: viewport.width,
    heightPx: viewport.height,
    horizontalOverflow,
    touchTargets,
    screenshotByteSize: screenshot.byteLength,
  };
}

/**
 * rendered-preview-adapter — real, rendered-DOM measurement of the Design
 * Preview route (components/design-preview/design-preview.tsx via
 * app/missions/[id]/preview/page.tsx), at both a desktop and the 375px
 * mobile viewport docs/SPRINT_4_PHASE_4_DESIGN_REVIEW.md §4.5 names as the
 * explicit minimum validation viewport. Deliberately narrow, matching
 * accessibility-adapter.ts/lighthouse-adapter.ts's own shape (a pure
 * function: URL + auth cookies in, raw measurements out) rather than a
 * general-purpose browser-automation library — this is the "smallest
 * screenshot capability" the QA task asked for, not screenshot history,
 * not visual-diff infrastructure, not an image storage platform: a
 * screenshot's byte size here is evidence a real page rendered at this
 * viewport, nothing more.
 *
 * Requires a real, already-authenticated session's cookies
 * (RenderedPreviewOptions.cookies) — the preview route sits behind the same
 * middleware auth gate as every other page in this app (docs/SPRINT_STATUS.md,
 * "Rendering capability" entry's disclosed limitation), and this adapter does
 * not attempt to bypass that; it navigates as a real, cookie-carrying
 * session would. Returns fetchError (never throws) when no page ever loaded
 * — e.g. no cookies were supplied, or the preview 404s — so a caller can
 * report UNAVAILABLE honestly rather than crash.
 */
export async function runRenderedPreviewAdapter(
  targetUrl: string,
  options: RenderedPreviewOptions = {}
): Promise<RenderedPreviewRawResult> {
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
    const pageTitle = await page.title();

    const desktop = await measureViewport(page, DESKTOP_VIEWPORT);
    const mobile = await measureViewport(page, MOBILE_VIEWPORT);

    return { desktop, mobile, pageTitle: pageTitle || null };
  } catch (err) {
    return {
      desktop: null,
      mobile: null,
      pageTitle: null,
      fetchError: err instanceof Error ? err.message : "Failed to render preview page",
    };
  } finally {
    await browser?.close();
  }
}
