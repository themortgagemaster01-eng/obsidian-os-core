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
  /** Per-number crawl provenance; optional for compatibility with older rows. */
  phoneEvidence?: PhoneEvidence[];
  emails: string[];
  /** Per-email crawl provenance (Phase 3.5), same shape and same purpose as phoneEvidence — optional for compatibility with older rows. */
  emailEvidence?: EmailEvidence[];
  address: string | null;
  /** How the address was captured (Phase 3.5) — "json-ld" (schema.org structured data) is strictly more reliable than "labeled" (a real "Address:"-labeled DOM element, still real but hand-authored/scraped). Optional for compatibility with older rows; absent means the address came from an older extraction pass this field predates. */
  addressSource?: "json-ld" | "labeled";
  hours: string | null;
  /**
   * Real, structured day-by-day hours (Phase 3.5) — parsed generically from
   * whatever raw `hours` string was captured (JSON-LD, a DOM hours widget,
   * or a labeled visible-text block), never a second, divergent extraction.
   * A day range in the source ("Wed-Sat 11:30am-8pm") expands into one
   * entry per real calendar day, all sharing the same real hours text —
   * never collapsed back into a single ambiguous range for display. Empty
   * when no real day-name boundary could be found in the raw hours text
   * (e.g. "9am-5pm daily" with no day names at all) — the raw `hours`
   * string above is still the honest fallback for that case.
   */
  hoursByDay?: HoursEntry[];
}

export interface PhoneEvidence {
  phone: string;
  normalized: string;
  sourceUrl: string;
  source: "tel-link" | "json-ld" | "visible-text";
}

export interface EmailEvidence {
  email: string;
  sourceUrl: string;
  source: "mailto-link" | "json-ld" | "visible-text";
}

export interface HoursEntry {
  /** Full canonical day name ("Monday", not "Mon"). */
  day: string;
  /** e.g. "5:00 PM – 11:00 PM" or "Closed" — real, normalized text, never a guessed time this business never published. */
  hours: string;
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

/**
 * One real menu/price-list entry (crawl-adapter.ts's findMenuItemsByStructure)
 * — a business's own real dish/service/item, its own real price when one was
 * published next to it, and its own real description when one was published
 * beneath it. `price` is kept as the verbatim string the site published
 * ("18.00", "$18.00") — never reformatted/computed, never invented when
 * absent. `confidence` is a real, mechanical corroboration signal (not a
 * model's guess): "high" when name+price+description were all structurally
 * present together, "medium" when only name+price were — never a case for
 * dropping the item, since a real name+price pair is already real evidence,
 * just thinner evidence than a full description gives.
 */
export interface MenuItem {
  name: string;
  description: string | null;
  price: string | null;
  sourceUrl: string;
  confidence: "high" | "medium";
}

/** A real category label (e.g. "Appetizers") the source page itself published immediately before a run of real menu items — "Menu" (MENU_FALLBACK_CATEGORY_NAME, crawl-adapter.ts) when no such label was structurally found, never an invented category name. */
export interface MenuCategory {
  name: string;
  items: MenuItem[];
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
  /** Real menu/price-list evidence (crawl-adapter.ts's findMenuItemsByStructure) — empty when this business's site genuinely has none, or when what exists isn't in a structurally-recognizable menu-item shape. Never fabricated to fill a business's "menu" section (§8). */
  menu: MenuCategory[];
  forms: FormInfo[];
  maps: MapEmbed[];
  fetchError?: string;
}

/**
 * normalizeCrawlRawResult — the read boundary for a CrawlRawResult coming
 * back from persisted storage (leads.crawl_result, website_analyses.
 * crawl_result), both jsonb columns with zero runtime shape enforcement.
 * The one real producer, lib/adapters/crawl-adapter.ts's runCrawlAdapter,
 * always returns every field (including its own fetch-failure branch) — but
 * an unchecked `as CrawlRawResult` cast on a jsonb read asserts that
 * guarantee without verifying it, and this codebase already has one
 * precedent for that guarantee not holding (ContactInfo's own
 * phoneEvidence/emailEvidence/addressSource/hoursByDay were added later and
 * marked optional specifically so an older, already-persisted row without
 * them wouldn't break). A lead created by any future path other than
 * runCrawlAdapter (bulk import, manual entry, a cheaper partial crawl tier)
 * would silently reintroduce the same class of crash. Every reader of a
 * persisted CrawlRawResult should call this once here rather than trust the
 * cast — mirrors runCrawlAdapter's own honest-empty-defaults discipline
 * (ADR-013: "every adapter must fail gracefully") for whatever field isn't
 * actually present, never fabricating real-looking data for it. Real,
 * present data is always preserved untouched; only gaps get defaulted.
 */
export function normalizeCrawlRawResult(raw: unknown): CrawlRawResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CrawlRawResult>;
  const contact = (r.contact && typeof r.contact === "object" ? r.contact : {}) as Partial<ContactInfo>;
  const socials = (r.socials && typeof r.socials === "object" ? r.socials : {}) as Partial<SocialLinks>;
  const reviews = (r.reviews && typeof r.reviews === "object" ? r.reviews : {}) as Partial<ReviewsSummary>;
  const headingCounts = (r.headingCounts && typeof r.headingCounts === "object" ? r.headingCounts : {}) as Partial<CrawlRawResult["headingCounts"]>;

  return {
    requestedUrl: r.requestedUrl ?? "",
    finalUrl: r.finalUrl ?? "",
    statusCode: r.statusCode ?? null,
    title: r.title ?? null,
    metaDescription: r.metaDescription ?? null,
    headingCounts: {
      h1: headingCounts.h1 ?? 0,
      h2: headingCounts.h2 ?? 0,
      h3: headingCounts.h3 ?? 0,
      h4: headingCounts.h4 ?? 0,
      h5: headingCounts.h5 ?? 0,
      h6: headingCounts.h6 ?? 0,
    },
    internalLinkCount: r.internalLinkCount ?? 0,
    externalLinkCount: r.externalLinkCount ?? 0,
    pages: r.pages ?? [],
    robotsTxtFound: r.robotsTxtFound ?? false,
    sitemapFound: r.sitemapFound ?? false,
    htmlByteSize: r.htmlByteSize ?? 0,
    contact: {
      phones: contact.phones ?? [],
      emails: contact.emails ?? [],
      address: contact.address ?? null,
      hours: contact.hours ?? null,
      // Optional provenance fields (added later than the rest of ContactInfo,
      // per its own doc comment: "optional for compatibility with older
      // rows") are omitted entirely when absent, not set to `undefined` —
      // an absent optional field and one explicitly present-but-undefined
      // are different things to a consumer doing `"phoneEvidence" in contact`
      // or a deepEqual comparison against a hand-built fixture.
      ...(contact.phoneEvidence !== undefined ? { phoneEvidence: contact.phoneEvidence } : {}),
      ...(contact.emailEvidence !== undefined ? { emailEvidence: contact.emailEvidence } : {}),
      ...(contact.addressSource !== undefined ? { addressSource: contact.addressSource } : {}),
      ...(contact.hoursByDay !== undefined ? { hoursByDay: contact.hoursByDay } : {}),
    },
    socials: {
      facebook: socials.facebook ?? null,
      instagram: socials.instagram ?? null,
      twitter: socials.twitter ?? null,
      linkedin: socials.linkedin ?? null,
      youtube: socials.youtube ?? null,
      tiktok: socials.tiktok ?? null,
      yelp: socials.yelp ?? null,
    },
    certifications: r.certifications ?? [],
    licenses: r.licenses ?? [],
    services: r.services ?? [],
    products: r.products ?? [],
    team: r.team ?? [],
    faq: r.faq ?? [],
    testimonials: r.testimonials ?? [],
    reviews: {
      averageRating: reviews.averageRating ?? null,
      count: reviews.count ?? null,
      source: reviews.source ?? null,
    },
    gallery: r.gallery ?? [],
    menu: r.menu ?? [],
    forms: r.forms ?? [],
    maps: r.maps ?? [],
    ...(r.fetchError !== undefined ? { fetchError: r.fetchError } : {}),
  };
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
