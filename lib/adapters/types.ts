/**
 * Shared Raw Analysis types for lib/adapters/ (docs/SPRINT_3_DESIGN_REVIEW.md
 * §1, §3.1). Each adapter returns exactly what its underlying tool/library
 * produces, reshaped only enough to be a stable TS interface — the raw
 * layer is intentionally allowed to vary in shape from adapter to adapter,
 * since normalizing it into a consistent cross-adapter shape is
 * analysis-service.ts's job (§3.2), not the adapters'.
 *
 * Every adapter is a pure function: (input) => Promise<RawResult>. No
 * Supabase client, no mission/organization concept, no knowledge of
 * anything outside "given a URL (and occasionally a small callback), go
 * get this one kind of data." That's what keeps them independently
 * testable and reusable by future sprints per the CTO review.
 */

export interface CrawlPage {
  url: string;
  statusCode: number | null;
  title: string | null;
  fetchError?: string;
}

export interface CrawlRawResult {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number | null;
  title: string | null;
  metaDescription: string | null;
  headingCounts: Record<"h1" | "h2" | "h3" | "h4" | "h5" | "h6", number>;
  internalLinkCount: number;
  externalLinkCount: number;
  /** A small, bounded sample of same-domain pages also fetched (§1: "its immediate structure"). */
  pages: CrawlPage[];
  robotsTxtFound: boolean;
  sitemapFound: boolean;
  htmlByteSize: number;
  fetchError?: string;
}

export interface MobileRawResult {
  hasViewportMeta: boolean;
  viewportContent: string | null;
  usesUserScalableNo: boolean;
  mediaQueryCount: number;
  stylesheetsChecked: number;
  smallFontDeclarationCount: number;
  fetchError?: string;
}

export interface SeoRawResult {
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonicalUrl: string | null;
  h1Count: number;
  imageCount: number;
  imagesMissingAlt: number;
  structuredDataTypes: string[];
  openGraphTagCount: number;
  hasRobotsNoindex: boolean;
  fetchError?: string;
}

export interface AccessibilityViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  description: string;
  help: string;
  nodeCount: number;
}

export interface AccessibilityRawResult {
  violations: AccessibilityViolation[];
  passCount: number;
  incompleteCount: number;
  violationCountByImpact: Record<"minor" | "moderate" | "serious" | "critical", number>;
  fetchError?: string;
}

export interface LighthouseCategoryScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

export interface LighthouseRawResult {
  scores: LighthouseCategoryScores;
  /** Selected raw audits, keyed by Lighthouse audit id (e.g. "largest-contentful-paint"). */
  audits: Record<string, { title: string; numericValue?: number; displayValue?: string }>;
  fetchError?: string;
}

export interface DetectedTechnology {
  name: string;
  category: "cms" | "framework" | "ecommerce" | "hosting" | "analytics" | "other";
  confidence: "high" | "medium" | "low";
}

export interface TechDetectionRawResult {
  technologies: DetectedTechnology[];
  serverHeader: string | null;
  poweredByHeader: string | null;
  fetchError?: string;
}

export interface ScreenshotRawResult {
  fullPageUrl: string | null;
  aboveFoldUrl: string | null;
  capturedAt: string;
  fetchError?: string;
}
