import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SHADER_HERO_SELECTOR,
  REDUCED_MOTION_QUERY,
  SHADER_MAX_DEVICE_PIXEL_RATIO,
  SHADER_MAX_INTERNAL_DIMENSION_PX,
  SHADER_TARGET_FPS,
  SHADER_MIN_FRAME_INTERVAL_MS,
  SHADER_VERTEX_SOURCE,
  SHADER_FRAGMENT_SOURCE,
  shouldInitializeShader,
  resolveCanvasInternalResolution,
  shouldRenderFrame,
} from "@/lib/design-render/shader-hero";

describe("shader-hero: constants", () => {
  test("selector matches design-preview.tsx's own SectionShell markup", () => {
    assert.equal(SHADER_HERO_SELECTOR, "[data-op-shader-hero]");
  });

  test("REDUCED_MOTION_QUERY is re-exported verbatim from scroll-reveal.ts — a single source of truth, never a second definition of the same media query", () => {
    assert.equal(REDUCED_MOTION_QUERY, "(prefers-reduced-motion: reduce)");
  });

  test("performance caps are real, positive, and meaningfully below an uncapped device's own values", () => {
    assert.ok(SHADER_MAX_DEVICE_PIXEL_RATIO > 0 && SHADER_MAX_DEVICE_PIXEL_RATIO < 3, "should cap below a typical high-end mobile DPR of 3");
    assert.ok(SHADER_MAX_INTERNAL_DIMENSION_PX > 0);
    assert.ok(SHADER_TARGET_FPS > 0 && SHADER_TARGET_FPS < 60, "should throttle below the display's own native refresh rate");
    assert.ok(SHADER_MIN_FRAME_INTERVAL_MS > 16, "should be a real throttle, not effectively every-frame");
  });

  test("vertex/fragment shader source strings are real, non-empty GLSL — no external asset, no texture sample, no image reference (procedural and non-representational by construction)", () => {
    assert.ok(SHADER_VERTEX_SOURCE.includes("gl_Position"));
    assert.ok(SHADER_FRAGMENT_SOURCE.includes("gl_FragColor"));
    assert.ok(!/sampler2D|texture2D/.test(SHADER_FRAGMENT_SOURCE), "must never sample a texture/image — procedural only, zero fabrication risk");
    assert.ok(SHADER_FRAGMENT_SOURCE.includes("u_colorPrimary"));
    assert.ok(SHADER_FRAGMENT_SOURCE.includes("u_colorSecondary"));
    assert.ok(SHADER_FRAGMENT_SOURCE.includes("u_colorAccent"));
  });
});

describe("shader-hero: shouldInitializeShader — the one gate that must run BEFORE any WebGL work", () => {
  test("false whenever reduced motion is preferred, regardless of WebGL support", () => {
    assert.equal(shouldInitializeShader(true, true), false);
    assert.equal(shouldInitializeShader(true, false), false);
  });

  test("false when WebGL is unsupported, even without reduced motion", () => {
    assert.equal(shouldInitializeShader(false, false), false);
  });

  test("true only when reduced motion is off AND WebGL is supported", () => {
    assert.equal(shouldInitializeShader(false, true), true);
  });
});

describe("shader-hero: resolveCanvasInternalResolution — mobile/perf resolution capping", () => {
  test("scales by a capped DPR, never the device's own uncapped value", () => {
    const result = resolveCanvasInternalResolution({ cssWidthPx: 400, cssHeightPx: 300, devicePixelRatio: 3 });
    // At DPR 3 uncapped this would be 1200x900; capped at SHADER_MAX_DEVICE_PIXEL_RATIO (1.5) it's 600x450.
    assert.equal(result.width, 600);
    assert.equal(result.height, 450);
  });

  test("never exceeds the absolute internal-dimension cap, even for a very large hero", () => {
    const result = resolveCanvasInternalResolution({ cssWidthPx: 4000, cssHeightPx: 3000, devicePixelRatio: 1.5 });
    assert.ok(result.width <= SHADER_MAX_INTERNAL_DIMENSION_PX);
    assert.ok(result.height <= SHADER_MAX_INTERNAL_DIMENSION_PX);
  });

  test("each dimension is capped independently — a very wide, short hero doesn't let height's own cap leak into width's budget or vice versa", () => {
    const wide = resolveCanvasInternalResolution({ cssWidthPx: 3000, cssHeightPx: 200, devicePixelRatio: 1.5 });
    assert.ok(wide.width <= SHADER_MAX_INTERNAL_DIMENSION_PX);
    assert.equal(wide.height, 300); // 200 * 1.5, well under the cap — unaffected by width's own clamping.
  });

  test("never produces a zero or negative dimension, even for degenerate input", () => {
    const result = resolveCanvasInternalResolution({ cssWidthPx: 0, cssHeightPx: 0, devicePixelRatio: 1 });
    assert.ok(result.width >= 1);
    assert.ok(result.height >= 1);
  });

  test("a low, uncapped DPR (e.g. 1 on a standard desktop display) is used as-is, not artificially inflated", () => {
    const result = resolveCanvasInternalResolution({ cssWidthPx: 800, cssHeightPx: 400, devicePixelRatio: 1 });
    assert.equal(result.width, 800);
    assert.equal(result.height, 400);
  });
});

describe("shader-hero: shouldRenderFrame — explicit frame-rate throttling, never an unnecessary continuous loop", () => {
  test("false for a frame arriving before the minimum interval has elapsed", () => {
    assert.equal(shouldRenderFrame(1000, 1000 + SHADER_MIN_FRAME_INTERVAL_MS - 1), false);
  });

  test("true once at least the minimum interval has elapsed", () => {
    assert.equal(shouldRenderFrame(1000, 1000 + SHADER_MIN_FRAME_INTERVAL_MS), true);
    assert.equal(shouldRenderFrame(1000, 1000 + SHADER_MIN_FRAME_INTERVAL_MS + 50), true);
  });

  test("true for the very first frame (timestamp 0 as 'never rendered yet')", () => {
    assert.equal(shouldRenderFrame(0, SHADER_MIN_FRAME_INTERVAL_MS), true);
  });
});
