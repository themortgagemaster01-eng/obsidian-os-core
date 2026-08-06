import type { AnalysisCategory, NormalizedAnalysis } from "@/lib/services/analysis-types";

export interface CategoryScore {
  category: AnalysisCategory;
  /** null when this category couldn't be measured (see note below). */
  score: number | null;
  /** The weight actually used in the average, after renormalization for excluded categories. 0 if excluded. */
  weight: number;
}

export interface OpportunityScoreResult {
  /** null only when every category was unmeasured. */
  overallScore: number | null;
  categories: CategoryScore[];
  /** Categories excluded from the average because no measurement was available. */
  excludedCategories: AnalysisCategory[];
}

/**
 * v1 category weighting: EQUAL WEIGHTING (20% each across the five §8
 * categories: Performance, Accessibility, SEO, Mobile, Technical Health).
 * -----------------------------------------------------------------------
 * THIS IS A PLACEHOLDER, NOT A FINAL ANSWER. Open Question 1 in
 * docs/SPRINT_3_DESIGN_REVIEW.md v3 explicitly leaves category weighting
 * unresolved — nobody has specified how these five categories should be
 * weighted relative to each other for a real business, and equal weighting
 * is not based on any analysis of which category actually predicts
 * business impact. It's used here only because the pipeline needs
 * *something* concrete to compute end-to-end, per explicit instruction
 * that equal weighting is the default pending a real founder decision.
 * Revisit this constant the moment that decision is made.
 */
export const EQUAL_CATEGORY_WEIGHT = 1 / 5;

/**
 * computeOpportunityScore — deterministic v1 scoring, no AI reasoning, no
 * measurements invented beyond what's in NormalizedAnalysis (docs/
 * SPRINT_3_DESIGN_REVIEW.md §8). Pure function: NormalizedAnalysis in,
 * OpportunityScoreResult out. No knowledge of adapters, HTTP, or the
 * database — only the normalized shape.
 *
 * Per §8's table, Accessibility's source is "Accessibility Adapter +
 * Lighthouse" — the only category blended from two normalized signals
 * (a plain unweighted average of the two when both are available). Every
 * other category maps to exactly one normalized field.
 *
 * A category with no measurement available (e.g. the underlying check
 * failed outright) is EXCLUDED from the average rather than scored as 0,
 * and the remaining categories' weights are renormalized so they still
 * sum to 1. This exclusion behavior is itself an undocumented-in-the-
 * design-doc scoring decision — flagged here for visibility rather than
 * silently baked in.
 *
 * In practice, only Performance can trigger this today: Phase 1's
 * mobile/seo/accessibility normalizers already collapse a total adapter
 * failure to a score of 0 rather than null (see the Phase 2 report for
 * why that inconsistency with Performance wasn't fixed here), and
 * Accessibility's blend (below) always has accessibilityScore — a real
 * number, never null by type — as one of its two inputs, so the blend
 * itself can never resolve to null even when the Lighthouse half is
 * unavailable. Confirmed by opportunity-scoring-service.test.ts.
 */
export function computeOpportunityScore(analysis: NormalizedAnalysis): OpportunityScoreResult {
  const raw: { category: AnalysisCategory; score: number | null }[] = [
    { category: "performance", score: analysis.lighthouse.performance },
    { category: "accessibility", score: blendAccessibility(analysis) },
    { category: "seo", score: analysis.seoScore },
    { category: "mobile", score: analysis.mobileScore },
    { category: "technicalHealth", score: analysis.technicalHealthScore },
  ];

  const available = raw.filter((c) => c.score !== null);
  const excludedCategories = raw.filter((c) => c.score === null).map((c) => c.category);

  if (available.length === 0) {
    return {
      overallScore: null,
      categories: raw.map((c) => ({ ...c, weight: 0 })),
      excludedCategories,
    };
  }

  const perCategoryWeight = 1 / available.length;

  const categories: CategoryScore[] = raw.map((c) => ({
    ...c,
    weight: c.score !== null ? perCategoryWeight : 0,
  }));

  const overallScore = Math.round(
    available.reduce((sum, c) => sum + (c.score as number) * perCategoryWeight, 0)
  );

  return { overallScore, categories, excludedCategories };
}

function blendAccessibility(analysis: NormalizedAnalysis): number | null {
  const scores = [analysis.accessibilityScore, analysis.lighthouse.accessibility].filter(
    (s): s is number => s !== null
  );
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

/** Convenience lookup — the category scorecards (§6.5) want a category's score by name. */
export function scoreForCategory(
  result: OpportunityScoreResult,
  category: AnalysisCategory
): number | null {
  return result.categories.find((c) => c.category === category)?.score ?? null;
}
