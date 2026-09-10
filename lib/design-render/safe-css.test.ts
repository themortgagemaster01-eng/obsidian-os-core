import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isPlausibleCssColor,
  toSafeCssColor,
  toSafeFontFamilyStack,
  toCssFontWeight,
  MUTED_TEXT_OPACITY,
  getReadableTextColor,
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

  test("toSafeCssColor still falls back when the prose contains no extractable color token or recognized color term at all", () => {
    assert.equal(toSafeCssColor("A moody, sophisticated tone with real depth", "#C9A227"), "#C9A227");
  });

  test("toSafeCssColor ignores an invalid-length hex run embedded in prose and falls back", () => {
    assert.equal(toSafeCssColor("Something like #12ab5 in tone", "#C9A227"), "#C9A227");
  });

  // ===========================================================================
  // Fix #7 (Design Intelligence Gap Map) — the embedded-hex rescue above only
  // ever fires when the model happens to include a literal hex code, which
  // real production data (Dante's Trattoria, Carriage House Mahopac) proved
  // it essentially never does: real colorPalette values are purely
  // descriptive ("Deep terracotta / brick red...", "Deep aged-wood
  // brown..."), so every one of those fields was still silently falling back
  // to the identical navy/gold palette for every business. Fix: a small,
  // closed NAMED_COLOR_VOCABULARY resolves recognized color-family terms
  // deterministically, tried only after both hex paths already fail.
  // ===========================================================================
  describe("toSafeCssColor — Fix #7 (named color vocabulary)", () => {
    test("(a) recognized color terms resolve to real, distinct colors instead of the shared fallback", () => {
      const terracotta = toSafeCssColor("Deep terracotta / brick red, sampled from real photography", "#1E3A5F");
      const olive = toSafeCssColor("Olive green", "#1E3A5F");
      const cream = toSafeCssColor("Warm cream / parchment background", "#1E3A5F");
      const charcoal = toSafeCssColor("Charcoal for text, not pure black, for softer contrast", "#1E3A5F");

      assert.notEqual(terracotta, "#1E3A5F");
      assert.notEqual(olive, "#1E3A5F");
      assert.notEqual(cream, "#1E3A5F");
      assert.notEqual(charcoal, "#1E3A5F");
      // All four genuinely different colors, not one term matching everything.
      assert.equal(new Set([terracotta, olive, cream, charcoal]).size, 4);
    });

    test("(a) the exact motivating bug: 'Warm terracotta, no hex given' now resolves to a real color, not the fallback", () => {
      assert.equal(toSafeCssColor("Warm terracotta, no hex given", "#C9A227"), "#C2571B");
    });

    test("(a) hyphenated real phrasing ('aged-wood') resolves the same as a spaced variant would", () => {
      const hyphenated = toSafeCssColor("Deep aged-wood brown, sampled from real interior photography", "#1E3A5F");
      const spaced = toSafeCssColor("A deep aged wood brown tone", "#1E3A5F");
      assert.equal(hyphenated, spaced);
      assert.notEqual(hyphenated, "#1E3A5F");
    });

    test("(a) vocabulary added specifically for Carriage House Mahopac's real accent field ('brass'/'gold')", () => {
      assert.notEqual(toSafeCssColor("Muted brass/gold used sparingly for the call-to-action only", "#1E3A5F"), "#1E3A5F");
    });

    test("(b) deterministic — repeated calls with the same input produce the identical result", () => {
      const input = "Warm, low-saturation tones pulled from the actual photography — aged wood, amber light, deep neutral backgrounds.";
      const first = toSafeCssColor(input, "#1E3A5F");
      const second = toSafeCssColor(input, "#1E3A5F");
      assert.equal(first, second);
    });

    test("(b) when multiple recognized terms appear in one string, the leftmost (first-mentioned) one wins, deterministically", () => {
      const result = toSafeCssColor("A palette moving from olive at the top to terracotta below", "#1E3A5F");
      assert.equal(result, "#6B7A3A"); // olive, mentioned first — not terracotta
    });

    test("(c) explicit hex precedence is completely unchanged — a hex embedded alongside a recognized color word still wins", () => {
      // Pre-existing test above already proves this for "terracotta... #C9622D";
      // this adds coverage for a vocabulary term Fix #7 itself introduced.
      assert.equal(toSafeCssColor("A deep aged wood brown, close to #4A2F1E in practice.", "#000000"), "#4A2F1E");
    });

    test("(c) functional-color precedence is also unchanged in the presence of a recognized color word", () => {
      assert.equal(toSafeCssColor("Something amber-toned, like rgb(198, 142, 23) for the accent.", "#000000"), "rgb(198, 142, 23)");
    });

    test("(d) unrecognized color language not in the closed vocabulary still falls back exactly as before — never a guessed/invented color", () => {
      assert.equal(toSafeCssColor("A moody mauve and dusty rose palette", "#C9A227"), "#C9A227");
      assert.equal(toSafeCssColor("Something turquoise and coral", "#C9A227"), "#C9A227");
    });

    test("(d) missing/empty input still falls back exactly as before, unaffected by the new vocabulary", () => {
      assert.equal(toSafeCssColor(undefined, "#1E3A5F"), "#1E3A5F");
      assert.equal(toSafeCssColor(null, "#1E3A5F"), "#1E3A5F");
      assert.equal(toSafeCssColor("", "#1E3A5F"), "#1E3A5F");
    });

    test("(d) never a false match inside an unrelated longer word — word-boundary matching, not raw substring", () => {
      // 'cream' must not match inside 'creamery'; 'gold' must not match inside 'marigold'.
      assert.equal(toSafeCssColor("The old creamery building now houses the dining room", "#1E3A5F"), "#1E3A5F");
      assert.equal(toSafeCssColor("Fields of marigold surround the property", "#1E3A5F"), "#1E3A5F");
    });
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

// ===========================================================================
// getReadableTextColor — regression guard for the real Friedman, Grimes,
// Meinken & Leischner PLLC footer bug: design-preview.tsx hardcoded the
// footer's text color to FALLBACK.onDark (#FAFAFA, near-white) on the
// assumption the footer background (Design Memory's `secondary` palette
// color) is always dark. That business's real generated `secondary` was a
// light neutral (#F6F4EF) -- white-on-near-white, ~1.03:1 contrast, nowhere
// near WCAG AA's 4.5:1. getReadableTextColor measures the actual background
// instead of assuming its darkness.
// ===========================================================================
describe("safe-css: getReadableTextColor", () => {
  test("picks dark text against a light background, and confirms it actually clears WCAG AA — the real Friedman Grimes footer regression", () => {
    const background = "#F6F4EF";
    const chosen = getReadableTextColor(background, "#1A1A1A", "#FAFAFA");
    assert.equal(chosen, "#1A1A1A");

    const bgRgb: Rgb = [0xf6, 0xf4, 0xef];
    const chosenRgb: Rgb = [0x1a, 0x1a, 0x1a];
    const ratio = contrastRatio(bgRgb, chosenRgb);
    assert.ok(ratio >= WCAG_AA_NORMAL_TEXT, `expected contrast >= ${WCAG_AA_NORMAL_TEXT}:1, got ${ratio.toFixed(2)}:1`);
  });

  test("the previous hardcoded onDark choice genuinely failed this pairing — confirms this is a real regression guard, not a tautology", () => {
    const bgRgb: Rgb = [0xf6, 0xf4, 0xef];
    const previousChoiceRgb: Rgb = [0xfa, 0xfa, 0xfa]; // FALLBACK.onDark
    const ratio = contrastRatio(bgRgb, previousChoiceRgb);
    assert.ok(
      ratio < WCAG_AA_NORMAL_TEXT,
      `expected the previous hardcoded #FAFAFA-on-#F6F4EF pairing to fail WCAG AA (reproducing the real bug), but it measured ${ratio.toFixed(2)}:1`
    );
  });

  test("picks light text against a dark background — the hero/footer fallback pair remains unchanged", () => {
    assert.equal(getReadableTextColor("#0B1220", "#1A1A1A", "#FAFAFA"), "#FAFAFA");
    assert.equal(getReadableTextColor("#1E3A5F", "#1A1A1A", "#FAFAFA"), "#FAFAFA");
  });

  test("falls back to lightText for a background this can't measure (rgb()/hsl() functions, keywords)", () => {
    assert.equal(getReadableTextColor("rgb(10, 20, 30)", "#1A1A1A", "#FAFAFA"), "#FAFAFA");
    assert.equal(getReadableTextColor("terracotta", "#1A1A1A", "#FAFAFA"), "#FAFAFA");
  });

  test("supports 3-digit hex shorthand", () => {
    assert.equal(getReadableTextColor("#fff", "#1A1A1A", "#FAFAFA"), "#1A1A1A");
    assert.equal(getReadableTextColor("#000", "#1A1A1A", "#FAFAFA"), "#FAFAFA");
  });
});
