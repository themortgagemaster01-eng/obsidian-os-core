import * as cheerio from "cheerio";

import type {
  CrawlPage,
  CrawlRawResult,
  ContactInfo,
  SocialLinks,
  ContentSection,
  ReviewsSummary,
  GalleryImage,
  FormInfo,
  MapEmbed,
} from "@/lib/adapters/types";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_SAMPLE_PAGES = 5;
const USER_AGENT = "ObsidianOS-AnalysisBot/1.0 (+https://obsidianos.example/bot)";

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function headingCounts($: cheerio.CheerioAPI): CrawlRawResult["headingCounts"] {
  return {
    h1: $("h1").length,
    h2: $("h2").length,
    h3: $("h3").length,
    h4: $("h4").length,
    h5: $("h5").length,
    h6: $("h6").length,
  };
}

function emptyContact(): ContactInfo {
  return { phones: [], emails: [], address: null, hours: null };
}

function emptySocials(): SocialLinks {
  return { facebook: null, instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null };
}

function emptyReviews(): ReviewsSummary {
  return { averageRating: null, count: null, source: null };
}

/** Every structured-extraction field, defaulted empty — used both when the initial fetch fails and as the fallback if extraction itself throws unexpectedly (adapters must fail gracefully, ADR-013's consequence). */
function emptyStructuredFacts() {
  return {
    contact: emptyContact(),
    socials: emptySocials(),
    certifications: [] as ContentSection[],
    licenses: [] as ContentSection[],
    services: [] as ContentSection[],
    products: [] as ContentSection[],
    team: [] as ContentSection[],
    faq: [] as ContentSection[],
    testimonials: [] as ContentSection[],
    reviews: emptyReviews(),
    gallery: [] as GalleryImage[],
    forms: [] as FormInfo[],
    maps: [] as MapEmbed[],
  };
}

// ===========================================================================
// Structured extraction (docs/ARCHITECTURE_SPECIFICATION_V1.md's expanded
// crawler shape). Mechanical only: schema.org JSON-LD when present (the
// single most reliable source, since it's the site's own structured
// declaration of its business facts), DOM/regex heuristics otherwise. No
// interpretation, no scoring, no invented values — every field is either
// real extracted data or an honest empty/null default. Exported for direct
// unit testing against static HTML fixtures, independent of the network
// fetch (see crawl-adapter.test.ts).
// ===========================================================================

/** Loosely-typed schema.org LocalBusiness/Organization shape — sites vary widely in which fields they actually populate, so every access below is defensive. */
interface JsonLdEntity {
  telephone?: string;
  email?: string;
  address?: unknown;
  openingHours?: string | string[];
  openingHoursSpecification?: unknown;
  sameAs?: string | string[];
  aggregateRating?: { ratingValue?: string | number; reviewCount?: string | number };
  "@graph"?: unknown[];
}

function parseJsonLdEntities($: cheerio.CheerioAPI): JsonLdEntity[] {
  const entities: JsonLdEntity[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed: unknown = JSON.parse($(el).contents().text());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const entity = candidate as JsonLdEntity;
        entities.push(entity);
        if (Array.isArray(entity["@graph"])) {
          for (const graphNode of entity["@graph"]) {
            if (graphNode && typeof graphNode === "object") entities.push(graphNode as JsonLdEntity);
          }
        }
      }
    } catch {
      // Malformed JSON-LD block — skip it rather than fail the whole crawl.
    }
  });

  return entities;
}

function formatJsonLdAddress(address: unknown): string | null {
  if (typeof address === "string") return address.trim() || null;
  if (!address || typeof address !== "object") return null;
  const a = address as Record<string, unknown>;
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

const PHONE_REGEX = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAX_CONTACT_ITEMS = 5;

function extractContact($: cheerio.CheerioAPI, jsonLd: JsonLdEntity[]): ContactInfo {
  const bodyText = $("body").text();

  const phonesFromLinks = $('a[href^="tel:"]')
    .map((_, el) => $(el).attr("href")?.replace(/^tel:/, "").trim())
    .get()
    .filter((v): v is string => !!v);
  const phonesFromJsonLd = jsonLd.map((e) => e.telephone).filter((v): v is string => !!v);
  const phonesFromText = bodyText.match(PHONE_REGEX) ?? [];
  const phones = [...new Set([...phonesFromLinks, ...phonesFromJsonLd, ...phonesFromText])].slice(
    0,
    MAX_CONTACT_ITEMS
  );

  const emailsFromLinks = $('a[href^="mailto:"]')
    .map((_, el) => $(el).attr("href")?.replace(/^mailto:/, "").split("?")[0]?.trim())
    .get()
    .filter((v): v is string => !!v);
  const emailsFromJsonLd = jsonLd.map((e) => e.email).filter((v): v is string => !!v);
  const emailsFromText = bodyText.match(EMAIL_REGEX) ?? [];
  const emails = [...new Set([...emailsFromLinks, ...emailsFromJsonLd, ...emailsFromText])].slice(
    0,
    MAX_CONTACT_ITEMS
  );

  const address = jsonLd.map((e) => formatJsonLdAddress(e.address)).find((v): v is string => !!v) ?? null;

  const jsonLdHours = jsonLd.map((e) => e.openingHours).find((v) => v !== undefined);
  const hoursFromJsonLd = jsonLdHours
    ? Array.isArray(jsonLdHours)
      ? jsonLdHours.join("; ")
      : jsonLdHours
    : null;
  const hoursFromDom = $('[class*="hours" i], [id*="hours" i]').first().text().trim().replace(/\s+/g, " ").slice(0, 300) || null;
  const hours = hoursFromJsonLd ?? hoursFromDom;

  return { phones, emails, address, hours };
}

const SOCIAL_PATTERNS: { key: keyof SocialLinks; pattern: RegExp }[] = [
  { key: "facebook", pattern: /facebook\.com/i },
  { key: "instagram", pattern: /instagram\.com/i },
  { key: "twitter", pattern: /(twitter\.com|x\.com)/i },
  { key: "linkedin", pattern: /linkedin\.com/i },
  { key: "youtube", pattern: /youtube\.com/i },
  { key: "tiktok", pattern: /tiktok\.com/i },
  { key: "yelp", pattern: /yelp\.com/i },
];

function extractSocials($: cheerio.CheerioAPI, jsonLd: JsonLdEntity[]): SocialLinks {
  const hrefs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) hrefs.add(href);
  });
  for (const entity of jsonLd) {
    const sameAs = entity.sameAs;
    if (Array.isArray(sameAs)) sameAs.forEach((s) => typeof s === "string" && hrefs.add(s));
    else if (typeof sameAs === "string") hrefs.add(sameAs);
  }

  const result = emptySocials();
  for (const href of hrefs) {
    for (const { key, pattern } of SOCIAL_PATTERNS) {
      if (!result[key] && pattern.test(href)) result[key] = href;
    }
  }
  return result;
}

function extractReviews(jsonLd: JsonLdEntity[]): ReviewsSummary {
  for (const entity of jsonLd) {
    if (!entity.aggregateRating) continue;
    const rating = Number(entity.aggregateRating.ratingValue);
    const count = Number(entity.aggregateRating.reviewCount);
    return {
      averageRating: Number.isFinite(rating) ? rating : null,
      count: Number.isFinite(count) ? count : null,
      source: "schema.org structured data",
    };
  }
  return emptyReviews();
}

function extractForms($: cheerio.CheerioAPI): FormInfo[] {
  return $("form")
    .map((_, el): FormInfo => {
      const $form = $(el);
      const fields = $form.find("input, textarea, select");
      const hasEmailField =
        fields.filter('input[type="email"]').length > 0 || fields.filter('[name*="email" i]').length > 0;
      const hasPhoneField =
        fields.filter('input[type="tel"]').length > 0 || fields.filter('[name*="phone" i]').length > 0;
      return {
        action: $form.attr("action") ?? null,
        method: $form.attr("method")?.toLowerCase() ?? null,
        fieldCount: fields.length,
        hasEmailField,
        hasPhoneField,
      };
    })
    .get();
}

const MAX_MAP_EMBEDS = 5;

function extractMaps($: cheerio.CheerioAPI): MapEmbed[] {
  const maps: MapEmbed[] = [];
  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    if (/google\.[a-z.]+\/maps/i.test(src)) maps.push({ provider: "google", src });
    else if (/(openstreetmap|bing\.com\/maps)/i.test(src)) maps.push({ provider: "other", src });
  });
  return maps.slice(0, MAX_MAP_EMBEDS);
}

const MAX_GALLERY_IMAGES = 20;

function extractGallery($: cheerio.CheerioAPI): GalleryImage[] {
  const seen = new Set<string>();
  const images: GalleryImage[] = [];
  $('[class*="gallery" i] img, [id*="gallery" i] img').each((_, el) => {
    const src = $(el).attr("src");
    if (!src || seen.has(src)) return;
    seen.add(src);
    images.push({ src, alt: $(el).attr("alt") ?? null });
  });
  return images.slice(0, MAX_GALLERY_IMAGES);
}

const MAX_SECTIONS_PER_CATEGORY = 10;
const SECTION_EXCERPT_MAX_CHARS = 300;

/**
 * Best-effort structural detection for a content category: elements whose
 * class/id attribute contains one of the given keywords. This is a
 * deliberately narrow heuristic — a site using different markup
 * conventions will correctly produce an empty array rather than a guessed
 * result, per the honest-empty-default discipline this module follows
 * throughout. Excludes obvious navigation chrome (nav/header/footer) to
 * reduce false positives from generic keywords appearing in menu class
 * names.
 */
function findSectionsByKeywords($: cheerio.CheerioAPI, keywords: string[]): ContentSection[] {
  const selector = keywords.map((k) => `[class*="${k}" i], [id*="${k}" i]`).join(", ");
  const sections: ContentSection[] = [];
  const seen = new Set<string>();

  $(selector).each((_, el) => {
    if (sections.length >= MAX_SECTIONS_PER_CATEGORY) return;
    const $el = $(el);
    if ($el.closest("nav, header, footer").length > 0) return;

    const heading = $el.find("h1, h2, h3, h4").first().text().trim() || $el.attr("id") || keywords[0];
    const excerpt = $el.text().trim().replace(/\s+/g, " ").slice(0, SECTION_EXCERPT_MAX_CHARS);
    if (excerpt.length === 0) return;

    const dedupeKey = `${heading}:${excerpt.slice(0, 60)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    sections.push({ heading, excerpt });
  });

  return sections;
}

/** The full structured-facts extraction pass — pure, given an already-loaded page. */
export function extractStructuredFacts($: cheerio.CheerioAPI) {
  const jsonLd = parseJsonLdEntities($);

  return {
    contact: extractContact($, jsonLd),
    socials: extractSocials($, jsonLd),
    certifications: findSectionsByKeywords($, ["certif", "accredit"]),
    licenses: findSectionsByKeywords($, ["licens"]),
    services: findSectionsByKeywords($, ["service", "offering"]),
    products: findSectionsByKeywords($, ["product", "shop-item", "store-item"]),
    team: findSectionsByKeywords($, ["team", "staff"]),
    faq: findSectionsByKeywords($, ["faq", "accordion"]),
    testimonials: findSectionsByKeywords($, ["testimonial"]),
    reviews: extractReviews(jsonLd),
    gallery: extractGallery($),
    forms: extractForms($),
    maps: extractMaps($),
  };
}

/**
 * crawl-adapter — fetches the target URL and its immediate structure
 * (docs/SPRINT_3_DESIGN_REVIEW.md §1): the homepage itself, its links
 * (internal/external counts), a small bounded sample of same-domain pages,
 * and — per docs/ARCHITECTURE_SPECIFICATION_V1.md's expanded crawler shape —
 * structured business facts (contact info, socials, services, team, FAQ,
 * testimonials, reviews, gallery, forms, maps). This is deliberately NOT a
 * recursive site crawl — v1 needs "does this business have a real,
 * navigable site with real facts about itself," not a full sitemap.
 *
 * Pure function: no Supabase, no mission concept, just a URL in and a raw
 * result out — reusable by any future sprint that needs "go fetch this
 * site's structure" independent of the Analysis Engine. Structured
 * extraction is wrapped separately from the core fetch so a heuristic bug
 * in extractStructuredFacts can never crash the whole crawl (ADR-013's
 * "every adapter must fail gracefully" consequence) — it degrades to the
 * honest empty defaults instead.
 */
export async function runCrawlAdapter(targetUrl: string): Promise<CrawlRawResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(targetUrl);
  } catch (err) {
    return {
      requestedUrl: targetUrl,
      finalUrl: targetUrl,
      statusCode: null,
      title: null,
      metaDescription: null,
      headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      internalLinkCount: 0,
      externalLinkCount: 0,
      pages: [],
      robotsTxtFound: false,
      sitemapFound: false,
      htmlByteSize: 0,
      ...emptyStructuredFacts(),
      fetchError: err instanceof Error ? err.message : "Failed to fetch target URL",
    };
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const finalUrl = response.url || targetUrl;
  const origin = new URL(finalUrl).origin;

  const title = $("title").first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || null;

  const linkHrefs = new Set<string>();
  let internalLinkCount = 0;
  let externalLinkCount = 0;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }
    try {
      const resolved = new URL(href, finalUrl);
      if (resolved.origin === origin) {
        internalLinkCount += 1;
        linkHrefs.add(resolved.toString());
      } else {
        externalLinkCount += 1;
      }
    } catch {
      // Malformed href — ignore rather than fail the whole crawl.
    }
  });

  const sampleUrls = Array.from(linkHrefs)
    .filter((href) => href !== finalUrl)
    .slice(0, MAX_SAMPLE_PAGES);

  const pages: CrawlPage[] = await Promise.all(
    sampleUrls.map(async (pageUrl): Promise<CrawlPage> => {
      try {
        const pageResponse = await fetchWithTimeout(pageUrl);
        const pageHtml = await pageResponse.text();
        const pageTitle = cheerio.load(pageHtml)("title").first().text().trim() || null;
        return { url: pageUrl, statusCode: pageResponse.status, title: pageTitle };
      } catch (err) {
        return {
          url: pageUrl,
          statusCode: null,
          title: null,
          fetchError: err instanceof Error ? err.message : "Failed to fetch page",
        };
      }
    })
  );

  const [robotsCheck, sitemapCheck] = await Promise.all([
    fetchWithTimeout(new URL("/robots.txt", origin).toString()).catch(() => null),
    fetchWithTimeout(new URL("/sitemap.xml", origin).toString()).catch(() => null),
  ]);

  let structuredFacts;
  try {
    structuredFacts = extractStructuredFacts($);
  } catch {
    // A heuristic bug in structured extraction should never crash a crawl
    // that otherwise succeeded — degrade to honest empty defaults instead.
    structuredFacts = emptyStructuredFacts();
  }

  return {
    requestedUrl: targetUrl,
    finalUrl,
    statusCode: response.status,
    title,
    metaDescription,
    headingCounts: headingCounts($),
    internalLinkCount,
    externalLinkCount,
    pages,
    robotsTxtFound: robotsCheck?.ok ?? false,
    sitemapFound: sitemapCheck?.ok ?? false,
    htmlByteSize: Buffer.byteLength(html, "utf8"),
    ...structuredFacts,
  };
}
