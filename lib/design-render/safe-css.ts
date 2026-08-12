/**
 * lib/design-render/safe-css.ts — small, pure guards for turning free-text
 * Design Memory fields (DesignMemory.colorPalette / typography, per
 * lib/services/design-intelligence-service.ts) into CSS values the renderer
 * can hand to React's `style` prop without risk.
 *
 * These fields are real LLM output, not a validated design-token schema —
 * real values look like "Deep navy (#122A3D-range)" or "A geometric
 * humanist sans... e.g. Söhne or similar": plausible as prose, not directly
 * parseable/resolvable as CSS. CTO Design Intelligence Remediation directive
 * (Issue 1) found that the color path was rejecting this prose outright and
 * silently falling back to the same default navy/gold palette for every
 * business, discarding real per-business color reasoning the model had
 * already produced — so both guards below now extract a structured signal
 * from the prose before falling back, rather than requiring the whole field
 * to itself already be valid CSS:
 *
 * - toSafeCssColor extracts the first embedded valid `#RRGGBB`-style hex
 *   token (e.g. pulls "#122A3D" out of "Deep navy (#122A3D-range)") before
 *   falling back — real per-business color reaches the page instead of the
 *   same default every time.
 * - toSafeFontFamilyStack had a quieter version of the identical bug: an
 *   arbitrary quoted string is syntactically valid CSS wherever a
 *   font-family is expected, so the old code never "failed," but a
 *   multi-sentence descriptive phrase quoted as a literal font name never
 *   resolves to a real installed font either — every business's heading
 *   silently fell through to the same fixed fallback stack, which is
 *   functionally the same convergence-on-default bug wearing a different
 *   costume. Now it extracts a plausible real font-name token (quoted
 *   examples, or names following "e.g."/"such as"/"like") to try first, and
 *   picks a genre-appropriate system fallback stack (serif/sans/slab/mono)
 *   from keywords in the prose instead of one fixed stack for every
 *   business — so distinct typographic direction actually reaches the page
 *   even when the named font itself isn't installed.
 */

/**
 * Shared minimum opacity for de-emphasized text (slot labels, placeholder
 * markers, secondary copy) across the design-preview renderer. A real
 * axe-core run against the rendered Veslo Family Restaurant preview found a
 * genuine "serious" color-contrast violation on 15 nodes — not from any
 * Design Memory color choice (those were rejected as invalid CSS by
 * toSafeCssColor and fell back to this renderer's own defaults), but from
 * this renderer's own previous 0.55/0.6 opacity values blending dark text
 * toward its light background below the WCAG AA 4.5:1 threshold for normal-
 * size text (measured ~4.48:1 at 0.6, i.e. an actual, reproducible failure,
 * not a false positive). 0.75 clears every text/background pairing this
 * renderer's fallback palette actually produces with real margin (~7.4:1 for
 * the tightest real case, dark text on the light neutral fallback) — a fix
 * at this shared constant, not a per-business or per-run patch, so it holds
 * for every future mission's fallback-colored preview, not just this one.
 */
export const MUTED_TEXT_OPACITY = 0.75;

const HEX_COLOR = /^#[0-9a-f]{3,4}$|^#[0-9a-f]{6}$|^#[0-9a-f]{8}$/i;
const FUNCTIONAL_COLOR = /^(rgb|rgba|hsl|hsla)\([^)]+\)$/i;
const SINGLE_WORD = /^[a-z]+$/i;

/**
 * Matches a valid CSS hex color token embedded anywhere inside a longer
 * string — longest-length alternative first (8/6/4/3 hex digits) with a
 * trailing negative lookahead so e.g. "#122A3D-range" extracts exactly
 * "#122A3D" rather than over- or under-matching.
 */
const EMBEDDED_HEX_TOKEN = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/i;

/** Matches a CSS rgb()/rgba()/hsl()/hsla() function call embedded anywhere inside a longer string. */
const EMBEDDED_FUNCTIONAL_COLOR = /(?:rgb|rgba|hsl|hsla)\([^)]+\)/i;

/** True only for strings that are actually valid CSS `<color>` syntax — hex, rgb()/hsl() functions, or a single bare keyword. Multi-word prose ("Warm terracotta") is rejected, not guessed at. */
export function isPlausibleCssColor(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return HEX_COLOR.test(v) || FUNCTIONAL_COLOR.test(v) || SINGLE_WORD.test(v);
}

/**
 * Returns `raw` if it's plausible CSS color syntax; otherwise looks for a
 * real, valid hex or rgb()/hsl() token embedded inside the prose (e.g. "Deep
 * navy (#122A3D-range)..." -> "#122A3D") and returns that; otherwise
 * `fallback` — never emits a value that would silently fail, but no longer
 * discards real per-business color reasoning just because it arrived as a
 * sentence instead of a bare token (CTO Design Intelligence Remediation
 * directive, Issue 1).
 */
export function toSafeCssColor(raw: string | undefined | null, fallback: string): string {
  if (!raw) return fallback;
  const v = raw.trim();
  if (isPlausibleCssColor(v)) return v;
  const hexMatch = v.match(EMBEDDED_HEX_TOKEN);
  if (hexMatch) return hexMatch[0];
  const functionalMatch = v.match(EMBEDDED_FUNCTIONAL_COLOR);
  if (functionalMatch) return functionalMatch[0];
  return fallback;
}

const SANS_FALLBACK_STACK = '"Helvetica Neue", Arial, "Segoe UI", sans-serif';
const SERIF_FALLBACK_STACK = 'Georgia, Cambria, "Times New Roman", serif';
const SLAB_FALLBACK_STACK = '"Roboto Slab", "Arial Black", sans-serif';
const MONO_FALLBACK_STACK = '"SF Mono", "Courier New", monospace';

/**
 * Picks a genre-appropriate system fallback stack from keywords in the raw
 * typography prose, instead of always the one stack the caller supplied —
 * this is what stops every business's heading converging on the same
 * default font once the named font itself fails to resolve (Issue 1's
 * typography half). Falls back to the caller's own default stack when no
 * genre keyword is present, preserving prior behavior for non-descriptive
 * input.
 */
function genreFallbackStack(raw: string, defaultStack: string): string {
  const v = raw.toLowerCase();
  if (/\bmono(space)?\b/.test(v)) return MONO_FALLBACK_STACK;
  if (/\bslab\b/.test(v)) return SLAB_FALLBACK_STACK;
  if (/sans[- ]?serif|\bsans\b|grotesk|geometric|humanist/.test(v)) return SANS_FALLBACK_STACK;
  if (/\bserif\b|garamond|caslon|didone|transitional|old[- ]style/.test(v)) return SERIF_FALLBACK_STACK;
  return defaultStack;
}

/** Pulls a plausible real font-name token out of descriptive prose — a quoted name, or a capitalized name following "e.g."/"such as"/"like" (e.g. "...e.g. Söhne or similar" -> "Söhne"). Returns null when nothing recognizable is found, never a guess. */
function extractNamedFontCandidate(raw: string): string | null {
  const afterExample = raw.match(/(?:e\.g\.,?|such as|like)\s+([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'-]*(?:\s[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'-]*){0,2})/);
  if (afterExample) return afterExample[1].trim();
  const quoted = raw.match(/["“]([^"”]{2,40})["”]/);
  if (quoted) return quoted[1].trim();
  return null;
}

/**
 * Builds a real font-family stack from descriptive Design Memory typography
 * prose: a real, extracted font-name candidate first (when the prose names
 * one), then a genre-appropriate system fallback stack (serif/sans/slab/
 * mono, from keywords in the prose) rather than the caller's fixed default
 * every time — the CSS-quoting itself was never invalid (an arbitrary
 * quoted string is always syntactically valid as a font-family), but
 * quoting the whole sentence as a literal "font name" never resolves to a
 * real font, so every business fell through to the same default stack —
 * functionally the same discard-real-reasoning bug as Issue 1's color path
 * (CTO Design Intelligence Remediation directive).
 */
export function toSafeFontFamilyStack(raw: string | undefined | null, fallbackStack: string): string {
  const v = raw?.trim();
  if (!v) return fallbackStack;
  const candidate = extractNamedFontCandidate(v);
  const genreStack = genreFallbackStack(v, fallbackStack);
  if (!candidate) return genreStack;
  const escaped = candidate.replace(/"/g, '\\"');
  return `"${escaped}", ${genreStack}`;
}

/**
 * Parses a CSS hex color (#RGB[A] or #RRGGBB[AA]) into 0-255 RGB components,
 * ignoring any alpha channel. Returns null for anything else (rgb()/hsl()
 * functions, bare keywords) -- not a full CSS color parser, just enough to
 * measure the hex tokens toSafeCssColor actually produces from real Design
 * Memory palette values.
 */
function hexToRgb(hex: string): [number, number, number] | null {
  const v = hex.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])[0-9a-f]?$/i.exec(v);
  if (short) {
    return [parseInt(short[1] + short[1], 16), parseInt(short[2] + short[2], 16), parseInt(short[3] + short[3], 16)];
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(v);
  if (long) {
    return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)];
  }
  return null;
}

function srgbChannelToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of an RGB triple — same formula axe-core uses (see MUTED_TEXT_OPACITY above). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Picks whichever of `darkText`/`lightText` gives better WCAG contrast
 * against a given background, instead of assuming a section's background is
 * always dark (or always light).
 *
 * Real bug this fixes: components/design-preview/design-preview.tsx hardcoded
 * the footer's text color to FALLBACK.onDark (#FAFAFA, near-white) on the
 * assumption the footer background (Design Memory's `secondary` palette
 * color) is always dark. For Friedman, Grimes, Meinken & Leischner PLLC,
 * `secondary` resolved to a light neutral (#F6F4EF) -- white text on a
 * near-white background, functionally invisible (axe-core / manual review:
 * ~1.03:1 contrast, WCAG AA requires 4.5:1). This measures the actual
 * background instead of assuming its darkness, the same "verify, don't just
 * assume the pairing holds" discipline toSafeCssColor and MUTED_TEXT_OPACITY
 * already follow in this file.
 *
 * Falls back to `lightText` when `background` isn't a hex color this can
 * measure (rgb()/hsl() functions, bare keywords) -- preserves this
 * renderer's prior default for the cases toSafeCssColor doesn't normally
 * produce in practice (it resolves LLM prose to a hex token when one exists).
 */
export function getReadableTextColor(background: string, darkText = "#1A1A1A", lightText = "#FAFAFA"): string {
  const bgRgb = hexToRgb(background);
  if (!bgRgb) return lightText;
  const bgLuminance = relativeLuminance(bgRgb);

  const darkRgb = hexToRgb(darkText);
  const lightRgb = hexToRgb(lightText);
  const darkContrast = darkRgb ? contrastRatio(bgLuminance, relativeLuminance(darkRgb)) : 0;
  const lightContrast = lightRgb ? contrastRatio(bgLuminance, relativeLuminance(lightRgb)) : 0;

  return lightContrast >= darkContrast ? lightText : darkText;
}

const WEIGHT_TO_CSS: Record<"regular" | "medium" | "semibold" | "bold", number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

/** Maps this codebase's named weight scale (lib/services/design-refinement-service.ts's TypeRoleValue) to a numeric CSS font-weight. */
export function toCssFontWeight(weight: "regular" | "medium" | "semibold" | "bold"): number {
  return WEIGHT_TO_CSS[weight];
}
