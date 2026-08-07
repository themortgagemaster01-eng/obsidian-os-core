/**
 * The canonical Never Generate list (docs/DESIGN_INTELLIGENCE.md §11) as
 * structured, checkable data rather than doc prose only a generation prompt
 * might or might not honor. This is the founder-reviewed, final list — not
 * the earlier seven-entry "candidate, first draft" table in
 * docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md §6, which that
 * document itself says "should be treated as a first draft ... not a
 * finished spec." §11 superseded it with ten entries; this module encodes
 * §11 verbatim in id/statement/positive-alternative form.
 *
 * Per the research finding §11 itself cites, each entry is concrete and
 * named (not a vague "don't look generic") and paired with the positive
 * standard it protects, elsewhere in this rules layer.
 */

export interface NeverGenerateRule {
  id: string;
  /** What must never be generated, stated concretely enough to be checkable. */
  neverGenerate: string;
  /** The positive standard this rule protects, and what to do instead. */
  positiveAlternative: string;
}

export const NEVER_GENERATE_RULES: NeverGenerateRule[] = [
  {
    id: "generic-saas-hero",
    neverGenerate: "A generic SaaS hero layout (centered headline/subhead/two buttons) used without a content-driven reason.",
    positiveAlternative: "Section order and structure should follow the business's actual story (§5).",
  },
  {
    id: "cookie-cutter-feature-grid",
    neverGenerate: "Cookie-cutter feature grids — icon-plus-short-text cards used as a default filler pattern.",
    positiveAlternative: "Service/offering presentation should be shaped by the actual content, not a fixed grid reached for by default (§5, §9).",
  },
  {
    id: "decorative-gradient",
    neverGenerate: "Random or decorative gradients with no semantic role.",
    positiveAlternative: "Color choices should be deliberate and tied to the mission's chosen palette, not applied for visual interest alone (§2, §6 of docs/09-UI-Design-System.md's discipline, extended here).",
  },
  {
    id: "generic-ai-illustration",
    neverGenerate: 'Generic AI-style illustrations (the recognizable, interchangeable "AI stock art" look).',
    positiveAlternative: "Real photography of the business where available, or restrained, purposeful graphic treatment tied to the business's actual identity.",
  },
  {
    id: "emoji-as-icon",
    neverGenerate: "Emoji used as icons.",
    positiveAlternative: "Real iconography or none.",
  },
  {
    id: "weak-typography",
    neverGenerate: "Weak typography — no real hierarchy, arbitrary sizes, no considered pairing.",
    positiveAlternative: "§3's typography standard (see typography-rules.ts) is the positive standard.",
  },
  {
    id: "poor-spacing",
    neverGenerate: "Poor spacing — cramped, inconsistent, or copy-pasted spacing values with no underlying scale.",
    positiveAlternative: "§4's spacing standard (see design-rules.ts's SpacingScale) is the positive standard.",
  },
  {
    id: "repetitive-sections",
    neverGenerate: "Repetitive sections — the same visual pattern (a card row, an icon list) reused multiple times on one page out of habit rather than need.",
    positiveAlternative: "§5's editorial-composition standard — vary structure to match varying content, don't force every content type into the same visual container.",
  },
  {
    id: "template-looking-pages",
    neverGenerate: "Template-looking pages generally — output indistinguishable, structurally, from another mission's output for a different business in a different industry.",
    positiveAlternative: "If two generated sites for different businesses could have their content swapped without the structure needing to change, that's a violation of docs/VISION_GUARDRAILS.md's 'not a template marketplace' boundary, not a coincidence to shrug off.",
  },
  {
    id: "visual-clutter",
    neverGenerate: "Visual clutter — too many competing focal points, no clear resting point for the eye.",
    positiveAlternative: "§2, §4 — whitespace and hierarchy are what prevent this; clutter is what happens when they're skipped.",
  },
];

export function findNeverGenerateRule(id: string): NeverGenerateRule | undefined {
  return NEVER_GENERATE_RULES.find((rule) => rule.id === id);
}
