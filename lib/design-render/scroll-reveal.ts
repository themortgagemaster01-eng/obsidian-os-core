/**
 * lib/design-render/scroll-reveal.ts — Phase 6.3 ("True Scroll-Triggered
 * Storytelling"). Pure constants and pure logic shared by
 * components/design-preview/design-preview.tsx (the server-rendered markup)
 * and components/design-preview/scroll-reveal-runtime.tsx (the client
 * component that actually drives IntersectionObserver). Kept separate and
 * dependency-free (no React, no DOM globals referenced at module scope) so
 * this file — the part of Phase 6.3 with real decision logic in it — can be
 * unit-tested the same way every other pure module in this codebase already
 * is, without needing a browser/DOM test environment this project doesn't
 * have.
 *
 * This module makes no decision about WHETHER a section should animate or
 * HOW MUCH — that decision was already made by lib/services/design-
 * refinement-service.ts's refineMotion() (Phase 6.1/6.2's Experience Plan +
 * motion budget). This module only decides WHEN an already-approved
 * animation should play: on scroll-into-view, never before, and never
 * leaving content permanently hidden. Anti-drift boundary: nothing here
 * re-reads business evidence, re-resolves an ExperienceMode, or second-
 * guesses a motion budget — it only reacts to real DOM geometry
 * (is this element already visible?) and a real media-query result
 * (does this visitor want reduced motion?).
 */

/** The attribute design-preview.tsx already emits on any section with a real RefinedDesign.motion entry — the scroll-reveal runtime's query root. Absent entirely for a "none"-budget mission (refineMotion produces zero motion entries), so the runtime finds nothing to observe and does nothing, without needing to know why. */
export const SCROLL_REVEAL_SELECTOR = "[data-op-animated]";

/** Applied by the runtime, and ONLY by the runtime, to a section it has confirmed is currently off-screen — never applied server-side, never applied to a section already in view. Its presence is what the stylesheet keys the hidden/offset appearance on. */
export const PENDING_ATTR = "data-op-pending";

/** Applied by the runtime once a pending section has scrolled into view (or a safety fallback fired) — one-shot; once set, a section is never returned to PENDING. */
export const REVEALED_ATTR = "data-op-revealed";

/** Matches the CSS media feature this same visitor's stylesheet already keys its own reduced-motion override on (design-preview.tsx) — the runtime checks the identical condition before ever touching the DOM, so the JS and CSS safety nets can never disagree about which visitors get no motion. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * A pending section that, for any reason (an IntersectionObserver edge
 * case, an unusual layout), never naturally scrolls into view is force-
 * revealed after this many ms — the concrete mechanism behind "sections
 * should not remain invisible indefinitely." Long enough that it never
 * fires for an ordinary visitor who scrolls at a normal pace, short enough
 * that a genuinely stuck section still becomes visible well within one
 * page visit.
 */
export const SAFETY_REVEAL_TIMEOUT_MS = 4000;

/**
 * rootMargin extends the intersection root's bottom edge inward by 10% of
 * the viewport height, so a section reveals slightly before its top edge
 * would otherwise cross the literal viewport boundary — a small, standard
 * lead-in that keeps reveals from feeling like they're always half a beat
 * behind the scroll, without pre-revealing content still meaningfully
 * off-screen. threshold: 0.1 fires once roughly a tenth of the section is
 * intersecting, matched to "meaningfully enter the experience" rather than
 * requiring the full section (often taller than one viewport) to be
 * entirely on-screen at once.
 */
export const SCROLL_REVEAL_OBSERVER_OPTIONS: { root: null; rootMargin: string; threshold: number } = {
  root: null,
  rootMargin: "0px 0px -10% 0px",
  threshold: 0.1,
};

/** Plain, pre-measured geometry — callers pass real DOMRect-derived numbers in; this function itself never touches the DOM, which is what makes it unit-testable without a browser. */
export interface ElementViewportGeometry {
  top: number;
  bottom: number;
}

/**
 * True when an element already overlaps the visible viewport at the moment
 * this is checked — the exact condition the runtime uses to decide a
 * section must NEVER be pre-hidden in the first place (rather than hidden
 * and instantly re-revealed, which risks a visible flash and, more
 * importantly, means "content is hidden awaiting an animation" would be
 * momentarily true — the one thing Phase 6.3 was explicitly told never to
 * allow). An element with zero height (bottom === top, e.g. not yet laid
 * out) is treated as NOT already visible, so it still gets a real
 * geometry re-check once actually rendered rather than being skipped
 * silently.
 */
export function isAlreadyInViewport(rect: ElementViewportGeometry, viewportHeight: number): boolean {
  if (rect.bottom <= rect.top) return false;
  return rect.top < viewportHeight && rect.bottom > 0;
}

/**
 * The one decision this module makes about an individual section: pre-hide
 * it (and therefore observe it) only when it is not already visible. Kept
 * as its own named function — trivial today — because "a section already
 * visible at load must never wait for scroll-away-and-back" is a named,
 * explicit Phase 6.3 requirement, not an incidental detail of the
 * observer-wiring code.
 */
export function shouldPreHide(alreadyInViewport: boolean): boolean {
  return !alreadyInViewport;
}

/** Extracts a URL hash's target id ("#services" -> "services"), or null for no hash / an empty hash ("#"). Pure string handling so the deep-link safety check (never leave a hash-linked section hidden) is testable without a real Location object. */
export function hashTargetId(hash: string): string | null {
  if (!hash || hash === "#") return null;
  return hash.startsWith("#") ? hash.slice(1) : hash;
}
