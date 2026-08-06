import type { WebsiteAnalysisRow } from "@/lib/repositories/website-analysis-repository";
import {
  normalizeMobileScore,
  mobileFindings,
  normalizeSeoScore,
  seoFindings,
  normalizeAccessibilityScore,
  accessibilityFindings,
} from "@/lib/services/analysis-service";
import type {
  CrawlRawResult,
  MobileRawResult,
  SeoRawResult,
  AccessibilityRawResult,
  LighthouseRawResult,
  TechDetectionRawResult,
} from "@/lib/adapters/types";

/**
 * The five v1 Opportunity Score categories (docs/SPRINT_3_DESIGN_REVIEW.md
 * §8), used as a shared vocabulary across insight-service.ts,
 * opportunity-scoring-service.ts, and opportunity-report-service.ts so the
 * three never drift into different naming for the same thing.
 */
export type AnalysisCategory =
  | "performance"
  | "accessibility"
  | "seo"
  | "mobile"
  | "technicalHealth";

/**
 * The Normalized Analysis layer (§3.2) as a plain, DB-agnostic shape:
 * every downstream Phase 2 service (insight-service, opportunity-scoring-
 * service, opportunity-report-service) depends on THIS type only — never
 * on WebsiteAnalysisRow, Supabase, or lib/adapters/ directly. That's what
 * keeps them independently testable with plain object fixtures.
 */
export interface NormalizedAnalysis {
  websiteUrl: string;
  seoScore: number;
  seoFindings: string[];
  mobileScore: number;
  mobileFindings: string[];
  accessibilityScore: number;
  accessibilityFindings: string[];
  technicalHealthScore: number;
  technicalHealthFindings: string[];
  lighthouse: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  technologyStack: string[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Technical Health normalization (§8: "Crawl Adapter + Tech Detection") —
 * new in Phase 2. Phase 1's analysis-service.ts persisted crawl_result and
 * tech_detection_result as raw JSON but never normalized them into a
 * score, because the five-category Opportunity Score didn't exist yet in
 * Phase 1's scope. That normalization has to live somewhere for
 * opportunity-scoring-service.ts to have all five categories available —
 * it lives here rather than in analysis-service.ts to keep Phase 2
 * additive-only (Phase 1 files untouched except the minor export change
 * noted in analysis-service.ts). Simple, explainable heuristic, matching
 * the "prefer simple over abstraction" guidance: no dimension here is
 * invented, every penalty traces to a concrete crawl/tech-detection
 * signal.
 */
export function computeTechnicalHealth(
  crawl: CrawlRawResult | null | undefined,
  tech: TechDetectionRawResult | null | undefined
): { score: number; findings: string[] } {
  if (!crawl || crawl.fetchError) {
    return {
      score: 0,
      findings: [
        crawl?.fetchError
          ? `Could not analyze the site's basic structure: ${crawl.fetchError}`
          : "Could not analyze the site's basic structure.",
      ],
    };
  }

  let score = 100;
  const findings: string[] = [];

  if (crawl.statusCode === null || crawl.statusCode < 200 || crawl.statusCode >= 300) {
    score -= 30;
    findings.push(`Homepage returned HTTP status ${crawl.statusCode ?? "unknown"} instead of a normal success response.`);
  }
  if (!crawl.robotsTxtFound) {
    score -= 10;
    findings.push("No robots.txt file found.");
  }
  if (!crawl.sitemapFound) {
    score -= 10;
    findings.push("No sitemap.xml file found.");
  }
  if (crawl.internalLinkCount === 0) {
    score -= 15;
    findings.push("No internal links found on the homepage.");
  }
  if (!tech || tech.fetchError || tech.technologies.length === 0) {
    score -= 5;
    findings.push("Could not confidently detect the site's underlying technology.");
  }

  return { score: clampScore(score), findings };
}

/**
 * Production path: builds NormalizedAnalysis from an already-persisted
 * `website_analyses` row (Phase 1's analysis-service.ts already computed
 * and stored mobile/seo/accessibility scores + findings and the four
 * Lighthouse category scores — this just reads them back out with
 * fallbacks for nulls). Technical Health is computed fresh from the row's
 * raw crawl_result/tech_detection_result columns, per computeTechnicalHealth
 * above.
 */
export function normalizedAnalysisFromRow(
  row: WebsiteAnalysisRow,
  websiteUrl: string
): NormalizedAnalysis {
  const crawl = (row.crawl_result as unknown as CrawlRawResult | null) ?? null;
  const tech = (row.tech_detection_result as unknown as TechDetectionRawResult | null) ?? null;
  const technicalHealth = computeTechnicalHealth(crawl, tech);

  return {
    websiteUrl,
    seoScore: row.seo_score ?? 0,
    seoFindings: (row.seo_findings as unknown as string[] | null) ?? [],
    mobileScore: row.mobile_score ?? 0,
    mobileFindings: (row.mobile_findings as unknown as string[] | null) ?? [],
    accessibilityScore: row.accessibility_score ?? 0,
    accessibilityFindings: (row.accessibility_findings as unknown as string[] | null) ?? [],
    technicalHealthScore: technicalHealth.score,
    technicalHealthFindings: technicalHealth.findings,
    lighthouse: {
      performance: row.lighthouse_performance,
      accessibility: row.lighthouse_accessibility,
      bestPractices: row.lighthouse_best_practices,
      seo: row.lighthouse_seo,
    },
    technologyStack: (row.technology_stack as unknown as string[] | null) ?? [],
  };
}

export interface RawAnalysisResults {
  crawl: CrawlRawResult;
  mobile: MobileRawResult;
  seo: SeoRawResult;
  accessibility: AccessibilityRawResult;
  lighthouse: LighthouseRawResult;
  techDetection: TechDetectionRawResult;
}

/**
 * Test/demo path: builds NormalizedAnalysis directly from raw adapter
 * output, with no database involved. Reuses Phase 1's exact
 * normalizeMobileScore/mobileFindings/normalizeSeoScore/seoFindings/
 * normalizeAccessibilityScore/accessibilityFindings (re-exported from
 * analysis-service.ts) rather than a second copy of that math, so a unit
 * test or demo run through this path is testing the same normalization
 * logic Phase 1 actually persists — not a parallel implementation that
 * could quietly drift from it.
 */
export function normalizedAnalysisFromRawResults(
  raw: RawAnalysisResults,
  websiteUrl: string
): NormalizedAnalysis {
  const technicalHealth = computeTechnicalHealth(raw.crawl, raw.techDetection);

  return {
    websiteUrl,
    seoScore: normalizeSeoScore(raw.seo),
    seoFindings: seoFindings(raw.seo),
    mobileScore: normalizeMobileScore(raw.mobile),
    mobileFindings: mobileFindings(raw.mobile),
    accessibilityScore: normalizeAccessibilityScore(raw.accessibility),
    accessibilityFindings: accessibilityFindings(raw.accessibility),
    technicalHealthScore: technicalHealth.score,
    technicalHealthFindings: technicalHealth.findings,
    lighthouse: { ...raw.lighthouse.scores },
    technologyStack: raw.techDetection.technologies.map((t) => t.name),
  };
}
