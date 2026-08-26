import puppeteer from "puppeteer";
import { SHADER_HERO_SELECTOR } from "@/lib/design-render/shader-hero";

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

/**
 * Phase 7: real, deterministic client-side render-health for
 * shader-enhanced-hero, checked at this viewport. `canvasPresent`/
 * `contextLost` are read directly from the DOM/WebGL API — never a
 * re-derivation of Selector/Adapter eligibility, which
 * lib/design-intelligence/capability-selector.ts and Phase 6.9's own
 * qaContract() cross-check (design-qa-service.ts's qaMotion) already own
 * exclusively. This adapter only asks: given whatever the server already
 * decided and rendered (SHADER_HERO_SELECTOR's own presence, the one
 * server-rendered fact this checks against), did the client-side WebGL
 * canvas actually initialize and stay healthy.
 */
export interface ShaderHeroRenderResult {
  /** A real <canvas> element exists inside the SHADER_HERO_SELECTOR mount — shader-hero-runtime.tsx only ever appends one after its own getContext()/compile/link/uniform-resolution chain fully succeeds (see that file's own doc comment), so presence alone is already a real, non-trivial signal, not empty markup. */
  canvasPresent: boolean;
  /**
   * canvas.getContext("webgl").isContextLost() — calling getContext() again
   * on an existing canvas returns the SAME context per spec (never creates a
   * second one, never a side effect), so this is a safe, standard, zero-cost
   * read of a real browser API, not a new capability or a pixel-content
   * assertion. Null when canvasPresent is false — nothing to check.
   */
  contextLost: boolean | null;
}

export interface ViewportRenderResult {
  widthPx: number;
  heightPx: number;
  /** document.scrollWidth > window.innerWidth at this viewport — a real overflow signal, not inferred from CSS alone. */
  horizontalOverflow: boolean;
  touchTargets: MeasuredTouchTarget[];
  screenshotByteSize: number;
  /** Null when SHADER_HERO_SELECTOR is absent entirely — shader-enhanced-hero was not expected to render at all here (denied by the Selector, or the Adapter legitimately declined; design-qa-service.ts's qaMotion already owns that distinction exclusively — this field never re-derives it). */
  shaderHero: ShaderHeroRenderResult | null;
}

export interface RenderedPreviewRawResult {
  desktop: ViewportRenderResult | null;
  mobile: ViewportRenderResult | null;
  /** Raw axe-core violations at desktop viewport — mirrors AccessibilityRawResult's own shape (lib/adapters/accessibility-adapter.ts), gathered from the same authenticated page load rather than a second navigation. */
  pageTitle: string | null;
  fetchError?: string;
  /** Phase 7: real browser console error / unhandled page-error messages captured across the entire session (both viewports, one authenticated page load) — attributed to shader-render-health only when SHADER_HERO_SELECTOR was present somewhere on the page (design-qa-service.ts's own presence-scoped attribution rule; a known, disclosed, accepted limitation — an unrelated error on a page that also has shader-hero active could be misattributed, and no content-based heuristic is used to try to rule that out). */
  consoleErrors: string[];
  pageErrors: string[];
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

  // Phase 7: wait two chained RAF ticks — a standard, zero-magic-number way
  // to guarantee shader-hero-runtime.tsx's own first requestAnimationFrame
  // callback (where its gl/program/uniform setup completes and the canvas
  // is appended, or none of that happens) has had a real chance to run,
  // rather than an arbitrary fixed sleep.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
  const shaderHero = await page.evaluate((selector) => {
    const mount = document.querySelector(selector);
    if (!mount) return null;
    const canvas = mount.querySelector("canvas");
    if (!canvas) return { canvasPresent: false, contextLost: null };
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    return { canvasPresent: true, contextLost: gl ? gl.isContextLost() : null };
  }, SHADER_HERO_SELECTOR);

  return {
    widthPx: viewport.width,
    heightPx: viewport.height,
    horizontalOverflow,
    touchTargets,
    screenshotByteSize: screenshot.byteLength,
    shaderHero,
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
 *
 * Phase 7 finding, fixed here: headless Chromium's own default
 * `prefers-reduced-motion` state is "reduce", not "no-preference" — verified
 * directly (a bare `puppeteer.launch` + `matchMedia` check confirms this),
 * not assumed. Every check this adapter has ever run was therefore silently
 * measuring a reduced-motion visitor, invisible until Phase 7 introduced the
 * first check actually sensitive to it (shader-enhanced-hero's canvas never
 * mounts under reduced motion, by design). Explicitly emulating
 * "no-preference" here makes this adapter represent the real, normal
 * visitor experience it was always intended to measure.
 */
export async function runRenderedPreviewAdapter(
  targetUrl: string,
  options: RenderedPreviewOptions = {}
): Promise<RenderedPreviewRawResult> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);

    // Phase 7: real console/page-error capture, attached before navigation
    // so nothing during initial load is missed. Accumulated across the
    // whole session (both viewports, one page load) — design-qa-service.ts
    // decides attribution (see RenderedPreviewRawResult's own doc comment),
    // never this adapter, which only reports what the browser really said.
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    if (options.cookies && options.cookies.length > 0) {
      await page.setCookie(
        ...options.cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path ?? "/" }))
      );
    }

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    const pageTitle = await page.title();

    const desktop = await measureViewport(page, DESKTOP_VIEWPORT);
    const mobile = await measureViewport(page, MOBILE_VIEWPORT);

    return { desktop, mobile, pageTitle: pageTitle || null, consoleErrors, pageErrors };
  } catch (err) {
    return {
      desktop: null,
      mobile: null,
      pageTitle: null,
      fetchError: err instanceof Error ? err.message : "Failed to render preview page",
      consoleErrors: [],
      pageErrors: [],
    };
  } finally {
    await browser?.close();
  }
}

export interface PreviewScreenshotCaptureResult {
  desktop: Buffer | null;
  mobile: Buffer | null;
  fetchError?: string;
}

/**
 * runPreviewScreenshotCapture — Phase 4: the real-screenshot counterpart to
 * runRenderedPreviewAdapter above, which deliberately measures-and-discards
 * (its own doc comment: "a screenshot's byte size here is evidence a real
 * page rendered... nothing more"). This function exists because Phase 4
 * needs the opposite: the actual PNG bytes, to upload and display as a real
 * Before/After comparison, not just prove rendering happened. Same
 * authenticated-navigation mechanism (real session cookies from
 * lib/services/qa-preview-access.ts, no RLS bypass), same two viewports, so
 * a Phase 4 "after" screenshot and a QA run's own rendering check are always
 * looking at the identical real route under the identical real conditions.
 */
export async function runPreviewScreenshotCapture(
  targetUrl: string,
  options: RenderedPreviewOptions = {}
): Promise<PreviewScreenshotCaptureResult> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    // Same fix as runRenderedPreviewAdapter above — a before/after
    // screenshot should represent the same normal-visitor experience, not
    // headless Chromium's own reduced-motion default.
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);

    if (options.cookies && options.cookies.length > 0) {
      await page.setCookie(
        ...options.cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path ?? "/" }))
      );
    }

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });

    await page.setViewport(DESKTOP_VIEWPORT);
    await page.evaluate(() => window.scrollTo(0, 0));
    const desktop = (await page.screenshot({ type: "png", fullPage: true })) as Buffer;

    await page.setViewport(MOBILE_VIEWPORT);
    await page.evaluate(() => window.scrollTo(0, 0));
    const mobile = (await page.screenshot({ type: "png", fullPage: true })) as Buffer;

    return { desktop, mobile };
  } catch (err) {
    return {
      desktop: null,
      mobile: null,
      fetchError: err instanceof Error ? err.message : "Failed to capture preview screenshot",
    };
  } finally {
    await browser?.close();
  }
}
