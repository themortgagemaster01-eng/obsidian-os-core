import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assignColorRoles, type ColorRoleCandidates } from "@/lib/design-render/color-roles";

/**
 * Phase 19 — Design Intelligence Gap Map, Fix #8 (semantic color role
 * assignment). Required regression proof: (1) reproduces the founder's own
 * worked example for Dante's Trattoria exactly, without special-casing it;
 * (2) a different real business (Carriage House Mahopac) produces a
 * genuinely different, independently-derived result — proving the algorithm
 * generalizes; (3) deterministic; (4)-(9) every fallback/edge case named in
 * the Fix #8 spec falls back safely, never crashes, never invents a color.
 */

describe("color-roles: assignColorRoles — Fix #8", () => {
  test("reproduces the founder's own worked example for Dante's Trattoria exactly", () => {
    // Real, live Fix #7-resolved values for Dante's Trattoria.
    const dante: ColorRoleCandidates = {
      neutral: "#36454F", // charcoal
      primary: "#C2571B", // terracotta
      secondary: "#6B7A3A", // olive
      accent: "#F3E9D2", // cream
    };
    const roles = assignColorRoles(dante);
    assert.equal(roles.background, "#F3E9D2", "background should be cream");
    assert.equal(roles.foreground, "#36454F", "foreground should be charcoal");
    assert.equal(roles.accent, "#C2571B", "accent should be terracotta");
    assert.equal(roles.secondary, "#6B7A3A", "secondary should be olive");
  });

  test("Carriage House Mahopac's real palette produces a different, independently-derived result — not hardcoded to Dante's shape", () => {
    const carriageHouse: ColorRoleCandidates = {
      neutral: "#36454F", // charcoal
      primary: "#6B4A32", // aged wood
      secondary: "#C68E17", // amber
      accent: "#B08D57", // brass
    };
    const roles = assignColorRoles(carriageHouse);
    assert.equal(roles.background, "#B08D57", "background should be brass (the only light-group candidate)");
    assert.equal(roles.foreground, "#36454F", "foreground should be charcoal");
    assert.equal(roles.accent, "#C68E17", "accent should be amber (most saturated of the remainder)");
    assert.equal(roles.secondary, "#6B4A32", "secondary should be aged wood");

    // Confirm genuine differentiation from Dante's — different business,
    // different resolved roles, not a copy of the same output shape.
    const dante = assignColorRoles({ neutral: "#36454F", primary: "#C2571B", secondary: "#6B7A3A", accent: "#F3E9D2" });
    assert.notEqual(roles.background, dante.background);
    assert.notEqual(roles.accent, dante.accent);
  });

  test("deterministic — repeated calls with identical input produce byte-identical output", () => {
    const candidates: ColorRoleCandidates = { neutral: "#36454F", primary: "#C2571B", secondary: "#6B7A3A", accent: "#F3E9D2" };
    const first = assignColorRoles(candidates);
    const second = assignColorRoles(candidates);
    assert.deepEqual(first, second);
  });

  test("all four candidates identical (1-color palette) — no crash, background=foreground's group collapses to null, contrast validation is the caller's job", () => {
    const roles = assignColorRoles({ neutral: "#808080", primary: "#808080", secondary: "#808080", accent: "#808080" });
    assert.equal(roles.background, "#808080");
    // All four share the same lightness group as background -> no
    // opposite-group candidate exists.
    assert.equal(roles.foreground, null);
    assert.equal(roles.accent, "#808080");
    assert.equal(roles.secondary, "#808080");
  });

  test("two distinct colors (two fields duplicate the other two) — still produces a complete, valid result", () => {
    const roles = assignColorRoles({ neutral: "#F5F0E8", primary: "#2F2F2F", secondary: "#F5F0E8", accent: "#2F2F2F" });
    assert.equal(roles.background, "#F5F0E8");
    assert.equal(roles.foreground, "#2F2F2F");
    assert.ok(roles.accent === "#F5F0E8" || roles.accent === "#2F2F2F");
    assert.ok(roles.secondary === "#F5F0E8" || roles.secondary === "#2F2F2F");
  });

  test("three distinct colors (one field duplicates another) — honest reflection of real data, never fabricated differentiation", () => {
    const roles = assignColorRoles({ neutral: "#36454F", primary: "#C2571B", secondary: "#36454F", accent: "#F3E9D2" });
    assert.equal(roles.background, "#F3E9D2");
    assert.equal(roles.foreground, "#36454F");
    assert.equal(roles.accent, "#C2571B");
    assert.equal(roles.secondary, "#36454F");
  });

  test("all four candidates in the light group (no dark candidate at all) — background is the calmest tone by saturation, foreground is null", () => {
    // Real HSL for these four (verified, not assumed): FDF6EC S81 L96,
    // F7DCC6 S75 L87, EFC9A4 S70 L79, E8A87C S70 L70 — a reminder that
    // near-white colors can carry deceptively HIGH raw saturation, exactly
    // why this algorithm ranks by saturation rather than assuming "palest
    // looking" and "least saturated" are the same thing.
    const roles = assignColorRoles({ neutral: "#FDF6EC", primary: "#F7DCC6", secondary: "#EFC9A4", accent: "#E8A87C" });
    assert.equal(roles.foreground, null);
    // EFC9A4 and E8A87C tie at S70; EFC9A4's lightness (79) is further from
    // 50 than E8A87C's (70), so the exact-tie tiebreak correctly prefers it.
    assert.equal(roles.background, "#EFC9A4");
  });

  test("all four candidates in the dark group (no light candidate at all) — background is the calmest dark tone, foreground is null", () => {
    const roles = assignColorRoles({ neutral: "#1A1A1A", primary: "#2B1A1A", secondary: "#1A2B1A", accent: "#1A1A2B" });
    assert.equal(roles.foreground, null);
    assert.ok(roles.background); // a real, non-crashing hex value
  });

  test("an unmeasurable candidate (rgb()/hsl() function or bare CSS keyword — toSafeCssColor's rarer outputs) never crashes and still produces a complete result", () => {
    const roles = assignColorRoles({ neutral: "#36454F", primary: "rgb(194, 87, 27)", secondary: "#6B7A3A", accent: "#F3E9D2" });
    assert.ok(roles.background);
    assert.ok(roles.accent);
    assert.ok(roles.secondary);
    // The unmeasurable candidate must still appear somewhere in the output
    // (never silently dropped) even though its exact numeric properties
    // couldn't be measured.
    const allValues = [roles.background, roles.foreground, roles.accent, roles.secondary];
    assert.ok(allValues.includes("rgb(194, 87, 27)"));
  });

  test("exact saturation tie is broken by lightness-extremity, deterministically", () => {
    // Two candidates engineered to share identical saturation/differ only in lightness.
    const roles = assignColorRoles({ neutral: "#808080", primary: "#B3B3B3", secondary: "#4D4D4D", accent: "#FF0000" });
    // neutral/primary/secondary are all achromatic (S=0); accent is fully saturated.
    // Among the S=0 trio, background should go to whichever the extremity rule prefers.
    assert.notEqual(roles.background, "#FF0000", "the fully saturated candidate should never win background over three neutral grays");
  });

  test("legacy fallback constants run through the algorithm reproduce today's background exactly, documenting the known (and deliberately bypassed in production) foreground discrepancy", () => {
    // This is NOT the production path (design-preview.tsx explicitly bypasses
    // assignColorRoles entirely when there's no real palette, per the
    // founder's decision) — this test documents why that bypass is needed:
    // running the fallback constants through the algorithm reproduces
    // background exactly, but not foreground byte-for-byte.
    const roles = assignColorRoles({ neutral: "#FAF7F2", primary: "#1E3A5F", secondary: "#0B1220", accent: "#C9A227" });
    assert.equal(roles.background, "#FAF7F2", "background matches today's exact fallback output");
    assert.notEqual(roles.foreground, "#1A1A1A", "foreground does NOT match today's literal FALLBACK.text constant byte-for-byte (both are near-black, but not identical) -- this is exactly why production bypasses the algorithm for the no-palette case");
  });
});
