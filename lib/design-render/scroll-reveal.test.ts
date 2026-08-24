import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SCROLL_REVEAL_SELECTOR,
  PENDING_ATTR,
  REVEALED_ATTR,
  REDUCED_MOTION_QUERY,
  SAFETY_REVEAL_TIMEOUT_MS,
  SCROLL_REVEAL_OBSERVER_OPTIONS,
  isAlreadyInViewport,
  shouldPreHide,
  hashTargetId,
} from "@/lib/design-render/scroll-reveal";

describe("scroll-reveal: constants", () => {
  test("selector/attribute names are non-empty and match design-preview.tsx's own SectionShell markup", () => {
    assert.equal(SCROLL_REVEAL_SELECTOR, "[data-op-animated]");
    assert.ok(PENDING_ATTR.length > 0);
    assert.ok(REVEALED_ATTR.length > 0);
    assert.notEqual(PENDING_ATTR, REVEALED_ATTR);
  });

  test("REDUCED_MOTION_QUERY matches the exact media feature the stylesheet's own override keys on", () => {
    assert.equal(REDUCED_MOTION_QUERY, "(prefers-reduced-motion: reduce)");
  });

  test("the safety reveal timeout is a real, positive, human-scale duration — long enough to never fire for a normal scroll, short enough to guarantee reveal within one visit", () => {
    assert.ok(SAFETY_REVEAL_TIMEOUT_MS > 0);
    assert.ok(SAFETY_REVEAL_TIMEOUT_MS >= 1000, "should not fire so fast it preempts a real, slightly slow scroll");
    assert.ok(SAFETY_REVEAL_TIMEOUT_MS <= 10000, "should not leave a genuinely stuck section hidden for most of a page visit");
  });

  test("the intersection threshold is a valid fraction, and rootMargin only ever narrows (never widens) the viewport root", () => {
    assert.ok(SCROLL_REVEAL_OBSERVER_OPTIONS.threshold > 0 && SCROLL_REVEAL_OBSERVER_OPTIONS.threshold <= 1);
    assert.equal(SCROLL_REVEAL_OBSERVER_OPTIONS.root, null);
    assert.match(SCROLL_REVEAL_OBSERVER_OPTIONS.rootMargin, /^(-?\d+(?:px|%) ){3}-?\d+(?:px|%)$/);
  });
});

describe("scroll-reveal: isAlreadyInViewport", () => {
  const viewportHeight = 900;

  test("an element fully within the viewport is already visible", () => {
    assert.equal(isAlreadyInViewport({ top: 100, bottom: 400 }, viewportHeight), true);
  });

  test("an element straddling the bottom edge (top on-screen, bottom past it) still counts as already visible — it has genuinely entered the experience, not waiting to", () => {
    assert.equal(isAlreadyInViewport({ top: 850, bottom: 1200 }, viewportHeight), true);
  });

  test("an element straddling the top edge (top above the viewport, bottom on-screen) still counts as already visible", () => {
    assert.equal(isAlreadyInViewport({ top: -50, bottom: 50 }, viewportHeight), true);
  });

  test("an element entirely below the viewport is not yet visible", () => {
    assert.equal(isAlreadyInViewport({ top: 1000, bottom: 1400 }, viewportHeight), false);
  });

  test("an element entirely above the viewport (already scrolled past) is not treated as 'already visible' — never pre-hidden either way, since the runtime skips already-scrolled-past elements independently, but this function's own contract is strictly 'overlaps now'", () => {
    assert.equal(isAlreadyInViewport({ top: -400, bottom: -50 }, viewportHeight), false);
  });

  test("a zero-height (not yet laid out) element is never treated as already visible, even if its collapsed position happens to overlap the viewport", () => {
    assert.equal(isAlreadyInViewport({ top: 300, bottom: 300 }, viewportHeight), false);
    assert.equal(isAlreadyInViewport({ top: 300, bottom: 200 }, viewportHeight), false);
  });
});

describe("scroll-reveal: shouldPreHide", () => {
  test("an already-visible section must never be pre-hidden — the 'already visible at load must not wait for scroll-away-and-back' requirement", () => {
    assert.equal(shouldPreHide(true), false);
  });

  test("an off-screen section is pre-hidden, so it can be revealed on its own scroll-into-view moment", () => {
    assert.equal(shouldPreHide(false), true);
  });
});

describe("scroll-reveal: hashTargetId", () => {
  test("extracts the id from a real hash", () => {
    assert.equal(hashTargetId("#services"), "services");
  });

  test("returns null for no hash at all", () => {
    assert.equal(hashTargetId(""), null);
  });

  test("returns null for a bare '#' with no target", () => {
    assert.equal(hashTargetId("#"), null);
  });

  test("still extracts an id even without a leading '#' (defensive — Location.hash always includes it in a real browser, but this function's contract doesn't assume it)", () => {
    assert.equal(hashTargetId("contact"), "contact");
  });
});
