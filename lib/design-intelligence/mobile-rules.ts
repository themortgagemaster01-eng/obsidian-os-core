/**
 * Mobile schema and rules (docs/DESIGN_INTELLIGENCE.md §7). Deliberately not
 * built in Sprint 4 Phase 1 — the founder's Phase 1 authorization named
 * "Design rules, Typography rules, Layout rules, Motion rules, Never
 * Generate rules" specifically and `docs/SPRINT_STATUS.md`'s Phase 1 report
 * lists Mobile Standards under "Deliberately not done in Phase 1, per
 * scope." Added now, in Phase 3 (Design Refinement), because a Mobile
 * refinement pass (`docs/SPRINT_STATUS.md`'s Sprint 4 Phase 3 authorization)
 * needs a checkable standard to refine against — the same reasoning
 * layout-rules.ts gives for encoding the generic-SaaS pattern as data
 * instead of leaving "avoid generic templates" as doc prose only. This is a
 * judgment call, not something the founder explicitly named as in-scope for
 * this module; flagged as such in this phase's closure report.
 *
 * Schema only, same discipline as every other module in this directory: the
 * categories of decision and the bounds they must satisfy, never a mission's
 * actual chosen pixel values (design-refinement-service.ts's job).
 */

/**
 * §7's "sized and spaced for a finger, not a cursor" standard, given a
 * concrete floor: 44px is the WCAG 2.5.5 (AA) / iOS Human Interface
 * Guidelines minimum target size, the same number both major mobile
 * platforms and the accessibility standard converge on independently —
 * not an arbitrary pick.
 */
export const MIN_TOUCH_TARGET_PX = 44;

/** Minimum gap between two adjacent touch targets so an imprecise tap can't miss into the wrong one (§7's "no controls so close together that mobile interaction becomes error-prone"). */
export const MIN_TOUCH_TARGET_SPACING_PX = 8;

/** §7's "shouldn't shrink below a genuinely readable floor" — 16px is the standard floor below which mobile browsers themselves start auto-zooming on focus, a hard signal the type is too small, not just a style preference. */
export const MOBILE_BODY_FONT_FLOOR_PX = 16;

/**
 * §3's 45-75 character desktop line-length band re-scoped for mobile
 * viewport widths (§7: "line length needs its own mobile-scale treatment,
 * not a naive scale-down of desktop values") — narrower because a mobile
 * viewport physically can't hold a 75-character line at a readable type
 * size without shrinking below MOBILE_BODY_FONT_FLOOR_PX.
 */
export const MOBILE_READABILITY = {
  bodyLineLengthCharsMin: 30,
  bodyLineLengthCharsMax: 60,
};

export interface TouchTarget {
  name: string;
  widthPx: number;
  heightPx: number;
  /** Gap to the nearest adjacent interactive element, in px. */
  spacingPx: number;
}

export function validateTouchTarget(target: TouchTarget): string[] {
  const errors: string[] = [];

  if (target.widthPx < MIN_TOUCH_TARGET_PX || target.heightPx < MIN_TOUCH_TARGET_PX) {
    errors.push(
      `Touch target "${target.name}" is ${target.widthPx}x${target.heightPx}px — below the ${MIN_TOUCH_TARGET_PX}px minimum in at least one dimension (§7).`
    );
  }
  if (target.spacingPx < MIN_TOUCH_TARGET_SPACING_PX) {
    errors.push(
      `Touch target "${target.name}" has ${target.spacingPx}px of spacing to its neighbor — below the ${MIN_TOUCH_TARGET_SPACING_PX}px minimum (§7).`
    );
  }

  return errors;
}

export interface MobileTypeChoice {
  bodyFontSizePx: number;
  bodyLineLengthChars: number;
}

export function validateMobileTypeChoice(choice: MobileTypeChoice): string[] {
  const errors: string[] = [];

  if (choice.bodyFontSizePx < MOBILE_BODY_FONT_FLOOR_PX) {
    errors.push(
      `Mobile body font size ${choice.bodyFontSizePx}px is below the ${MOBILE_BODY_FONT_FLOOR_PX}px readable floor (§7).`
    );
  }
  if (
    choice.bodyLineLengthChars < MOBILE_READABILITY.bodyLineLengthCharsMin ||
    choice.bodyLineLengthChars > MOBILE_READABILITY.bodyLineLengthCharsMax
  ) {
    errors.push(
      `Mobile body line length should be ${MOBILE_READABILITY.bodyLineLengthCharsMin}-${MOBILE_READABILITY.bodyLineLengthCharsMax} characters per line (§7); got ${choice.bodyLineLengthChars}.`
    );
  }

  return errors;
}
