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

/**
 * docs/ARCHITECTURE_SPECIFICATION_V1.md's expanded crawler shape — real,
 * structured business facts the Analysis Engine gathers so downstream
 * engines (Design Intelligence, Generation) never have to guess or
 * fabricate contact/trust content (docs/DESIGN_INTELLIGENCE.md §8's
 * zero-fabrication rule). Extraction is mechanical (schema.org JSON-LD when
 * present, DOM/regex heuristics otherwise) — no interpretation, no scoring,
 * matching this adapter's I/O-only charter. An empty array or null field
 * means "not detected by this heuristic," never "confirmed absent" — see
 * lib/adapters/crawl-adapter.ts's doc comments for each field's specific
 * detection method and honest limitations.
 */
export interface ContactInfo {
  phones: string[];
  emails: string[];
  address: string | null;
  hours: string | null;
}

export interface SocialLinks {
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
  linkedin: string | null;
  youtube: string | null;
  tiktok: string | null;
  yelp: string | null;
}

/**
 * A best-effort structural match for a content category (services, team,
 * FAQ, etc.) — the heading that identified it plus a bounded text excerpt,
 * never invented copy. `sourceUrl` is the exact page this was extracted
 * from (the homepage or one of the crawler's already-fetched sub-pages,
 * `pages[]`) — every extracted claim stays traceable to where it actually
 * came from, never merged into an unattributed blob.
 */
export interface ContentSection {
  heading: string;
  excerpt: string;
  sourceUrl: string;
}

/** The non-fabricated fallback ContentSection.heading a testimonial gets when no real name/attribution is structurally present next to its quote (crawl-adapter.ts's findTestimonialsByStructure) — shared so a consumer can tell "no real attribution" apart from an actual captured name without duplicating the literal string. */
export const GENERIC_TESTIMONIAL_HEADING = "Testimonial";

export interface ReviewsSummary {
  averageRating: number | null;
  count: number | null;
  /** Where this came from, e.g. "schema.org structured data" — null when nothing was found, never a guessed figure. */
  source: string | null;
}

export interface GalleryImage {
  src: string;
  alt: string | null;
  /** The exact page (homepage or a crawled sub-page) this image reference was found on. */
  sourceUrl: string;
}

export interface FormInfo {
  action: string | null;
  method: string | null;
  fieldCount: number;
  hasEmailField: boolean;
  hasPhoneField: boolean;
}

export interface MapEmbed {
  provider: "google" | "other";
  src: string;
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
  contact: ContactInfo;
  socials: SocialLinks;
  certifications: ContentSection[];
  licenses: ContentSection[];
  services: ContentSection[];
  products: ContentSection[];
  team: ContentSection[];
  faq: ContentSection[];
  testimonials: ContentSection[];
  reviews: ReviewsSummary;
  gallery: GalleryImage[];
  forms: FormInfo[];
  maps: MapEmbed[];
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
