/**
 * General design principles (docs/DESIGN_INTELLIGENCE.md §1-§2) plus the
 * spacing schema (§4). Spacing is folded into this module rather than given
 * its own file: the founder's Phase 1 authorization names "Design rules,
 * Typography rules, Layout rules, Motion rules, Never Generate rules" as the
 * five deliverables and doesn't list spacing separately, while §2 explicitly
 * frames "whitespace as an active design decision" as one of the Premium
 * Design Principles rather than a layout-specific concern — a judgment call,
 * flagged for founder review rather than silently decided.
 *
 * DESIGN_PRINCIPLES is data, not a mechanically-enforceable rule set — most
 * of §1-§2 (executive presentation, storytelling over feature-dumping) is
 * the qualitative bar `docs/SPRINT_4_DESIGN_REVIEW.md` §7 already names as
 * the one dimension this codebase can't yet grade mechanically. Recording it
 * as structured data (rather than leaving it only as doc prose) still buys
 * something: design-brief-service.ts and design-qa-service.ts can cite a
 * principle by id, and a human reviewer gets a stable checklist instead of
 * re-reading the philosophy doc's prose every time.
 */

export interface DesignPrinciple {
  id: string;
  statement: string;
  /** Section of docs/DESIGN_INTELLIGENCE.md this principle is drawn from. */
  reference: string;
}

export const DESIGN_PRINCIPLES: DesignPrinciple[] = [
  {
    id: "confidence-not-decoration",
    statement:
      "Premium means the design demonstrates real thought given to this specific business, not that it carries more visual flourish than a competitor's output.",
    reference: "DESIGN_INTELLIGENCE.md §1",
  },
  {
    id: "restraint-can-be-premium",
    statement:
      "A restrained, quiet, perfectly-typeset page can be more premium than a heavily animated, densely decorated one — restraint is frequently the more expensive-looking choice.",
    reference: "DESIGN_INTELLIGENCE.md §1",
  },
  {
    id: "hierarchy-not-emphasis-everywhere",
    statement:
      "A reader's eye should land on the most important thing first without being told which thing that is. A page where everything is emphasized has emphasized nothing.",
    reference: "DESIGN_INTELLIGENCE.md §2",
  },
  {
    id: "editorial-over-templated",
    statement:
      "A page whose structure follows the specific content and story of one business reads as composed; a page built section-by-section from a fixed template reads as assembled.",
    reference: "DESIGN_INTELLIGENCE.md §2, §5",
  },
  {
    id: "whitespace-is-active",
    statement:
      "Whitespace is an active design decision, not unused leftover space — compressed, minimal-margin layouts read as budget, not efficient.",
    reference: "DESIGN_INTELLIGENCE.md §2, §4",
  },
  {
    id: "motion-clarifies-not-performs",
    statement:
      "Motion should clarify what changed or what's now in focus, and never exist purely to perform — to seem alive or modern for its own sake.",
    reference: "DESIGN_INTELLIGENCE.md §2, §6",
  },
  {
    id: "storytelling-not-feature-dump",
    statement:
      "The site's structure should follow the narrative order that makes sense for this specific business's value proposition, not a fixed section checklist executed regardless of what the business does.",
    reference: "DESIGN_INTELLIGENCE.md §2",
  },
  {
    id: "executive-presentation",
    statement:
      "The output should be something a founder would be comfortable putting in front of their own board — a bar closer to surviving scrutiny from someone with real taste and real stakes than 'acceptable at a glance.'",
    reference: "DESIGN_INTELLIGENCE.md §2",
  },
  {
    id: "conversion-and-premium-are-not-in-tension",
    statement:
      "A beautiful site that fails to make its call to action findable has not achieved a premium result — it has achieved an expensive-looking failure.",
    reference: "DESIGN_INTELLIGENCE.md §2",
  },
];

export function findDesignPrinciple(id: string): DesignPrinciple | undefined {
  return DESIGN_PRINCIPLES.find((p) => p.id === id);
}

/**
 * A single sitewide proportional spacing scale (§4) — smallest to largest,
 * in rem. One scale applied throughout, not invented per section. This is
 * schema plus a sensible starting default, not a mission's actual chosen
 * values: `docs/SPRINT_4_DESIGN_REVIEW.md` §9 explicitly allows reusing
 * Obsidian's own numeric proportions as a starting default ("the
 * *proportions* are closer to universal than colors are") while leaving the
 * final per-mission values to design-brief-service.ts.
 */
export interface SpacingScale {
  steps: number[];
}

/** Mirrors the proportion discipline docs/09-UI-Design-System.md already holds Obsidian's own UI to (§4) — a default, not a constraint. */
export const DEFAULT_SPACING_SCALE: SpacingScale = {
  steps: [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8],
};

/** Minimum distinct steps a scale needs to express inline, component, and section spacing as genuinely different things (§4's card/component vs. section distinction). */
export const MIN_SPACING_SCALE_STEPS = 4;

export function validateSpacingScale(scale: SpacingScale): string[] {
  const errors: string[] = [];

  if (scale.steps.length < MIN_SPACING_SCALE_STEPS) {
    errors.push(
      `A spacing scale needs at least ${MIN_SPACING_SCALE_STEPS} steps to express inline, component, and section spacing as distinct scales (§4); got ${scale.steps.length}.`
    );
  }
  if (scale.steps.some((s) => s <= 0)) {
    errors.push("Every spacing scale step must be a positive value.");
  }
  const sorted = [...scale.steps].sort((a, b) => a - b);
  if (scale.steps.some((s, i) => s !== sorted[i])) {
    errors.push("Spacing scale steps must be listed in strictly ascending order.");
  }
  if (new Set(scale.steps).size !== scale.steps.length) {
    errors.push("Spacing scale must not contain duplicate steps — each step should be a distinct, purposeful value.");
  }

  return errors;
}
