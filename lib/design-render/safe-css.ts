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
