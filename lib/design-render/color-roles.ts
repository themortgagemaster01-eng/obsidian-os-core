import { hexToRgb } from "@/lib/design-render/safe-css";

/**
 * lib/design-render/color-roles.ts — Fix #8 (Design Intelligence Gap Map).
 *
 * Replaces design-preview.tsx's old background-role mechanism: sort three
 * of DesignMemory.colorPalette's four fields (neutral/primary/secondary —
 * `accent` was excluded entirely) by relative luminance, lightest wins
 * background. Confirmed broken by the Fix #8 audit against real, live
 * mission data: Dante's Trattoria's `primary` field (terracotta, the most
 * saturated of the four real colors) won the background role purely because
 * it measured numerically brighter than the business's own `neutral` field
 * (charcoal) — luminance cannot distinguish "bright and neutral" from
 * "bright and vivid," and the one color best suited to be a calm background
 * (the business's own `accent` field, cream, S58 L89) was never even
 * considered.
 *
 * assignColorRoles below is a genuine relational hierarchy over all FOUR
 * resolved colors instead — verified against real data to reproduce the
 * founder's own worked example for Dante's exactly (background=cream,
 * foreground=charcoal, accent=terracotta, secondary=olive) without special-
 * casing that specific business's values. No LLM call, no new dependency,
 * no schema change — every input here is already a real, Fix #7-resolved
 * hex value from DesignMemory.colorPalette.
 */

export interface ColorRoleCandidates {
  neutral: string;
  primary: string;
  secondary: string;
  accent: string;
}

export interface ColorRoles {
  background: string;
  /**
   * The calmest color from whichever lightness group `background` did NOT
   * come from — a real, business-specific text color instead of a generic
   * constant. `null` when every one of the four candidates landed in the
   * SAME lightness group as `background` (no real light-vs-dark contrast
   * exists anywhere in this palette) — the caller MUST substitute a
   * guaranteed-safe fixed fallback in that case (e.g.
   * safe-css.ts's getReadableTextColor), never render `null`.
   */
  foreground: string | null;
  /** The more saturated of the two colors neither background nor foreground claimed — the boldest remaining color, reserved for the highest-impact treatment (per the founder's approved renderer mapping, this becomes the hero section's background). */
  accent: string;
  /** The less saturated of the two remaining colors. */
  secondary: string;
}

interface Hsl {
  s: number;
  l: number;
}

function rgbToHsl([r, g, b]: [number, number, number]): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return { s: s * 100, l: l * 100 };
}

/**
 * HSL saturation/lightness for a candidate this module can actually measure
 * (a hex token — what toSafeCssColor resolves prose to in practice, per
 * safe-css.ts's own relativeLuminanceOfCssColor precedent). An unmeasurable
 * candidate (an rgb()/hsl() function or a bare CSS keyword — toSafeCssColor's
 * rarer outputs) gets a neutral {s:50, l:50} placeholder rather than
 * crashing or being force-excluded: a moderate default that neither
 * over- nor under-favors a color this module has no real data on, for a
 * case that never arises against either audited mission's real data.
 */
function hslOf(color: string): Hsl {
  const rgb = hexToRgb(color);
  return rgb ? rgbToHsl(rgb) : { s: 50, l: 50 };
}

interface Candidate extends Hsl {
  field: keyof ColorRoleCandidates;
  hex: string;
}

function lightnessExtremity(l: number): number {
  return Math.abs(l - 50);
}

/** Ascending saturation (calmest first); exact ties broken by preferring the more extreme lightness — pure defensive plumbing, never observed to matter on real data checked during this fix's own audit. */
function byNeutralityThenExtremity(a: Candidate, b: Candidate): number {
  return a.s - b.s || lightnessExtremity(b.l) - lightnessExtremity(a.l);
}

/**
 * assignColorRoles — the one entry point. Always returns a real, complete
 * result (never throws, never partial `background`/`accent`/`secondary`).
 *
 * 1. Split all four resolved colors into a light group (lightness >= 50)
 *    and a dark group (< 50).
 * 2. `background` = the least-saturated (calmest) member of the light
 *    group, when one exists; otherwise the calmest member of the dark
 *    group — an honestly dark-leaning palette is never forced light.
 * 3. `foreground` = the calmest member of the OTHER group, when that group
 *    is non-empty; `null` when it's empty (every candidate shares
 *    background's own group) — see the ColorRoles.foreground doc comment
 *    for the caller's required fallback behavior.
 * 4. Of the (up to two) candidates neither `background` nor `foreground`
 *    claimed, the more saturated becomes `accent`, the less saturated
 *    becomes `secondary`.
 */
export function assignColorRoles(candidates: ColorRoleCandidates): ColorRoles {
  const all: Candidate[] = (Object.entries(candidates) as [keyof ColorRoleCandidates, string][]).map(
    ([field, hex]) => ({ field, hex, ...hslOf(hex) })
  );

  const light = all.filter((c) => c.l >= 50).sort(byNeutralityThenExtremity);
  const dark = all.filter((c) => c.l < 50).sort(byNeutralityThenExtremity);

  let background: Candidate;
  let foreground: Candidate | null;
  if (light.length > 0) {
    background = light[0];
    foreground = dark.length > 0 ? dark[0] : null;
  } else {
    // light.length === 0 implies dark.length === 4 (every candidate has
    // some lightness value, so at least one group is always non-empty).
    background = dark[0];
    foreground = null;
  }

  const remaining = all.filter((c) => c !== background && c !== foreground).sort((a, b) => b.s - a.s);
  const accent = remaining[0] ?? background;
  const secondary = remaining[1] ?? accent;

  return {
    background: background.hex,
    foreground: foreground?.hex ?? null,
    accent: accent.hex,
    secondary: secondary.hex,
  };
}
