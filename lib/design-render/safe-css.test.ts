import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isPlausibleCssColor,
  toSafeCssColor,
  toSafeFontFamilyStack,
  toCssFontWeight,
  MUTED_TEXT_OPACITY,
} from "@/lib/design-render/safe-css";

describe("safe-css", () => {
  test("isPlausibleCssColor accepts hex, rgb()/hsl(), and bare keywords", () => {
    assert.equal(isPlausibleCssColor("#fff"), true);
    assert.equal(isPlausibleCssColor("#1E3A5F"), true);
    assert.equal(isPlausibleCssColor("rgb(10, 20, 30)"), true);
    assert.equal(isPlausibleCssColor("hsl(200deg 50% 40%)"), true);
    assert.equal(isPlausibleCssColor("terracotta"), true);
  });

  test("isPlausibleCssColor rejects real Design Memory prose", () => {
    assert.equal(isPlausibleCssColor("Warm terracotta"), false);
    assert.equal(isPlausibleCssColor("Deep olive green"), false);
    assert.equal(isPlausibleCssColor("Warm cream / off-white"), false);
    assert.equal(isPlausibleCssColor(""), false);
  });

  test("toSafeCssColor falls back for unparseable input, passes through valid input", () => {
    assert.equal(toSafeCssColor("Muted gold", "#C9A227"), "#C9A227");
    assert.equal(toSafeCssColor("#C9A227", "#000"), "#C9A227");
    assert.equal(toSafeCssColor(undefined, "#000"), "#000");
    assert.equal(toSafeCssColor(null, "#000"), "#000");
  });

  // ===========================================================================
  // Issue 1 (CTO Design Intelligence Remediation directive) — the color
  // pipeline was discarding real per-business color reasoning any time it
  // arrived as prose ("Deep navy (#122A3D-range)...") instead of a bare CSS
  // token, silently falling back to the same default navy/gold palette for
  // every business. Fix: extract the first embedded valid hex/functional
  // color token before falling back.
  // ===========================================================================
  test("toSafeCssColor extracts a real embedded hex token from descriptive prose instead of discarding it", () => {
    assert.equal(toSafeCssColor("Deep navy (#122A3D-range)...", "#000000"), "#122A3D");
    assert.equal(toSafeCssColor("A warm terracotta, close to #C9622D in practice.", "#000000"), "#C9622D");
    assert.equal(toSafeCssColor("Something like rgb(10, 20, 30) for the accent.", "#000000"), "rgb(10, 20, 30)");
  });

  test("toSafeCssColor still falls back when the prose contains no extractable color token at all", () => {
    assert.equal(toSafeCssColor("Warm terracotta, no hex given", "#C9A227"), "#C9A227");
  });

  test("toSafeCssColor ignores an invalid-length hex run embedded in prose and falls back", () => {
    assert.equal(toSafeCssColor("Something like #12ab5 in tone", "#C9A227"), "#C9A227");
  });

  // ===========================================================================
  // Issue 1's typography half — quoting an entire descriptive sentence as a
  // literal font-family never resolves to a real font, so every business
  // fell through to the same fixed default stack (functionally the same
  // discard-real-reasoning bug as the color path). Fix: extract a real named
  // candidate when present, and pick a genre-appropriate fallback stack from
  // keywords in the prose instead of one fixed stack for every business.
  // ===========================================================================
  test("toSafeFontFamilyStack extracts a real named font candidate following e.g./such as/like", () => {
    assert.equal(
      toSafeFontFamilyStack("A geometric humanist sans, e.g. Söhne or similar", "Georgia, serif"),
      '"Söhne", "Helvetica Neue", Arial, "Segoe UI", sans-serif'
    );
  });

  test("toSafeFontFamilyStack picks a genre-appropriate fallback stack instead of always the caller's default", () => {
    assert.match(toSafeFontFamilyStack("A clean grotesk sans", "Georgia, serif"), /Helvetica Neue/);
    assert.match(toSafeFontFamilyStack("An elegant transitional serif", "Georgia, serif"), /Georgia/);
    assert.match(toSafeFontFamilyStack("A technical monospace feel", "Georgia, serif"), /Courier New/);
  });

  test("toSafeFontFamilyStack falls back to the caller's own stack when no genre keyword or named candidate is present", () => {
    assert.equal(toSafeFontFamilyStack("Something distinctive", "Georgia, serif"), "Georgia, serif");
    assert.equal(toSafeFontFamilyStack(undefined, "Georgia, serif"), "Georgia, serif");
  });

  test("toCssFontWeight maps every named weight to its numeric CSS value", () => {
    assert.equal(toCssFontWeight("regular"), 400);
    assert.equal(toCssFontWeight("medium"), 500);
    assert.equal(toCssFontWeight("semibold"), 600);
    assert.equal(toCssFontWeight("bold"), 700);
  });
});

// ===========================================================================
// MUTED_TEXT_OPACITY — regression guard for the real axe-core "serious"
// color-contrast violation (15 nodes) found against the real Veslo Family
// Restaurant rendered preview (docs/SPRINT_STATUS.md's Phase 4 QA entry).
// The violation traced to design-preview.tsx/slot-value.tsx applying CSS
// `opacity` to de-emphasized text against this renderer's own fallback
// colors (not any Design Memory color choice) — reproduced here with the
// same math axe-core's contrast check uses (WCAG 2.x relative luminance),
// so a future edit that quietly lowers this constant fails a real test
// instead of only being caught by a live Puppeteer/axe-core run.
// ===========================================================================

type Rgb = [number, number, number];

function blend(fg: Rgb, bg: Rgb, opacity: number): Rgb {
  return [
    fg[0] * opacity + bg[0] * (1 - opacity),
    fg[1] * opacity + bg[1] * (1 - opacity),
    fg[2] * opacity + bg[2] * (1 - opacity),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const linearize = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const WCAG_AA_NORMAL_TEXT = 4.5;

describe("safe-css: MUTED_TEXT_OPACITY WCAG AA regression guard", () => {
  test("the renderer's own light-mode fallback pair (near-black text on the neutral fallback background) clears WCAG AA at MUTED_TEXT_OPACITY", () => {
    // FALLBACK.text (#1A1A1A) at MUTED_TEXT_OPACITY over FALLBACK.neutral (#FAF7F2) —
    // components/design-preview/design-preview.tsx's actual pairing for slot
    // labels and placeholder text in every non-hero/footer section.
    const text: Rgb = [0x1a, 0x1a, 0x1a];
    const background: Rgb = [0xfa, 0xf7, 0xf2];
    const effective = blend(text, background, MUTED_TEXT_OPACITY);
    const ratio = contrastRatio(effective, background);
    assert.ok(
      ratio >= WCAG_AA_NORMAL_TEXT,
      `expected contrast >= ${WCAG_AA_NORMAL_TEXT}:1 at opacity ${MUTED_TEXT_OPACITY}, got ${ratio.toFixed(2)}:1`
    );
  });

  test("the previous 0.55/0.6 opacity values genuinely failed this same pairing — confirms this is a real regression guard, not a tautology", () => {
    const text: Rgb = [0x1a, 0x1a, 0x1a];
    const background: Rgb = [0xfa, 0xf7, 0xf2];
    for (const previousOpacity of [0.55, 0.6]) {
      const effective = blend(text, background, previousOpacity);
      const ratio = contrastRatio(effective, background);
      assert.ok(
        ratio < WCAG_AA_NORMAL_TEXT,
        `expected opacity ${previousOpacity} to fail WCAG AA (reproducing the real axe-core finding), but it measured ${ratio.toFixed(2)}:1`
      );
    }
  });

  test("the renderer's dark-mode fallback pair (near-white text on the primary/secondary fallback backgrounds) clears WCAG AA at MUTED_TEXT_OPACITY", () => {
    // FALLBACK.onDark (#FAFAFA) at MUTED_TEXT_OPACITY over FALLBACK.primary (#1E3A5F) —
    // the hero section's eyebrow label pairing.
    const text: Rgb = [0xfa, 0xfa, 0xfa];
    const background: Rgb = [0x1e, 0x3a, 0x5f];
    const effective = blend(text, background, MUTED_TEXT_OPACITY);
    const ratio = contrastRatio(effective, background);
    assert.ok(
      ratio >= WCAG_AA_NORMAL_TEXT,
      `expected contrast >= ${WCAG_AA_NORMAL_TEXT}:1 at opacity ${MUTED_TEXT_OPACITY}, got ${ratio.toFixed(2)}:1`
    );
  });
});
