/**
 * Motion schema and rules (docs/DESIGN_INTELLIGENCE.md §6). Two different
 * kinds of constraint, deliberately not collapsed into one: a *tunable*
 * default band (duration, per §6's "tunable intensity, not a fixed
 * absolute") that a Design Brief may deliberately deviate from for a
 * specific business's positioning, and a *non-negotiable* bound (no
 * bounce/spring, never motion with no functional purpose) that no mission
 * may ever override — §6 names the bound itself, not the specific values
 * inside it, as the non-negotiable part.
 */
import type { EasingCurve } from "@/lib/design-intelligence/types";

/** Mirrors docs/09-UI-Design-System.md's own restraint discipline (§6) — the default band, not an absolute. */
export const MOTION_DURATION_BAND_MS = { min: 200, max: 300 };

export const ALLOWED_EASING: EasingCurve[] = ["ease", "ease-in", "ease-out", "ease-in-out", "linear"];

/** Never allowed, for any mission, regardless of industry or deviation (§6's non-negotiable bound). */
export const BANNED_EASING_KEYWORDS = ["bounce", "spring", "elastic"];

export interface MotionChoice {
  durationMs: number;
  easing: string;
  /** What this motion communicates — a state change, an entrance, interaction feedback. Required: motion with no stated purpose is banned outright (§6, §11). */
  purpose: string;
  /** True only when the Design Brief has made and disclosed a deliberate decision to exceed the default band for this mission's industry/positioning (§6) — never a silent default. */
  deliberateDeviation?: boolean;
}

export function validateMotionChoice(choice: MotionChoice): string[] {
  const errors: string[] = [];

  if (!choice.purpose.trim()) {
    errors.push(
      "Motion must state a functional purpose (what just changed, what to notice now) — motion that exists only to seem alive or modern is never allowed (§6)."
    );
  }

  const lowerEasing = choice.easing.toLowerCase();
  if (BANNED_EASING_KEYWORDS.some((keyword) => lowerEasing.includes(keyword))) {
    errors.push(`Bounce/spring/elastic easing is never allowed, for any mission (§6): got "${choice.easing}".`);
  } else if (!ALLOWED_EASING.some((curve) => lowerEasing === curve)) {
    errors.push(`"${choice.easing}" is not one of the allowed easing curves (${ALLOWED_EASING.join(", ")}) (§6).`);
  }

  const inBand = choice.durationMs >= MOTION_DURATION_BAND_MS.min && choice.durationMs <= MOTION_DURATION_BAND_MS.max;
  if (!inBand && !choice.deliberateDeviation) {
    errors.push(
      `Duration ${choice.durationMs}ms falls outside the default ${MOTION_DURATION_BAND_MS.min}-${MOTION_DURATION_BAND_MS.max}ms band, and no deliberate Design Brief deviation was disclosed (§6).`
    );
  }

  return errors;
}
