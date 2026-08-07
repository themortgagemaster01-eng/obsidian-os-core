/**
 * Layout schema and rules (docs/DESIGN_INTELLIGENCE.md §5). The generic-SaaS
 * template pattern is named here concretely, per §5's own instruction that
 * "avoid" should be checkable rather than a vibe — a named, structured
 * pattern a future design-qa-service can actually compare generated output
 * against, not just prose in a doc a generation prompt might not honor.
 */

/** A starting, non-exhaustive vocabulary of layout families (§5, §10) — a direction a Design Brief chooses, not a fixed enum every business must fit. */
export type LayoutFamily =
  | "editorial"
  | "imagery-led"
  | "credibility-led"
  | "schedule-led"
  | "menu-led"
  | "listing-led";

/**
 * The exact generic pattern §5 names as the one to avoid without a
 * content-driven reason: a centered hero, then a fixed sequence of
 * safe-default SaaS sections, in this order, regardless of the business.
 */
export const GENERIC_SAAS_TEMPLATE_SECTION_ORDER: string[] = [
  "centered-hero-headline-subhead-two-buttons",
  "icon-feature-card-row",
  "logo-strip",
  "testimonial-carousel",
  "pricing-table",
  "faq-accordion",
  "footer",
];

/**
 * Flags a generated site's section order as the exact named generic
 * pattern (§5, §11's "Never Generate" entry) — an intentionally narrow,
 * exact-match check. It will not catch every generic-feeling layout (§7 of
 * the Design Review names this honestly: "not generic" has no clean
 * mechanical check the way "no adapter names in this string" does), but a
 * site that matches this exact sequence has certainly failed §5.
 */
export function matchesGenericSaasTemplate(sectionOrder: string[]): boolean {
  if (sectionOrder.length !== GENERIC_SAAS_TEMPLATE_SECTION_ORDER.length) return false;
  return sectionOrder.every((section, i) => section === GENERIC_SAAS_TEMPLATE_SECTION_ORDER[i]);
}

/** A consistent column/gutter system carried through the page (§4's grid rhythm) — schema default, not a mission's final value. */
export interface GridRhythm {
  columns: number;
  gutterRem: number;
}

export const DEFAULT_GRID_RHYTHM: GridRhythm = { columns: 12, gutterRem: 1.5 };

export interface MissionSectionStructure {
  missionId: string;
  sectionOrder: string[];
}

/**
 * The mechanical proxy `docs/SPRINT_4_DESIGN_REVIEW.md` §12's acceptance
 * criterion 3 proposes for "not a template": no two generated sites for
 * different businesses in the same review batch should share an identical
 * section-order skeleton. Named honestly, per §7/§13 of that document, as a
 * partial proxy, not a complete guarantee that a design is genuinely
 * bespoke — a batch could pass this check while still failing the
 * qualitative "does this look composed for this business" bar.
 */
export function findDuplicateSectionStructures(entries: MissionSectionStructure[]): string[][] {
  const missionIdsByStructureKey = new Map<string, string[]>();

  for (const entry of entries) {
    const key = entry.sectionOrder.join("|");
    const group = missionIdsByStructureKey.get(key);
    if (group) {
      group.push(entry.missionId);
    } else {
      missionIdsByStructureKey.set(key, [entry.missionId]);
    }
  }

  return [...missionIdsByStructureKey.values()].filter((group) => group.length > 1);
}
