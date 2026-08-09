/**
 * lib/design-render/safe-css.ts — small, pure guards for turning free-text
 * Design Memory fields (DesignMemory.colorPalette.*, per
 * lib/services/design-intelligence-service.ts) into CSS values the renderer
 * can hand to React's `style` prop without risk.
 *
 * These fields are real LLM output, not a validated design-token schema —
 * docs/SPRINT_STATUS.md's own live-validation entries show real values like
 * "Warm terracotta" or "Muted gold": plausible as prose, not parseable as
 * CSS. An invalid `color` declaration is simply dropped by the browser (the
 * element inherits instead), which is safe but silently loses the intended
 * override — so a value that clearly isn't a CSS color is rejected here in
 * favor of an explicit fallback, rather than emitted and quietly ignored by
 * the browser.
 *
 * Font-family values don't need the same rejection: an arbitrary quoted
 * string is syntactically valid CSS wherever a font-family is expected, and
 * a fallback stack after it is honored if the named font doesn't resolve —
 * so an LLM's descriptive font phrase can be passed straight through, quoted.
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

/** True only for strings that are actually valid CSS `<color>` syntax — hex, rgb()/hsl() functions, or a single bare keyword. Multi-word prose ("Warm terracotta") is rejected, not guessed at. */
export function isPlausibleCssColor(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return HEX_COLOR.test(v) || FUNCTIONAL_COLOR.test(v) || SINGLE_WORD.test(v);
}

/** Returns `raw` if it's plausible CSS color syntax, otherwise `fallback` — never emits a value that would silently fail. */
export function toSafeCssColor(raw: string | undefined | null, fallback: string): string {
  if (!raw) return fallback;
  return isPlausibleCssColor(raw) ? raw.trim() : fallback;
}

/** Quotes an arbitrary font-family string and appends a real fallback stack — safe even when `raw` is prose, since an unresolvable quoted name just falls through to the stack. */
export function toSafeFontFamilyStack(raw: string | undefined | null, fallbackStack: string): string {
  const v = raw?.trim();
  if (!v) return fallbackStack;
  const escaped = v.replace(/"/g, '\\"');
  return `"${escaped}", ${fallbackStack}`;
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
