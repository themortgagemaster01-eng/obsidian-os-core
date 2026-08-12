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
import { GENERIC_TESTIMONIAL_HEADING } from "@/lib/adapters/types";

const FETCH_TIMEOUT_MS = 15_000;
/**
 * Was 5. A real site with several distinct evidence-bearing pages (team,
 * testimonials, FAQ, and multiple practice-area/service pages) can list
 * more than 5 links before the budget-worth of "most useful" pages in nav
 * order — confirmed on a real law firm site during the Evidence Depth
 * investigation, where a 5-page budget left no room for any practice-area
 * page once team/testimonials/about/news pages filled it. Still bounded and
 * still fetched in parallel (Promise.all below), so wall-clock cost is
 * governed by the slowest single page, not the count; prioritizeSampleUrls
 * also means most sites see no extra fetches at all beyond what they'd
 * already have filled with real evidence-bearing pages.
 */
const MAX_SAMPLE_PAGES = 8;
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

// ===========================================================================
// Visible-text signals (Crawler Extraction Heuristic Review, signal 1):
// hours/address extraction that reads what a label element's own TEXT says,
// not just its class/id attribute. `[class*="hours" i]` only ever matches a
// page builder that happens to name its CSS classes "hours" — a page whose
// markup is generic (Wix rich-text, plain <p>/<h2> tags) but whose visible
// copy literally says "Hours of operation:" was previously invisible to
// this extractor. This adds that as a second, independent source, still
// no interpretation: either a real label is present and its real value is
// read off, or nothing is returned.
// ===========================================================================

const LABELED_VALUE_MAX_CHARS = 300;
/** How many following siblings to gather after a label-only element (e.g. a lone "Hours of operation:" heading followed by one sibling per day) before giving up. */
const LABEL_SIBLING_LOOKAHEAD = 8;

/**
 * Finds the first element whose own flattened text is a real label (matches
 * `labelWithColon` with non-empty remainder, e.g. "Address: 123 Main St") or
 * is nothing but the label itself (matches `labelOnly`, e.g. "Hours of
 * operation:") — in which case its value is gathered from however many of
 * its following siblings keep matching `siblingContinues`, giving up after
 * `LABEL_SIBLING_LOOKAHEAD` or the first non-matching sibling. `valuePlausible`
 * is a last structural gate on the extracted value itself (e.g. "must contain
 * a digit") so a label match alone never stands in for real evidence — see
 * each call site below for why that gate is shaped the way it is.
 */
function extractLabeledValue(
  $: cheerio.CheerioAPI,
  labelWithColon: RegExp,
  labelOnly: RegExp,
  valuePlausible: (value: string) => boolean,
  siblingContinues?: (siblingText: string) => boolean
): string | null {
  const candidates = $("h1, h2, h3, h4, h5, h6, p, dt, dd, li, span, div").toArray();

  for (const el of candidates) {
    const $el = $(el);
    // Unlike findSectionsByKeywords, footer is NOT excluded here: contact
    // info (hours/address) is one of the most common legitimate uses of a
    // footer landmark on small business sites (confirmed on Veslo's own
    // real contact page — its entire "Hours of operation" widget lives in
    // a <footer>). The label-match + valuePlausible gates below already do
    // the work a footer-quality check would, so nav/header/script/style
    // stay hard-excluded but footer does not.
    if ($el.closest("nav, header, script, style").length > 0) continue;

    const text = $el.text().trim().replace(/\s+/g, " ");
    if (text.length === 0 || text.length > LABELED_VALUE_MAX_CHARS) continue;

    const withColon = text.match(labelWithColon);
    if (withColon) {
      const remainder = text.slice(withColon[0].length).trim();
      if (remainder.length > 0) {
        if (valuePlausible(remainder)) return remainder.slice(0, LABELED_VALUE_MAX_CHARS);
        continue; // labeled, but what follows isn't a plausible value — not label-only either, so nothing more to try here
      }
      // Label matched with nothing after the colon (e.g. "Hours of operation:") —
      // structurally identical to a label-only match, so fall through to the
      // same sibling-gather below rather than giving up on this element.
    } else if (!labelOnly.test(text)) {
      continue;
    }

    let combined = "";
    let sib = $el.next();
    let count = 0;
    while (sib.length > 0 && count < LABEL_SIBLING_LOOKAHEAD && combined.length < LABELED_VALUE_MAX_CHARS) {
      const sibText = sib.text().trim().replace(/\s+/g, " ");
      if (sibText) {
        if (siblingContinues && !siblingContinues(sibText)) break;
        combined += (combined ? " " : "") + sibText;
      }
      sib = sib.next();
      count++;
    }
    if (combined.length > 0 && valuePlausible(combined)) {
      return combined.slice(0, LABELED_VALUE_MAX_CHARS);
    }
  }

  return null;
}

const HOURS_LABEL_WITH_COLON = /^(hours(\s+of\s+operation)?|business\s+hours|store\s+hours)\s*:\s*/i;
const HOURS_LABEL_ONLY = /^(hours(\s+of\s+operation)?|business\s+hours|store\s+hours)\s*:?\s*$/i;
/** A plausible hours *value* names a day, says "closed"/"daily"/"24/7"/"by appointment", or gives a clock time — never just any text that happened to follow the word "Hours" (guards the "Hours: please call ahead for details" false-positive case: "please call ahead" itself isn't hours data). */
const HOURS_VALUE_PLAUSIBLE = /\b(mon|tue|wed|thu|fri|sat|sun|closed|daily|24\/7|by\s+appointment)\b|\d{1,2}(:\d{2})?\s*(am|pm)/i;

/** Explicit day-name forms (not a bare 3-letter-prefix + wildcard) — a prefix+wildcard match like `\bfri[a-z]*\b` would just as happily consume "Friendly" or "Friend" as "Friday"/"Fri", which real copy ("Family-Friendly Convenience... Hours 7am-7pm") actually contains right next to real time text. Spelling out every real form keeps the day-name match exact. */
const DAY_NAME = "(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:s|nesday)?|Thu(?:r|rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)";
/** No label at all, last resort: a day name followed within a short window by a clock time or "closed" — e.g. an hours table with no heading whatsoever. Deliberately bounded to a single day+time pairing per match so it can't sprawl into unrelated surrounding prose. */
const HOURS_PATTERN_NO_LABEL = new RegExp(
  `\\b${DAY_NAME}\\b[^.\\n]{0,40}?(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|closed)`,
  "i"
);

function extractHours($: cheerio.CheerioAPI, hoursFromJsonLd: string | null): string | null {
  if (hoursFromJsonLd) return hoursFromJsonLd;

  const hoursFromDom =
    $('[class*="hours" i], [id*="hours" i]').first().text().trim().replace(/\s+/g, " ").slice(0, 300) || null;
  if (hoursFromDom) return hoursFromDom;

  const hoursFromLabel = extractLabeledValue(
    $,
    HOURS_LABEL_WITH_COLON,
    HOURS_LABEL_ONLY,
    (value) => HOURS_VALUE_PLAUSIBLE.test(value),
    (siblingText) => HOURS_VALUE_PLAUSIBLE.test(siblingText)
  );
  if (hoursFromLabel) return hoursFromLabel;

  const bodyText = $("body").text().replace(/\s+/g, " ");
  const noLabelMatch = bodyText.match(HOURS_PATTERN_NO_LABEL);
  return noLabelMatch ? noLabelMatch[0].trim().slice(0, 300) : null;
}

const ADDRESS_LABEL_WITH_COLON = /^(address|location)\s*:\s*/i;
const ADDRESS_LABEL_ONLY = /^(address|location)\s*:?\s*$/i;
/** A plausible address *value* starts with a number, per the overwhelming convention of street addresses ("100 Arnold Street...", "3027 Blue Ridge Road...") — guards the "Address these three points before..." false-positive case, where "address" is a verb, not a label. */
const ADDRESS_VALUE_PLAUSIBLE = /^\d/;

function extractAddress($: cheerio.CheerioAPI, addressFromJsonLd: string | null): string | null {
  if (addressFromJsonLd) return addressFromJsonLd;
  return extractLabeledValue($, ADDRESS_LABEL_WITH_COLON, ADDRESS_LABEL_ONLY, (value) =>
    ADDRESS_VALUE_PLAUSIBLE.test(value)
  );
}

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

  const addressFromJsonLd = jsonLd.map((e) => formatJsonLdAddress(e.address)).find((v): v is string => !!v) ?? null;
  const address = extractAddress($, addressFromJsonLd);

  const jsonLdHours = jsonLd.map((e) => e.openingHours).find((v) => v !== undefined);
  const hoursFromJsonLd = jsonLdHours
    ? Array.isArray(jsonLdHours)
      ? jsonLdHours.join("; ")
      : jsonLdHours
    : null;
  const hours = extractHours($, hoursFromJsonLd);

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

function extractGallery($: cheerio.CheerioAPI, sourceUrl: string): GalleryImage[] {
  const seen = new Set<string>();
  const images: GalleryImage[] = [];
  $('[class*="gallery" i] img, [id*="gallery" i] img').each((_, el) => {
    const src = $(el).attr("src");
    if (!src || seen.has(src)) return;
    seen.add(src);
    images.push({ src, alt: $(el).attr("alt") ?? null, sourceUrl });
  });
  return images.slice(0, MAX_GALLERY_IMAGES);
}

const MAX_SECTIONS_PER_CATEGORY = 10;
const SECTION_EXCERPT_MAX_CHARS = 300;

// ===========================================================================
// Footer quality scoring (Crawler Extraction Heuristic Review, signal 4).
// nav/header stay hard-excluded — they're reliably pure navigation chrome.
// footer is different: it's often boilerplate (copyright, legal links,
// social icons) but small real-business sites also legitimately put a real
// services/location list nowhere else but the footer. A blanket exclusion
// discarded both; this scores footer candidates instead of discarding them
// outright, on structural properties (item length, link targets) rather
// than on anything site-specific.
// ===========================================================================

const FOOTER_BOILERPLATE_TEXT_PATTERN =
  /©|all rights reserved|privacy policy|terms (of service|and conditions)|cookie policy/i;
/** Reuses the same social-domain patterns extractSocials already matches against, plus common legal-page paths — a footer link list dominated by these is almost certainly nav/legal boilerplate, not business content. */
const FOOTER_BOILERPLATE_HREF_PATTERN =
  /(facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|yelp)\.com|\/(privacy|terms|cookie)/i;
/** Real service/offering list items ("Children's Dental Care", "Lawn Cleanup Services") run well above this; generic nav links ("Home", "About", "Contact") run well below it. */
const FOOTER_MIN_AVG_ITEM_CHARS = 12;

function footerCandidatePassesQualityBar($: cheerio.CheerioAPI, $el: ReturnType<cheerio.CheerioAPI>): boolean {
  const text = $el.text().trim().replace(/\s+/g, " ");
  if (FOOTER_BOILERPLATE_TEXT_PATTERN.test(text)) return false;

  const hrefs = $el
    .find("a[href]")
    .toArray()
    .map((a) => $(a).attr("href") ?? "");
  if (hrefs.length > 0) {
    const boilerplateHrefCount = hrefs.filter((h) => FOOTER_BOILERPLATE_HREF_PATTERN.test(h)).length;
    if (boilerplateHrefCount / hrefs.length > 0.5) return false;
  }

  const items = $el
    .find("li, a")
    .toArray()
    .map((el) => $(el).text().trim())
    .filter((t) => t.length > 0);
  if (items.length === 0) {
    // Not a list — a real (non-boilerplate) block of substantial text is
    // still plausible business content; a trivial one-word fragment isn't.
    return text.length >= FOOTER_MIN_AVG_ITEM_CHARS * 2;
  }
  const avgItemChars = items.reduce((sum, t) => sum + t.length, 0) / items.length;
  return avgItemChars >= FOOTER_MIN_AVG_ITEM_CHARS;
}

/**
 * Best-effort structural detection for a content category: elements whose
 * class/id attribute contains one of the given keywords. This is a
 * deliberately narrow heuristic — a site using different markup
 * conventions will correctly produce an empty array rather than a guessed
 * result, per the honest-empty-default discipline this module follows
 * throughout. Excludes obvious navigation chrome (nav/header — always pure
 * boilerplate); footer content is scored rather than blanket-excluded (see
 * footerCandidatePassesQualityBar above) since it sometimes carries real
 * business content a small site has nowhere else to put.
 */
function findSectionsByKeywords($: cheerio.CheerioAPI, keywords: string[], sourceUrl: string): ContentSection[] {
  const selector = keywords.map((k) => `[class*="${k}" i], [id*="${k}" i]`).join(", ");
  const sections: ContentSection[] = [];
  const seen = new Set<string>();

  $(selector).each((_, el) => {
    if (sections.length >= MAX_SECTIONS_PER_CATEGORY) return;
    const $el = $(el);
    if ($el.closest("nav, header").length > 0) return;
    if ($el.closest("footer").length > 0 && !footerCandidatePassesQualityBar($, $el)) return;
    // A nested element whose own ancestor already matches the same
    // class/id keyword is the same real content re-matched twice (e.g. an
    // accordion item's inner "question" div nested inside its own outer
    // "faq-item" wrapper, both keyword-matchable) — keep only the outermost
    // container per branch, since document order guarantees the ancestor
    // was already visited and captured the fuller content.
    if ($el.parents(selector).length > 0) return;

    const heading =
      $el.find("h1, h2, h3, h4").first().text().trim().replace(/\s+/g, " ") || $el.attr("id") || keywords[0];
    const excerpt = $el.text().trim().replace(/\s+/g, " ").slice(0, SECTION_EXCERPT_MAX_CHARS);
    if (excerpt.length === 0) return;
    // A section whose excerpt is nothing but its own heading repeated is a
    // page-banner/title element, not real described content — confirmed real
    // false positive during the Evidence Depth investigation: a page-builder
    // theme's generic sub-page title banner used a class literally named
    // "servicetitle" site-wide (a decorative styling hook, unrelated to an
    // actual services listing), so every sampled sub-page produced a bogus
    // "services" entry whose heading and excerpt were both just that page's
    // own title ("OUR TEAM", "TESTIMONIALS"...). A real section always has
    // body content beyond repeating its own heading.
    if (excerpt === heading) return;

    const dedupeKey = `${heading}:${excerpt.slice(0, 60)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    sections.push({ heading, excerpt, sourceUrl });
  });

  return sections;
}

// ===========================================================================
// Page URL/title classification (Crawler Extraction Heuristic Review,
// signal 2). A sampled sub-page's own URL path and <title> already say what
// it's about in plain English ("/testimonials/", "Testimonials — Business
// Name") — independent of whatever CSS classes its theme/plugin happens to
// use internally, and far more stable across sites than class naming. This
// is the SAME category vocabulary findSectionsByKeywords already uses for
// CSS-class matching, just checked against a second surface. A match here
// is a signal that this page is likely about that category — it only ever
// triggers a bounded, still-structural fallback below, never a blanket
// "trust everything on this page."
// ===========================================================================

type PageFallbackCategory = "certifications" | "licenses" | "services" | "products" | "team" | "faq";

const CATEGORY_URL_TITLE_WORDS: Record<PageFallbackCategory, string[]> = {
  certifications: ["certification", "certifications", "accreditation", "accreditations"],
  licenses: ["license", "licenses", "licensing"],
  services: ["service", "services", "offering", "offerings"],
  products: ["product", "products"],
  team: ["team", "staff"],
  faq: ["faq", "faqs"],
};

function pageWords(sourceUrl: string, pageTitle: string): Set<string> {
  let path = "";
  try {
    path = new URL(sourceUrl).pathname;
  } catch {
    path = sourceUrl;
  }
  return new Set(`${path} ${pageTitle}`.toLowerCase().split(/[^a-z]+/).filter(Boolean));
}

function classifyPageByUrlAndTitle(sourceUrl: string, pageTitle: string): PageFallbackCategory[] {
  const words = pageWords(sourceUrl, pageTitle);
  return (Object.keys(CATEGORY_URL_TITLE_WORDS) as PageFallbackCategory[]).filter((category) =>
    CATEGORY_URL_TITLE_WORDS[category].some((label) => words.has(label))
  );
}

// ===========================================================================
// Sub-page sampling prioritization (Evidence Depth investigation, Friedman
// Grimes). The crawler can only afford to fetch a bounded number of
// same-domain pages, and used to take whichever links happened to appear
// first in homepage DOM order — real for a site whose nav lists its most
// content-rich pages first, but a real, generalizable gap for any site
// whose nav lists several evidence-bearing pages (team, testimonials, FAQ,
// certifications...) alongside many more links than the budget allows: the
// budget could fill on nav order alone before reaching a distinct category
// at all. This ranks discovered links by the SAME category vocabulary
// classifyPageByUrlAndTitle already uses (plus "testimonials", which that
// function deliberately excludes for post-fetch content classification but
// which is still a legitimate reason to prioritize FETCHING a page), then
// fills any remaining budget in original discovery order — so a site with
// no recognizable categories in its nav sees no behavior change at all.
// ===========================================================================

type LinkPriorityCategory = PageFallbackCategory | "testimonials";

const LINK_PRIORITY_WORDS: Record<LinkPriorityCategory, string[]> = {
  ...CATEGORY_URL_TITLE_WORDS,
  testimonials: ["testimonial", "testimonials", "review", "reviews"],
};

/** Fixed evaluation order, not a ranking of importance — every matched category still gets one slot each before any leftover budget fills by discovery order. */
const LINK_PRIORITY_ORDER: LinkPriorityCategory[] = [
  "team",
  "testimonials",
  "faq",
  "certifications",
  "licenses",
  "services",
  "products",
];

function classifyLinkByUrlAndText(url: string, linkText: string): LinkPriorityCategory[] {
  const words = pageWords(url, linkText);
  return LINK_PRIORITY_ORDER.filter((category) => LINK_PRIORITY_WORDS[category].some((label) => words.has(label)));
}

/**
 * Picks up to `max` URLs from `links` (already deduped, in original
 * discovery order): one representative link per recognizable category
 * first (a page's own URL path or its anchor text naming that category —
 * e.g. a "/testimonials/" link or link text "Our Team"), then fills any
 * remaining budget with the earliest not-yet-selected links in their
 * original order. Exported for direct unit testing independent of the
 * network fetch, same precedent as extractStructuredFacts.
 */
export function prioritizeSampleUrls(links: { url: string; text: string }[], max: number): string[] {
  const selected: string[] = [];
  const selectedUrls = new Set<string>();

  for (const category of LINK_PRIORITY_ORDER) {
    if (selected.length >= max) break;
    const match = links.find(
      (link) => !selectedUrls.has(link.url) && classifyLinkByUrlAndText(link.url, link.text).includes(category)
    );
    if (match) {
      selected.push(match.url);
      selectedUrls.add(match.url);
    }
  }

  for (const link of links) {
    if (selected.length >= max) break;
    if (!selectedUrls.has(link.url)) {
      selected.push(link.url);
      selectedUrls.add(link.url);
    }
  }

  return selected;
}

/**
 * A page already classified (by URL/title, above) as being about a category
 * — real business content, just not sitting in a CSS-class-matchable
 * container. Prefers a `<main>`/`<article>` region when the page marks one,
 * else the whole body with nav/header/footer/script/style stripped. Still a
 * real, bounded excerpt of the page's own real text — never a generated
 * summary or invented content.
 */
function extractMainPageContent($: cheerio.CheerioAPI): string {
  const $body = $("body").clone();
  $body.find("nav, header, footer, script, style").remove();
  const main = $body.find("main, article").first();
  const text = (main.length > 0 ? main.text() : $body.text()).trim().replace(/\s+/g, " ");
  return text.slice(0, SECTION_EXCERPT_MAX_CHARS);
}

// ===========================================================================
// Testimonial structure detection (Crawler Extraction Heuristic Review,
// signal 3). Real customer testimonials have a recognizable SHAPE — verbatim
// text wrapped in quotation marks, usually paired with a short name and/or a
// dash-attribution line — regardless of what CSS class (if any, and however
// named) a theme wraps them in. This never requires the word "testimonial"
// anywhere in the markup. It also never invents an attribution: when no
// name/attribution is structurally present next to the quote, the heading
// falls back to the same kind of generic category label findSectionsByKeywords
// already uses when it has nothing better — never a fabricated person.
// ===========================================================================

const QUOTE_WRAPPED_PATTERN = /^["'“‘]([\s\S]+)["'”’]$/;
const MIN_QUOTE_CHARS = 20;
const MAX_QUOTE_CHARS = 600;
/** A short dash-led line right after a quote — "– Estate Planning Client", "- Kim" — is a real attribution the site itself published, not an invented one; this only ever reads it, never writes it. */
const ATTRIBUTION_PATTERN = /^[-–—]\s*(.{1,80})$/;
/** A short line of 1-4 capitalized words right before a quote plausibly names who said it (e.g. "Carolyn M. Grimes") — a coarse but bounded structural check, not a claim of certainty. */
const NAME_LIKE_PATTERN = /^[A-Z][\w.'-]*(\s+[A-Z][\w.'-]*){0,3}$/;

function findTestimonialsByStructure($: cheerio.CheerioAPI, sourceUrl: string): ContentSection[] {
  const sections: ContentSection[] = [];
  const seen = new Set<string>();

  $("p, blockquote, li, div, span").each((_, el) => {
    if (sections.length >= MAX_SECTIONS_PER_CATEGORY) return;
    const $el = $(el);
    if ($el.closest("nav, header, script, style").length > 0) return;
    if ($el.children().length > 0) return; // leaf text only — its own wrapping ancestor would otherwise re-match the same words

    const text = $el.text().trim().replace(/\s+/g, " ");
    if (text.length < MIN_QUOTE_CHARS || text.length > MAX_QUOTE_CHARS) return;
    const quoteMatch = text.match(QUOTE_WRAPPED_PATTERN);
    if (!quoteMatch) return;
    const quote = quoteMatch[1].trim();
    if (quote.length < MIN_QUOTE_CHARS) return;
    if ($el.closest("footer").length > 0 && !footerCandidatePassesQualityBar($, $el)) return;

    const prevText = $el.prev().text().trim().replace(/\s+/g, " ");
    const nextText = $el.next().text().trim().replace(/\s+/g, " ");
    let heading = GENERIC_TESTIMONIAL_HEADING;
    const attribution = nextText.match(ATTRIBUTION_PATTERN);
    if (attribution) {
      heading = attribution[1].trim() || heading;
    } else if (prevText && prevText.length <= 80 && NAME_LIKE_PATTERN.test(prevText)) {
      heading = prevText;
    }

    const dedupeKey = `${heading}:${quote.slice(0, 60)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    // quote is already bounded by MIN_QUOTE_CHARS/MAX_QUOTE_CHARS above (a
    // real, complete testimonial) — re-slicing it to the generic
    // SECTION_EXCERPT_MAX_CHARS (300, sized for nav-blob excerpts, not
    // quotes) chopped real testimonials off mid-sentence on the rendered
    // page (Evidence Depth investigation, Friedman Grimes: "...He has
    // excellent knowledgeable com"). Store the full validated quote.
    sections.push({ heading, excerpt: quote, sourceUrl });
  });

  return sections;
}

// ===========================================================================
// FAQ content-shape gate (Evidence Depth investigation, Friedman Grimes):
// "accordion" is a UI-widget keyword, not an FAQ-specific one — real sites
// reuse the same collapsible-accordion component for non-FAQ purposes.
// Confirmed on a real site during this investigation: a law firm's
// collapsible practice-area sidebar menu ("Family Law Overview", "Divorce",
// "Child Custody"...) uses the identical accordion classing as its actual
// FAQ widget, so the class-keyword scan alone pulled in navigation text
// mislabeled as customer-facing FAQ content. A real FAQ item's heading or
// excerpt names an actual question; a nav menu reusing the same widget does
// not. This mirrors findTestimonialsByStructure's own discipline: the
// CSS-class match is a candidate, never proof on its own.
// ===========================================================================

function looksLikeFaqContent(section: ContentSection): boolean {
  return section.heading.includes("?") || section.excerpt.includes("?");
}

/**
 * The full structured-facts extraction pass — pure, given an already-loaded
 * page and the URL it came from. `sourceUrl` is threaded onto every
 * ContentSection/GalleryImage this produces, so a caller merging results
 * from multiple pages (see mergeStructuredFacts below) never loses track of
 * which real page backs which claim.
 */
export function extractStructuredFacts($: cheerio.CheerioAPI, sourceUrl: string) {
  const jsonLd = parseJsonLdEntities($);
  const pageTitle = $("title").first().text().trim();

  const bySections: Record<PageFallbackCategory, ContentSection[]> = {
    certifications: findSectionsByKeywords($, ["certif", "accredit"], sourceUrl),
    licenses: findSectionsByKeywords($, ["licens"], sourceUrl),
    services: findSectionsByKeywords($, ["service", "offering"], sourceUrl),
    products: findSectionsByKeywords($, ["product", "shop-item", "store-item"], sourceUrl),
    team: findSectionsByKeywords($, ["team", "staff"], sourceUrl),
    faq: findSectionsByKeywords($, ["faq", "accordion"], sourceUrl).filter(looksLikeFaqContent),
  };

  // Page-level fallback (signal 2): when this specific page's own URL/title
  // says it's about a category the CSS-class scan above found nothing for,
  // take the page's real main content as ONE evidence item headed by the
  // page's own real title. Never overrides a scan that already found
  // something, and deliberately excludes testimonials — those come only
  // from real quote structure (findTestimonialsByStructure) so a whole page
  // of prose is never treated as if it were itself a verbatim customer
  // quote.
  for (const category of classifyPageByUrlAndTitle(sourceUrl, pageTitle)) {
    if (bySections[category].length > 0) continue;
    const content = extractMainPageContent($);
    if (content.length === 0) continue;
    bySections[category] = [{ heading: pageTitle || category, excerpt: content, sourceUrl }];
  }

  const testimonials = mergeSections([
    findSectionsByKeywords($, ["testimonial"], sourceUrl),
    findTestimonialsByStructure($, sourceUrl),
  ]);

  return {
    contact: extractContact($, jsonLd),
    socials: extractSocials($, jsonLd),
    certifications: bySections.certifications,
    licenses: bySections.licenses,
    services: bySections.services,
    products: bySections.products,
    team: bySections.team,
    faq: bySections.faq,
    testimonials,
    reviews: extractReviews(jsonLd),
    gallery: extractGallery($, sourceUrl),
    forms: extractForms($),
    maps: extractMaps($),
  };
}

type StructuredFacts = ReturnType<typeof extractStructuredFacts>;

function mergeContactInfo(perPage: ContactInfo[]): ContactInfo {
  const phones = new Set<string>();
  const emails = new Set<string>();
  let address: string | null = null;
  let hours: string | null = null;
  for (const c of perPage) {
    c.phones.forEach((p) => phones.add(p));
    c.emails.forEach((e) => emails.add(e));
    if (!address && c.address) address = c.address;
    if (!hours && c.hours) hours = c.hours;
  }
  return {
    phones: [...phones].slice(0, MAX_CONTACT_ITEMS),
    emails: [...emails].slice(0, MAX_CONTACT_ITEMS),
    address,
    hours,
  };
}

function mergeSocials(perPage: SocialLinks[]): SocialLinks {
  const result = emptySocials();
  for (const socials of perPage) {
    for (const key of Object.keys(result) as (keyof SocialLinks)[]) {
      if (!result[key] && socials[key]) result[key] = socials[key];
    }
  }
  return result;
}

function mergeReviews(perPage: ReviewsSummary[]): ReviewsSummary {
  return perPage.find((r) => r.source !== null) ?? emptyReviews();
}

/** Concatenates content sections across pages, still capped and deduped exactly like a single page's own findSectionsByKeywords — a section real on two different pages collapses to one, provenance kept from whichever copy was seen first. */
function mergeSections(perPage: ContentSection[][]): ContentSection[] {
  const merged: ContentSection[] = [];
  const seen = new Set<string>();
  for (const sections of perPage) {
    for (const section of sections) {
      if (merged.length >= MAX_SECTIONS_PER_CATEGORY) return merged;
      const dedupeKey = `${section.heading}:${section.excerpt.slice(0, 60)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      merged.push(section);
    }
  }
  return merged;
}

function mergeGallery(perPage: GalleryImage[][]): GalleryImage[] {
  const merged: GalleryImage[] = [];
  const seen = new Set<string>();
  for (const images of perPage) {
    for (const image of images) {
      if (merged.length >= MAX_GALLERY_IMAGES) return merged;
      if (seen.has(image.src)) continue;
      seen.add(image.src);
      merged.push(image);
    }
  }
  return merged;
}

/**
 * Merges structured facts extracted separately from the homepage and each
 * of the crawler's already-fetched sub-pages (`CrawlRawResult.pages`) into
 * one combined result — the fix for the crawler previously discarding
 * everything but a sub-page's `<title>` once it had been fetched. `pages`
 * must be ordered homepage-first: contact address/hours and forms/maps take
 * the homepage's own value when present (its own declared facts are the
 * most authoritative), falling through to a sub-page's only when the
 * homepage didn't have one. Content-category sections/images/socials/
 * reviews are unioned across every page, still capped and deduped exactly
 * as a single page's own extraction already was — never expanding beyond
 * what one page's worth of real content would produce, just drawing from
 * more of it. Every item keeps the real sourceUrl it was actually found on
 * (ContentSection/GalleryImage's own field) — nothing here invents content
 * or blends pages into an unattributed mixture.
 */
export function mergeStructuredFacts(pages: StructuredFacts[]): StructuredFacts {
  if (pages.length === 0) {
    return emptyStructuredFacts();
  }
  return {
    contact: mergeContactInfo(pages.map((p) => p.contact)),
    socials: mergeSocials(pages.map((p) => p.socials)),
    certifications: mergeSections(pages.map((p) => p.certifications)),
    licenses: mergeSections(pages.map((p) => p.licenses)),
    services: mergeSections(pages.map((p) => p.services)),
    products: mergeSections(pages.map((p) => p.products)),
    team: mergeSections(pages.map((p) => p.team)),
    faq: mergeSections(pages.map((p) => p.faq)),
    testimonials: mergeSections(pages.map((p) => p.testimonials)),
    reviews: mergeReviews(pages.map((p) => p.reviews)),
    gallery: mergeGallery(pages.map((p) => p.gallery)),
    // Homepage's own only — a sub-page's contact form or map embed isn't a
    // business fact worth aggregating the way services/testimonials are.
    forms: pages[0].forms,
    maps: pages[0].maps,
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

  const linkEntries: { url: string; text: string }[] = [];
  const seenLinkUrls = new Set<string>();
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
        const resolvedUrl = resolved.toString();
        if (!seenLinkUrls.has(resolvedUrl)) {
          seenLinkUrls.add(resolvedUrl);
          linkEntries.push({ url: resolvedUrl, text: $(el).text().trim().replace(/\s+/g, " ") });
        }
      } else {
        externalLinkCount += 1;
      }
    } catch {
      // Malformed href — ignore rather than fail the whole crawl.
    }
  });

  const sampleUrls = prioritizeSampleUrls(
    linkEntries.filter((link) => link.url !== finalUrl),
    MAX_SAMPLE_PAGES
  );

  // Each sampled sub-page is fetched here regardless — the fix is making
  // that already-downloaded HTML useful instead of keeping only its
  // <title> and discarding the rest. Structured extraction runs on each
  // sub-page's own document, with its own try/catch: a markup quirk on one
  // sub-page must never discard that page's CrawlPage entry, and must never
  // take down the homepage's own already-succeeded extraction.
  const subPageResults: { page: CrawlPage; facts: StructuredFacts | null }[] = await Promise.all(
    sampleUrls.map(async (pageUrl): Promise<{ page: CrawlPage; facts: StructuredFacts | null }> => {
      try {
        const pageResponse = await fetchWithTimeout(pageUrl);
        const pageHtml = await pageResponse.text();
        const page$ = cheerio.load(pageHtml);
        const pageTitle = page$("title").first().text().trim() || null;

        let facts: StructuredFacts | null = null;
        try {
          facts = extractStructuredFacts(page$, pageUrl);
        } catch {
          // Honest: extraction failed on this sub-page, not "nothing there."
          facts = null;
        }

        return { page: { url: pageUrl, statusCode: pageResponse.status, title: pageTitle }, facts };
      } catch (err) {
        return {
          page: {
            url: pageUrl,
            statusCode: null,
            title: null,
            fetchError: err instanceof Error ? err.message : "Failed to fetch page",
          },
          facts: null,
        };
      }
    })
  );

  const pages: CrawlPage[] = subPageResults.map((r) => r.page);

  const [robotsCheck, sitemapCheck] = await Promise.all([
    fetchWithTimeout(new URL("/robots.txt", origin).toString()).catch(() => null),
    fetchWithTimeout(new URL("/sitemap.xml", origin).toString()).catch(() => null),
  ]);

  let homepageFacts: StructuredFacts;
  try {
    homepageFacts = extractStructuredFacts($, finalUrl);
  } catch {
    // A heuristic bug in structured extraction should never crash a crawl
    // that otherwise succeeded — degrade to honest empty defaults instead.
    homepageFacts = emptyStructuredFacts();
  }

  // Homepage first, always — mergeStructuredFacts relies on that order for
  // contact/forms/maps precedence (see its own doc comment).
  const structuredFacts = mergeStructuredFacts([
    homepageFacts,
    ...subPageResults.map((r) => r.facts).filter((f): f is StructuredFacts => f !== null),
  ]);

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
