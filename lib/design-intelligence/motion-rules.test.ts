import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MOTION_DURATION_BAND_MS,
  validateMotionChoice,
} from "@/lib/design-intelligence/motion-rules";

describe("motion-rules", () => {
  test("accepts an in-band, purposeful, allowed-easing motion choice", () => {
    const errors = validateMotionChoice({
      durationMs: 250,
      easing: "ease-in-out",
      purpose: "Fades in the section as it scrolls into view.",
    });
    assert.deepEqual(errors, []);
  });

  test("rejects motion with no stated purpose", () => {
    const errors = validateMotionChoice({ durationMs: 250, easing: "ease", purpose: "  " });
    assert.ok(errors.some((e) => e.includes("functional purpose")));
  });

  test("rejects bounce/spring easing even when a deviation is disclosed", () => {
    const errors = validateMotionChoice({
      durationMs: 250,
      easing: "spring(1, 80, 10, 0)",
      purpose: "Bounces the CTA button on hover.",
      deliberateDeviation: true,
    });
    assert.ok(errors.some((e) => e.includes("Bounce/spring/elastic")));
  });

  test("rejects an easing curve that isn't in the allowed list", () => {
    const errors = validateMotionChoice({
      durationMs: 250,
      easing: "cubic-bezier(0.1,0.2,0.3,0.4)",
      purpose: "Custom curve for a hero entrance.",
    });
    assert.ok(errors.some((e) => e.includes("not one of the allowed easing curves")));
  });

  test("rejects an out-of-band duration when no deviation is disclosed", () => {
    const errors = validateMotionChoice({
      durationMs: 600,
      easing: "ease",
      purpose: "Slow entrance for a hero image.",
    });
    assert.ok(errors.some((e) => e.includes(`${MOTION_DURATION_BAND_MS.min}-${MOTION_DURATION_BAND_MS.max}ms`)));
  });

  test("allows an out-of-band duration when a deliberate deviation is disclosed", () => {
    const errors = validateMotionChoice({
      durationMs: 600,
      easing: "ease-in-out",
      purpose: "A fitness studio's energetic entrance, per the Design Brief's deliberate direction.",
      deliberateDeviation: true,
    });
    assert.deepEqual(errors, []);
  });
});
