/**
 * Typography schema and rules (docs/DESIGN_INTELLIGENCE.md §3). Schema only —
 * the named type roles and the constraints their relationships and body
 * copy must satisfy — never a mission's actual chosen family names or pixel
 * values, which are design-brief-service.ts's future output (§9 Design
 * Review's schema-vs-values distinction).
 */
import type { TypeRole } from "@/lib/design-intelligence/types";

/** At most two type families per generated site, or one family used across weights (§3's font pairing philosophy). */
export const MAX_TYPE_FAMILIES = 2;

/** Canonical order, largest/most prominent role first — the order §3's "spacing should scale with the heading's level" and "contrast between roles" language assumes. */
export const TYPE_ROLE_ORDER: TypeRole[] = [
  "display",
  "heading1",
  "heading2",
  "heading3",
  "body",
  "caption",
];

export interface TypeRoleSpec {
  role: TypeRole;
  /** Size relative to body (body = 1) — schema-level contrast, not a mission's actual px/rem values. */
  relativeSize: number;
  relativeWeight: "regular" | "medium" | "semibold" | "bold";
}

/**
 * A reasonable default scale expressing §3's required contrast between
 * roles — a starting point for design-brief-service.ts to adapt per
 * mission, not a fixed value every generated site must use verbatim.
 */
export const DEFAULT_TYPE_SCALE: TypeRoleSpec[] = [
  { role: "display", relativeSize: 3, relativeWeight: "semibold" },
  { role: "heading1", relativeSize: 2.25, relativeWeight: "semibold" },
  { role: "heading2", relativeSize: 1.75, relativeWeight: "semibold" },
  { role: "heading3", relativeSize: 1.375, relativeWeight: "medium" },
  { role: "body", relativeSize: 1, relativeWeight: "regular" },
  { role: "caption", relativeSize: 0.8125, relativeWeight: "medium" },
];

/** §3's readability standard — a range, not a single value, because it's a long-studied reasonable band rather than one exact number. */
export const READABILITY = {
  bodyLineLengthCharsMin: 45,
  bodyLineLengthCharsMax: 75,
  bodyLineHeightMin: 1.4,
  bodyLineHeightMax: 1.6,
};

/**
 * Confirms a type scale actually carries the contrast §3 requires: every
 * role earlier in TYPE_ROLE_ORDER must be at least as large as the role
 * after it. A scale that fails this has sizes doing no hierarchy work,
 * which is exactly the "weak typography" Never Generate entry names.
 */
export function validateTypeScaleOrdering(scale: TypeRoleSpec[]): string[] {
  const errors: string[] = [];
  const byRole = new Map(scale.map((s) => [s.role, s]));

  for (const role of TYPE_ROLE_ORDER) {
    if (!byRole.has(role)) {
      errors.push(`Type scale is missing the "${role}" role — §3 defines a small, complete set of named roles, not a partial one.`);
    }
  }

  for (let i = 0; i < TYPE_ROLE_ORDER.length - 1; i++) {
    const current = byRole.get(TYPE_ROLE_ORDER[i]);
    const next = byRole.get(TYPE_ROLE_ORDER[i + 1]);
    if (current && next && current.relativeSize < next.relativeSize) {
      errors.push(
        `"${current.role}" (${current.relativeSize}) must be at least as large as "${next.role}" (${next.relativeSize}) — role order should carry real size contrast (§3).`
      );
    }
  }

  return errors;
}

export interface TypographyChoice {
  /** Distinct family names actually used across all roles — length must not exceed MAX_TYPE_FAMILIES. */
  families: string[];
  bodyLineLengthChars: number;
  bodyLineHeight: number;
}

export function validateTypographyChoice(choice: TypographyChoice): string[] {
  const errors: string[] = [];
  const distinctFamilies = new Set(choice.families);

  if (distinctFamilies.size > MAX_TYPE_FAMILIES) {
    errors.push(
      `At most ${MAX_TYPE_FAMILIES} type families are allowed per generated site (§3); got ${distinctFamilies.size} (${[...distinctFamilies].join(", ")}).`
    );
  }
  if (
    choice.bodyLineLengthChars < READABILITY.bodyLineLengthCharsMin ||
    choice.bodyLineLengthChars > READABILITY.bodyLineLengthCharsMax
  ) {
    errors.push(
      `Body line length should be ${READABILITY.bodyLineLengthCharsMin}-${READABILITY.bodyLineLengthCharsMax} characters per line (§3); got ${choice.bodyLineLengthChars}.`
    );
  }
  if (choice.bodyLineHeight < READABILITY.bodyLineHeightMin || choice.bodyLineHeight > READABILITY.bodyLineHeightMax) {
    errors.push(
      `Body line-height should be ${READABILITY.bodyLineHeightMin}-${READABILITY.bodyLineHeightMax}x the type size (§3); got ${choice.bodyLineHeight}.`
    );
  }

  return errors;
}
