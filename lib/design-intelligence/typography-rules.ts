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
 *
 * Phase 15 (Design Intelligence Gap Map, Fix #1): this is now specifically
 * the "editorial" member of TYPE_SCALE_VARIANTS below, and the mandatory
 * fallback whenever resolveTypeScaleIntent can't confidently pick one of
 * the other two — its own values are UNCHANGED from before this phase, so
 * every mission that resolves (or defaults) to "editorial" renders with
 * byte-identical typography to pre-Phase-15 output.
 */
export const DEFAULT_TYPE_SCALE: TypeRoleSpec[] = [
  { role: "display", relativeSize: 3, relativeWeight: "semibold" },
  { role: "heading1", relativeSize: 2.25, relativeWeight: "semibold" },
  { role: "heading2", relativeSize: 1.75, relativeWeight: "semibold" },
  { role: "heading3", relativeSize: 1.375, relativeWeight: "medium" },
  { role: "body", relativeSize: 1, relativeWeight: "regular" },
  { role: "caption", relativeSize: 0.8125, relativeWeight: "medium" },
];

/**
 * A tighter, denser scale — smaller jumps between roles — for a mission
 * whose own AI-generated typography reasoning (DesignMemory.typography)
 * describes a compact/quiet/understated register. Still passes
 * validateTypeScaleOrdering (strictly descending) and, once multiplied by
 * a real body px size, still lands well inside READABILITY's band (that
 * band governs line-length/line-height, not role-to-role ratio, so it is
 * unaffected by which variant is chosen).
 */
export const COMPACT_TYPE_SCALE: TypeRoleSpec[] = [
  { role: "display", relativeSize: 2.5, relativeWeight: "semibold" },
  { role: "heading1", relativeSize: 2, relativeWeight: "semibold" },
  { role: "heading2", relativeSize: 1.5, relativeWeight: "medium" },
  { role: "heading3", relativeSize: 1.25, relativeWeight: "medium" },
  { role: "body", relativeSize: 1, relativeWeight: "regular" },
  { role: "caption", relativeSize: 0.85, relativeWeight: "medium" },
];

/**
 * A bolder, higher-contrast scale — a larger display jump — for a mission
 * whose own AI-generated typography reasoning explicitly describes a
 * display-led/dramatic/statement register (e.g. names a real "display"
 * typeface category, not just "a serif"). Same ordering/readability
 * guarantee as COMPACT_TYPE_SCALE above.
 */
export const DISPLAY_LED_TYPE_SCALE: TypeRoleSpec[] = [
  { role: "display", relativeSize: 3.5, relativeWeight: "bold" },
  { role: "heading1", relativeSize: 2.5, relativeWeight: "semibold" },
  { role: "heading2", relativeSize: 1.875, relativeWeight: "semibold" },
  { role: "heading3", relativeSize: 1.4375, relativeWeight: "medium" },
  { role: "body", relativeSize: 1, relativeWeight: "regular" },
  { role: "caption", relativeSize: 0.8125, relativeWeight: "medium" },
];

/**
 * The closed, bounded vocabulary Fix #1 selects among — never a free
 * numeric value derived from AI prose. "editorial" (== DEFAULT_TYPE_SCALE)
 * is both a real member of this set and the mandatory safe fallback.
 */
export type TypeScaleIntent = "editorial" | "compact" | "display-led";

export const TYPE_SCALE_VARIANTS: Record<TypeScaleIntent, TypeRoleSpec[]> = {
  editorial: DEFAULT_TYPE_SCALE,
  compact: COMPACT_TYPE_SCALE,
  "display-led": DISPLAY_LED_TYPE_SCALE,
};

/**
 * A small, closed keyword vocabulary — the same "bounded, deterministic,
 * never-free-text-derived" discipline composition-variants.ts's own
 * matchesAnyToneKeyword/personalityPaddingBias already established for a
 * different field (brandPersonality/contentTone). Applied here to
 * DesignMemory.typography's own text (headingFamily + bodyFamily +
 * scaleNotes combined) — real, mission-specific reasoning the LLM already
 * produces today, never parsed for literal numbers or instructions, only
 * matched against these fixed word lists.
 *
 * Deliberately multi-word phrases for the display-led set, not a bare
 * "display" — a real, confirmed false positive during this fix's own
 * testing: "Playfair Display" (a real, common Google Font's own proper
 * name) contains the bare word "display" with no descriptive meaning at
 * all, and would otherwise false-trigger for any mission whose LLM-chosen
 * heading family simply happens to include a font named that. Phrases like
 * "serif display"/"display headline" are how the real Carriage House
 * Mahopac mission's own text ("Warm serif display... like Fraunces or
 * Freight Display") actually reads when the intent IS genuinely
 * descriptive, and don't match a bare proper-noun font name.
 */
const COMPACT_SCALE_KEYWORDS = ["compact", "tight", "dense", "condensed", "space-efficient", "understated"];
const DISPLAY_LED_SCALE_KEYWORDS = [
  "serif display",
  "sans display",
  "display headline",
  "display typography",
  "display type",
  "display font",
  "dramatic",
  "bold statement",
  "oversized",
  "striking",
  "commanding",
  "expressive",
];

function textContainsAnyKeyword(haystack: string, keywords: string[]): boolean {
  const lower = haystack.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

/**
 * resolveTypeScaleIntent — Fix #1's own resolver. Reads real, already-
 * generated, already-persisted DesignMemory.typography text and maps it to
 * one of the three closed TYPE_SCALE_VARIANTS entries. Mirrors
 * personalityPaddingBias's own "matched-and-not-the-other" symmetry: both
 * keyword sets matching (ambiguous) resolves the same as neither matching
 * (absent/unclear) — "editorial", the safe default, never a guess between
 * two real signals.
 *
 * Fix #6 (Design Intelligence Gap Map): `typographicMood` — DesignBrief.
 * direction.typographicMood, produced in the SAME LLM response as
 * DesignMemory.typography but never previously read by this resolver — is
 * now folded into the same haystack as a fourth string. It can only ever
 * ADD a true-positive keyword match this function didn't previously see;
 * it never removes or overrides a match the other three fields already
 * produced, and an absent/empty value is exactly today's pre-Fix-#6 input
 * (optional, defaults to undefined, filtered out the same way the other
 * three fields already are when blank).
 */
export function resolveTypeScaleIntent(
  typography?: { headingFamily?: string; bodyFamily?: string; scaleNotes?: string } | null,
  typographicMood?: string
): TypeScaleIntent {
  const text = [typography?.headingFamily, typography?.bodyFamily, typography?.scaleNotes, typographicMood]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join(" ");
  if (!text) return "editorial";

  const compact = textContainsAnyKeyword(text, COMPACT_SCALE_KEYWORDS);
  const displayLed = textContainsAnyKeyword(text, DISPLAY_LED_SCALE_KEYWORDS);

  if (compact && !displayLed) return "compact";
  if (displayLed && !compact) return "display-led";
  return "editorial";
}

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
