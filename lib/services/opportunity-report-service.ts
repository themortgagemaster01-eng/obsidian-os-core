import type { AnalysisCategory, NormalizedAnalysis } from "@/lib/services/analysis-types";
import type { Insight, InsightSeverity } from "@/lib/services/insight-service";
import {
  scoreForCategory,
  type OpportunityScoreResult,
} from "@/lib/services/opportunity-scoring-service";

/**
 * The OpportunityReport object (docs/SPRINT_3_DESIGN_REVIEW.md §7),
 * assembled in the exact field set the design doc specifies. This service
 * does NOT analyze, score, or generate insights — it only arranges
 * already-computed NormalizedAnalysis + Insight[] + OpportunityScoreResult
 * into the shape §6's UI renders. No UI code lives here.
 */
export interface OpportunityReport {
  executiveSummary: string;
  businessOpportunity: {
    estimatedCustomerExperienceImpact: string;
    estimatedLocalSeoImpact: string;
    estimatedConversionImprovement: string;
    estimatedBrandModernization: string;
    potentialBusinessValue: string;
  };
  scores: {
    overall: number | null;
    performance: number | null;
    accessibility: number | null;
    seo: number | null;
    mobile: number | null;
    technicalHealth: number | null;
  };
  findings: {
    category: AnalysisCategory;
    score: number | null;
    statements: string[];
  }[];
  technologyStack: string[];
  evidence: { claim: string; source: string }[];
  recommendations: { title: string; detail: string; severity: InsightSeverity }[];
}

type ScoreBand = "good" | "moderate" | "poor" | "unknown";

function scoreBand(score: number | null): ScoreBand {
  if (score === null) return "unknown";
  if (score >= 90) return "good";
  if (score >= 70) return "moderate";
  return "poor";
}

function firstSentence(statement: string): string {
  const idx = statement.indexOf(". ");
  const sentence = idx === -1 ? statement : statement.slice(0, idx);
  return sentence.replace(/\.$/, "");
}

function decapitalize(value: string): string {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1);
}

function humanize(id: string): string {
  return id
    .split("-")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

function average(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

// ---------------------------------------------------------------------
// Executive summary (§6.2) — leads the report, narrative, not the score.
// ---------------------------------------------------------------------

const SUMMARY_OPENER: Record<ScoreBand, string> = {
  good: "This business's website is in solid shape overall, with only minor opportunities for improvement.",
  moderate:
    "This business's website has a decent foundation, but several issues are likely holding back the results it could be getting.",
  poor: "This business's website creates real barriers for potential customers, and is likely costing the business inquiries it would otherwise get.",
  unknown: "This analysis wasn't able to fully assess this business's website.",
};

function buildExecutiveSummary(overallScore: number | null, insights: Insight[]): string {
  const opener = SUMMARY_OPENER[scoreBand(overallScore)];
  const topIssues = insights
    .filter((i) => i.severity === "high")
    .slice(0, 2)
    .map((i) => decapitalize(firstSentence(i.statement)));

  if (topIssues.length === 0) return opener;
  if (topIssues.length === 1) return `${opener} In particular, ${topIssues[0]}.`;
  return `${opener} In particular, ${topIssues[0]}, and ${topIssues[1]}.`;
}

// ---------------------------------------------------------------------
// Business Opportunity (§6.3, §7) — five estimated-impact statements,
// framed as business value ("what changes for this business if they act
// on this"), derived from the same scores/insights already computed —
// nothing here is an independently invented fact.
// ---------------------------------------------------------------------

type ImpactLevel = "high" | "moderate" | "low" | "unknown";

function impactLevel(score: number | null): ImpactLevel {
  const band = scoreBand(score);
  if (band === "poor") return "high";
  if (band === "moderate") return "moderate";
  if (band === "good") return "low";
  return "unknown";
}

const EXPERIENCE_IMPACT: Record<ImpactLevel, string> = {
  high: "Visitors are likely running into real friction — slow loading and a rough mobile experience are common reasons people leave a site before ever reaching out. Closing these gaps would make a noticeable difference in how the site feels to use.",
  moderate:
    "The overall visitor experience is workable but has some rough edges around speed and mobile usability that are worth smoothing out.",
  low: "Visitors generally get a smooth, fast experience on this site already — this is a strength worth preserving.",
  unknown: "Visitor experience couldn't be fully assessed in this analysis.",
};

const SEO_IMPACT: Record<ImpactLevel, string> = {
  high: "The business is very likely missing out on customers who are actively searching for what it offers, simply because the site is hard for search engines to understand.",
  moderate:
    "There's meaningful room to capture more customers through search with some straightforward search-visibility fixes.",
  low: "The site is already well set up to be found through search — a strength worth maintaining as the business grows.",
  unknown: "Search visibility couldn't be fully assessed in this analysis.",
};

const CONVERSION_IMPACT: Record<ImpactLevel, string> = {
  high: "Usability issues across mobile and accessibility are likely causing visitors to drop off before taking action — fixing them could directly increase the number of visitors who turn into leads or customers.",
  moderate: "Some usability friction is likely costing a portion of visitors who would otherwise contact the business.",
  low: "Nothing in this analysis suggests usability is currently holding back conversions in a meaningful way.",
  unknown: "Conversion impact couldn't be fully assessed in this analysis.",
};

const BRAND_IMPACT: Record<ImpactLevel, string> = {
  high: "A slow, technically dated site can make an otherwise established, trustworthy business look less credible online than it is in person. Modernizing it is as much a brand investment as a technical one.",
  moderate: "The site is reasonably solid but has a few dated technical details that a modern redesign would naturally clean up.",
  low: "The site already comes across as modern and technically sound.",
  unknown: "Brand impact couldn't be fully assessed in this analysis.",
};

const VALUE_IMPACT: Record<ImpactLevel, string> = {
  high: "This is a strong opportunity: the gaps found are common, fixable, and the kind that directly affect whether visitors become customers.",
  moderate:
    "There's a solid, worthwhile opportunity here — the site works, but a focused round of improvements could meaningfully increase the results it generates.",
  low: "This site is already performing well; the opportunity here is incremental polish rather than a major overhaul.",
  unknown: "Overall business value couldn't be fully assessed in this analysis.",
};

function buildBusinessOpportunity(
  scoreResult: OpportunityScoreResult
): OpportunityReport["businessOpportunity"] {
  const performance = scoreForCategory(scoreResult, "performance");
  const mobile = scoreForCategory(scoreResult, "mobile");
  const seo = scoreForCategory(scoreResult, "seo");
  const accessibility = scoreForCategory(scoreResult, "accessibility");
  const technicalHealth = scoreForCategory(scoreResult, "technicalHealth");

  return {
    estimatedCustomerExperienceImpact: EXPERIENCE_IMPACT[impactLevel(average([performance, mobile]))],
    estimatedLocalSeoImpact: SEO_IMPACT[impactLevel(seo)],
    estimatedConversionImprovement:
      CONVERSION_IMPACT[impactLevel(average([mobile, accessibility, performance]))],
    estimatedBrandModernization: BRAND_IMPACT[impactLevel(average([performance, technicalHealth]))],
    potentialBusinessValue: VALUE_IMPACT[impactLevel(scoreResult.overallScore)],
  };
}

// ---------------------------------------------------------------------
// Findings, evidence, recommendations
// ---------------------------------------------------------------------

const CATEGORY_ORDER: AnalysisCategory[] = [
  "performance",
  "accessibility",
  "seo",
  "mobile",
  "technicalHealth",
];

function buildFindings(
  scoreResult: OpportunityScoreResult,
  insights: Insight[]
): OpportunityReport["findings"] {
  return CATEGORY_ORDER.map((category) => {
    const statements = insights.filter((i) => i.category === category).map((i) => i.statement);
    const score = scoreForCategory(scoreResult, category);
    // A null score means this category genuinely couldn't be measured
    // (§16 Open Question 5-adjacent territory) — that's a different,
    // more important thing to tell the reader than "nothing's wrong,"
    // and conflating the two was a real bug caught by the Phase 2
    // end-to-end demo (see docs/SPRINT_3_PHASE_2_REPORT.md).
    const emptyStatement =
      score === null
        ? "This area couldn't be fully measured in this analysis."
        : "No notable issues were found in this area.";
    return {
      category,
      score,
      statements: statements.length > 0 ? statements : [emptyStatement],
    };
  });
}

function buildEvidence(insights: Insight[]): OpportunityReport["evidence"] {
  return insights.map((i) => ({ claim: i.statement, source: i.source }));
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { high: 0, medium: 1, low: 2 };

function buildRecommendations(insights: Insight[]): OpportunityReport["recommendations"] {
  return [...insights]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .map((i) => ({ title: humanize(i.id), detail: i.statement, severity: i.severity }));
}

/**
 * assembleOpportunityReport — the single entry point this service
 * exposes. Presentation assembly only: takes already-computed
 * NormalizedAnalysis + Insight[] + OpportunityScoreResult and returns the
 * OpportunityReport object in the §7 field order. Does not fetch, does
 * not score, does not generate insights, does not know about Supabase or
 * React.
 */
export function assembleOpportunityReport(
  analysis: NormalizedAnalysis,
  insights: Insight[],
  scoreResult: OpportunityScoreResult
): OpportunityReport {
  return {
    executiveSummary: buildExecutiveSummary(scoreResult.overallScore, insights),
    businessOpportunity: buildBusinessOpportunity(scoreResult),
    scores: {
      overall: scoreResult.overallScore,
      performance: scoreForCategory(scoreResult, "performance"),
      accessibility: scoreForCategory(scoreResult, "accessibility"),
      seo: scoreForCategory(scoreResult, "seo"),
      mobile: scoreForCategory(scoreResult, "mobile"),
      technicalHealth: scoreForCategory(scoreResult, "technicalHealth"),
    },
    findings: buildFindings(scoreResult, insights),
    technologyStack: analysis.technologyStack,
    evidence: buildEvidence(insights),
    recommendations: buildRecommendations(insights),
  };
}
