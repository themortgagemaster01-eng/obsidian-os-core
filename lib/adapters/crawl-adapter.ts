import * as cheerio from "cheerio";

import type {
  CrawlPage,
  CrawlRawResult,
  ContactInfo,
  PhoneEvidence,
  EmailEvidence,
  HoursEntry,
  SocialLinks,
  ContentSection,
  ReviewsSummary,
  GalleryImage,
  MenuCategory,
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
    menu: [] as MenuCategory[],
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

// Visible text must carry human phone formatting. Bare 10-digit strings are
// commonly tracking/account IDs and are accepted only from tel: or JSON-LD.
const PHONE_REGEX = /(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/** Non-global copies of the two patterns above, used only as one-shot .test()/.match() stop-checks (e.g. addressSiblingContinues below) — PHONE_REGEX/EMAIL_REGEX carry the `g` flag and are stateful across .test() calls via lastIndex, which a shared stop-check must never depend on. */
const PHONE_LIKE = new RegExp(PHONE_REGEX.source, "i");
const EMAIL_LIKE = new RegExp(EMAIL_REGEX.source, "i");
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

/**
 * Real, reported data-quality bug (CTO Phase 3.5 directive §2): plain
 * `$el.text()` on a container concatenates every descendant text node with
 * NO inserted separator at element boundaries (DOM `textContent` behavior,
 * not a cheerio quirk) — a real widget shaped like
 * `<div class="hours"><div>Tuesday</div><div>5 pm to 11 pm</div>...</div>`
 * (day and time as separate child elements, no literal whitespace text node
 * between them in the source) collapses into "Tuesday5 pm to 11 pm..." when
 * read as one blob. This walks every leaf descendant (an element with no
 * element children — the actual text-bearing unit) and joins their own
 * trimmed text with a single real space, reconstructing real word
 * boundaries regardless of the source markup's own whitespace habits.
 */
function leafTextWithSpacing($: cheerio.CheerioAPI, $el: ReturnType<cheerio.CheerioAPI>): string {
  if ($el.children().length === 0) {
    return $el.text().trim();
  }
  const parts: string[] = [];
  $el.find("*").each((_, node) => {
    const $node = $(node);
    if ($node.children().length === 0) {
      const t = $node.text().trim();
      if (t) parts.push(t);
    }
  });
  return parts.length > 0 ? parts.join(" ") : $el.text().trim();
}

function extractHours($: cheerio.CheerioAPI, hoursFromJsonLd: string | null): string | null {
  if (hoursFromJsonLd) return hoursFromJsonLd;

  const hoursWidget = $('[class*="hours" i], [id*="hours" i]').first();
  const hoursFromDom = hoursWidget.length > 0 ? leafTextWithSpacing($, hoursWidget).replace(/\s+/g, " ").slice(0, 300) || null : null;
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

// ===========================================================================
// Structured day-by-day hours (CTO Phase 3.5 directive §2) — parsed
// generically from whatever raw hours string extractHours already produced
// (JSON-LD's "Mo-Fr 09:00-17:00" shorthand, a DOM widget, or a labeled
// visible-text block), never a second, divergent extraction pass. Works by
// finding day-name (or day-range) boundaries directly in the string, so it
// is immune to the exact whitespace-concatenation bug leafTextWithSpacing
// above defends against at the source — even an imperfectly-joined
// "Tuesday5 pm to 11 pm" chunk still slices cleanly once "Tuesday"'s own
// length is known.
// ===========================================================================

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_ABBR_TO_FULL: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
/** A single day name or a real range ("Wednesday-Saturday", "Mon–Fri", "Tue to Sat") as ONE atomic boundary token — matching bare single day names here would incorrectly split a range into two separate, wrongly-scoped entries (the CTO's own "Wednesday-Saturday 11:30am - 8:00pm" real fixture: both "Wednesday" and "Saturday" independently match \bDAY_NAME\b, so a naive bare-day-name splitter would cut the range in half and lose Thursday/Friday's real hours entirely). */
const DAY_TOKEN = new RegExp(`\\b${DAY_NAME}(?:\\s*(?:-|–|to)\\s*${DAY_NAME})?\\b`, "gi");
const TIME_TOKEN = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi;

function canonicalDay(token: string): string | null {
  return DAY_ABBR_TO_FULL[token.toLowerCase().slice(0, 3)] ?? null;
}

/** "Wednesday-Saturday" -> [Wednesday, Thursday, Friday, Saturday]; a single day name -> just itself. Wraps around DAY_ORDER (capped at 7 steps) so a real "Fri-Mon" range still resolves, never loops forever on a malformed token. */
function expandDayToken(token: string): string[] {
  const rangeMatch = token.match(new RegExp(`^(${DAY_NAME})\\s*(?:-|–|to)\\s*(${DAY_NAME})$`, "i"));
  if (!rangeMatch) {
    const single = canonicalDay(token);
    return single ? [single] : [];
  }
  const start = canonicalDay(rangeMatch[1]);
  const end = canonicalDay(rangeMatch[2]);
  if (!start || !end) return [];
  const startIdx = DAY_ORDER.indexOf(start);
  const endIdx = DAY_ORDER.indexOf(end);
  const days: string[] = [];
  let i = startIdx;
  for (let step = 0; step < 7; step++) {
    days.push(DAY_ORDER[i]);
    if (i === endIdx) break;
    i = (i + 1) % 7;
  }
  return days;
}

/** "5 pm to 11 pm" -> "5:00 PM – 11:00 PM"; a single time with no pair -> just that one, formatted (never fabricates a missing closing time). Real minutes are preserved ("11:30am" -> "11:30 AM"), never rounded away. */
function normalizeHoursTimeText(text: string): string | null {
  if (/closed/i.test(text)) return "Closed";
  const matches = [...text.matchAll(TIME_TOKEN)].map((m) => `${m[1]}:${m[2] ?? "00"} ${m[3].toUpperCase()}`);
  if (matches.length === 0) return null;
  return matches.length >= 2 ? `${matches[0]} – ${matches[1]}` : matches[0];
}

/**
 * parseHoursByDay — the real structured output (CTO Phase 3.5 directive §2:
 * "day-by-day with proper spacing/formatting"). Returns [] when the raw
 * text has no real day-name boundary at all (e.g. "9am-5pm daily" or a
 * fetch that found no hours) — the caller's existing raw `hours` string
 * stays the honest fallback for that case, never backfilled with a guess.
 */
function parseHoursByDay(raw: string): HoursEntry[] {
  const tokens = [...raw.matchAll(DAY_TOKEN)];
  if (tokens.length === 0) return [];

  const entries: HoursEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const start = token.index;
    if (start === undefined) continue;
    const end = i + 1 < tokens.length ? (tokens[i + 1].index ?? raw.length) : raw.length;
    const rest = raw.slice(start + token[0].length, end).trim();
    if (!rest) continue;
    const hoursText = normalizeHoursTimeText(rest) ?? (rest.length <= 40 ? rest : null);
    if (!hoursText) continue;
    for (const day of expandDayToken(token[0])) {
      entries.push({ day, hours: hoursText });
    }
  }
  return entries;
}

const ADDRESS_LABEL_WITH_COLON = /^(address|location)\s*:\s*/i;
const ADDRESS_LABEL_ONLY = /^(address|location)\s*:?\s*$/i;
/** A plausible address *value* starts with a number, per the overwhelming convention of street addresses ("100 Arnold Street...", "3027 Blue Ridge Road...") — guards the "Address these three points before..." false-positive case, where "address" is a verb, not a label. */
const ADDRESS_VALUE_PLAUSIBLE = /^\d/;

/**
 * Real, reported data-quality bug (CTO Phase 3.5 directive §1): an
 * "Address:"-label-only element's sibling-gather (extractLabeledValue) had
 * no stop condition at all, so a phone-number line immediately following
 * the address block in the DOM (a common real layout — "Address: ... /
 * Phone: ...") got swept into the same combined address string ("5 Princess
 * Street West • Waterloo 519-886-1689" — the exact reported case). Stops
 * the gather the moment a following sibling looks like a DIFFERENT field
 * entirely: a phone number, an email, or another explicit contact label —
 * generic, never a per-business pattern.
 */
function addressSiblingContinues(siblingText: string): boolean {
  // A sibling that IS a phone/email once its phone/email substring is
  // stripped away (nothing real is left) is that field's own line — stop
  // before it entirely. A sibling that merely CONTAINS one alongside real
  // remaining text (e.g. a single element combining street + phone) still
  // continues here; stripTrailingPhone below cleans that case up on the
  // final combined value instead, since stopping early would throw away
  // real address text sharing the same element.
  const stripped = siblingText
    .replace(new RegExp(PHONE_LIKE.source, "gi"), "")
    .replace(new RegExp(EMAIL_LIKE.source, "gi"), "")
    .replace(/[\s•,;\-–:]/g, "");
  if (stripped.length === 0) return false;
  if (HOURS_LABEL_WITH_COLON.test(siblingText) || HOURS_LABEL_ONLY.test(siblingText)) return false;
  if (/^(phone|tel|telephone|call|email|fax)\s*:?\s*$/i.test(siblingText)) return false;
  return true;
}

/**
 * Defense-in-depth for the same bug, one layer deeper: even with the
 * sibling stop above, a SINGLE element could itself already contain both
 * fields in one text node (e.g. "5 Princess Street West, call 519-886-1689").
 * An address genuinely never *ends* with a phone number, so trailing phone-
 * shaped content (plus whatever bullet/punctuation separated it) is
 * stripped — never touches phone-shaped text in the middle of a real
 * address (e.g. no real street address contains one), so this can't corrupt
 * a genuine value.
 */
function stripTrailingPhone(value: string): string {
  const match = value.match(new RegExp(`[\\s•,;\\-–]*${PHONE_LIKE.source}\\s*$`, "i"));
  if (!match || match.index === undefined || match.index === 0) return value;
  return value.slice(0, match.index).trim();
}

function extractAddress($: cheerio.CheerioAPI, addressFromJsonLd: string | null): { value: string; source: "json-ld" | "labeled" } | null {
  if (addressFromJsonLd) return { value: addressFromJsonLd, source: "json-ld" };
  const labeled = extractLabeledValue(
    $,
    ADDRESS_LABEL_WITH_COLON,
    ADDRESS_LABEL_ONLY,
    (value) => ADDRESS_VALUE_PLAUSIBLE.test(value),
    addressSiblingContinues
  );
  if (!labeled) return null;
  const cleaned = stripTrailingPhone(labeled);
  return cleaned ? { value: cleaned, source: "labeled" } : null;
}

function normalizePhoneCandidate(value: string): { phone: string; normalized: string } | null {
  const withoutScheme = value.replace(/^tel:/i, "").split(/[?#]/, 1)[0].trim();
  const main = withoutScheme.replace(/(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})$/i, "");
  const digits = main.replace(/\D/g, "");
  if (digits.length === 10) {
    return { phone: main.trim(), normalized: `+1${digits}` };
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return { phone: main.trim(), normalized: `+${digits}` };
  }
  // JSON-LD and tel: values may be international E.164 values. Visible text
  // never reaches this form unless it explicitly includes the + prefix.
  if (withoutScheme.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return { phone: `+${digits}`, normalized: `+${digits}` };
  }
  return null;
}

function extractContact($: cheerio.CheerioAPI, jsonLd: JsonLdEntity[], sourceUrl: string): ContactInfo {
  const bodyText = $("body").text();
  const candidates: Array<{ value: string; source: PhoneEvidence["source"] }> = [
    ...$('a[href^="tel:"]')
      .map((_, el) => $(el).attr("href")?.trim())
      .get()
      .filter((value): value is string => !!value)
      .map((value) => ({ value, source: "tel-link" as const })),
    ...jsonLd.map((entity) => entity.telephone).filter((value): value is string => !!value).map((value) => ({ value, source: "json-ld" as const })),
    ...(bodyText.match(PHONE_REGEX) ?? []).map((value) => ({ value, source: "visible-text" as const })),
  ];
  const phoneEvidence: PhoneEvidence[] = [];
  const seenPhones = new Set<string>();
  for (const candidate of candidates) {
    const phone = normalizePhoneCandidate(candidate.value);
    if (!phone || seenPhones.has(phone.normalized)) continue;
    seenPhones.add(phone.normalized);
    phoneEvidence.push({ ...phone, sourceUrl, source: candidate.source });
    if (phoneEvidence.length >= MAX_CONTACT_ITEMS) break;
  }
  const phones = phoneEvidence.map((item) => item.phone);

  const emailCandidates: Array<{ value: string; source: EmailEvidence["source"] }> = [
    ...$('a[href^="mailto:"]')
      .map((_, el) => $(el).attr("href")?.replace(/^mailto:/, "").split("?")[0]?.trim())
      .get()
      .filter((v): v is string => !!v)
      .map((value) => ({ value, source: "mailto-link" as const })),
    ...jsonLd.map((e) => e.email).filter((v): v is string => !!v).map((value) => ({ value, source: "json-ld" as const })),
    ...(bodyText.match(EMAIL_REGEX) ?? []).map((value) => ({ value, source: "visible-text" as const })),
  ];
  const emailEvidence: EmailEvidence[] = [];
  const seenEmails = new Set<string>();
  for (const candidate of emailCandidates) {
    const normalized = candidate.value.trim().toLowerCase();
    if (!normalized || seenEmails.has(normalized)) continue;
    seenEmails.add(normalized);
    emailEvidence.push({ email: candidate.value.trim(), sourceUrl, source: candidate.source });
    if (emailEvidence.length >= MAX_CONTACT_ITEMS) break;
  }
  const emails = emailEvidence.map((item) => item.email);

  const addressFromJsonLd = jsonLd.map((e) => formatJsonLdAddress(e.address)).find((v): v is string => !!v) ?? null;
  const addressResult = extractAddress($, addressFromJsonLd);

  const jsonLdHours = jsonLd.map((e) => e.openingHours).find((v) => v !== undefined);
  const hoursFromJsonLd = jsonLdHours
    ? Array.isArray(jsonLdHours)
      ? jsonLdHours.join("; ")
      : jsonLdHours
    : null;
  const hours = extractHours($, hoursFromJsonLd);
  const hoursByDay = hours ? parseHoursByDay(hours) : [];

  return {
    phones,
    ...(phoneEvidence.length > 0 ? { phoneEvidence } : {}),
    emails,
    ...(emailEvidence.length > 0 ? { emailEvidence } : {}),
    address: addressResult?.value ?? null,
    ...(addressResult ? { addressSource: addressResult.source } : {}),
    hours,
    ...(hoursByDay.length > 0 ? { hoursByDay } : {}),
  };
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

/** Filename/URL fragments that reliably mark a decorative/UI image rather than real business photography — logos, icons, spacers. Deliberately narrow (a real dish/venue photo is never named this) rather than a broad guess. */
const NON_CONTENT_IMAGE_PATTERN = /logo|favicon|sprite|spacer|placeholder|avatar|icon[-_]|[-_]icon/i;
/** A template-engine placeholder never resolves to a real fetchable image ("{{image}}", "${src}") — this crawler is a plain fetch, so anything still containing template syntax was never actually rendered into a real URL. */
const TEMPLATE_PLACEHOLDER_PATTERN = /[{}$]/;
/** An explicit HTML width/height this small reliably marks an icon/UI glyph, never real content photography — generous enough that a legitimate thumbnail still clears it. Images with no size attribute at all (the common case for responsive real photography, sized via CSS) are never excluded by this check. */
const MIN_CONTENT_IMAGE_DIMENSION_PX = 80;

function isLikelyContentImage($img: ReturnType<cheerio.CheerioAPI>, src: string): boolean {
  if (TEMPLATE_PLACEHOLDER_PATTERN.test(src)) return false;
  if (NON_CONTENT_IMAGE_PATTERN.test(src)) return false;
  if (NON_CONTENT_IMAGE_PATTERN.test($img.attr("alt") ?? "")) return false;
  const widthAttr = Number($img.attr("width"));
  const heightAttr = Number($img.attr("height"));
  if (Number.isFinite(widthAttr) && widthAttr > 0 && widthAttr < MIN_CONTENT_IMAGE_DIMENSION_PX) return false;
  if (Number.isFinite(heightAttr) && heightAttr > 0 && heightAttr < MIN_CONTENT_IMAGE_DIMENSION_PX) return false;
  return true;
}

/**
 * Real business photography, wherever it actually appears on the page — not
 * only inside a container explicitly classed/labeled "gallery" (the prior
 * behavior; confirmed too narrow on a real site during the Phase 4.8
 * investigation: janebond.ca's one real photo sits directly in a page
 * section with no "gallery" wrapper anywhere near it). Every real `<img>`
 * src on the page (outside nav/header/footer chrome) is a candidate;
 * isLikelyContentImage filters out logos/icons/template placeholders/tiny
 * UI glyphs — a real dish/venue photo is never named "logo.png" or sized
 * 24x24. `src` is resolved to an absolute URL against `sourceUrl` — a real,
 * disclosed fix for a latent bug this broadening also surfaced: a relative
 * src like "images/photo.jpg" would otherwise resolve against Obsidian OS's
 * own domain once rendered on the new site, not the business's real one.
 */
function extractGallery($: cheerio.CheerioAPI, sourceUrl: string): GalleryImage[] {
  const seen = new Set<string>();
  const images: GalleryImage[] = [];
  $("img[src]").each((_, el) => {
    if (images.length >= MAX_GALLERY_IMAGES) return;
    const $img = $(el);
    if ($img.closest("nav, header, footer, script, style").length > 0) return;
    const rawSrc = $img.attr("src");
    if (!rawSrc || !isLikelyContentImage($img, rawSrc)) return;
    let resolvedSrc: string;
    try {
      resolvedSrc = new URL(rawSrc, sourceUrl).toString();
    } catch {
      return;
    }
    if (seen.has(resolvedSrc)) return;
    seen.add(resolvedSrc);
    images.push({ src: resolvedSrc, alt: $img.attr("alt") ?? null, sourceUrl });
  });
  return images;
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
// Team/staff structural detection (Evidence Depth investigation, Friedman
// Grimes): a real team page can carry no "team"/"staff" CSS class or id at
// all — confirmed on oldtownlawyers.com/our-team/, a WPBakery page-builder
// site whose page-level fallback (classifyPageByUrlAndTitle -> whole-page
// text) was the ONLY thing populating "team" at all, producing one giant
// run-on excerpt with no separation between people ("OUR TEAM Attorneys
// Foster S.B. Friedman Partner Carolyn M. Grimes Partner..."). The real
// per-person markup has a recognizable SHAPE instead: a short bold name
// (`<strong>`/`<b>`) immediately followed by a line break and a short plain
// text line naming their role ("Partner", "Attorney", "Office Manager") —
// an extremely common WYSIWYG convention (bold the name, Shift+Enter, type
// the title) that has nothing to do with law firms specifically. Like
// findTestimonialsByStructure, this never requires team/staff terminology
// in the markup and never invents a name — NAME_LIKE_PATTERN is the same
// bounded shape check testimonials already use for a real-name line.
// ===========================================================================

const NAME_TITLE_LINE_MAX_CHARS = 40;
const BOLD_OPEN_TAG_PATTERN = /<(strong|b)[\s>]/i;

function findTeamMembersByStructure($: cheerio.CheerioAPI, sourceUrl: string): ContentSection[] {
  const sections: ContentSection[] = [];
  const seen = new Set<string>();

  $("p, span").each((_, el) => {
    if (sections.length >= MAX_SECTIONS_PER_CATEGORY) return;
    const $el = $(el);
    if ($el.closest("nav, header, script, style").length > 0) return;
    if ($el.closest("footer").length > 0 && !footerCandidatePassesQualityBar($, $el)) return;

    // Split this element's OWN inner markup at each direct <br> — the
    // structural line break between a name and its title. An element whose
    // name+title only appear nested inside a DEEPER child (e.g. a <p> whose
    // sole child is the real <span> carrying the <br>s) simply produces one
    // line here and is correctly skipped; the inner span is visited
    // separately by this same $("p, span") scan and matches on its own.
    const innerHtml = $el.html();
    if (!innerHtml) return;
    const fragments = innerHtml.split(/<br\s*\/?>/i);
    if (fragments.length < 2) return;

    const lines = fragments
      .map((fragment) => ({
        text: cheerio.load(fragment)("body").text().trim().replace(/\s+/g, " "),
        hasBold: BOLD_OPEN_TAG_PATTERN.test(fragment),
      }))
      .filter((l) => l.text.length > 0);
    if (lines.length < 2) return;

    const [nameLine, titleLine] = lines;
    if (!nameLine.hasBold || titleLine.hasBold) return;
    if (!NAME_LIKE_PATTERN.test(nameLine.text)) return;
    if (titleLine.text.length === 0 || titleLine.text.length > NAME_TITLE_LINE_MAX_CHARS) return;

    const dedupeKey = `${nameLine.text}:${titleLine.text}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    sections.push({ heading: nameLine.text, excerpt: titleLine.text, sourceUrl });
  });

  return sections;
}

// ===========================================================================
// Service/practice-area menu structural detection (Friedman Flagship Final
// Content Pass). A nav item's own top-level link text ("Home", "About",
// "Contact") is pure navigation chrome and stays hard-excluded everywhere
// else in this file — but when that label itself names what the business
// offers ("Services", "Practice Areas", "Menu", "Products") AND the item
// has a real dropdown submenu, that submenu is the business's own real
// offering index, often published nowhere else on the site at all.
// Confirmed on the real oldtownlawyers.com: a sitewide "Practice Areas"
// mega-menu names 5 real top-level areas (Family Law, Wills/Trusts &
// Estates, Bankruptcy Law, Business Law, Local Counsel), each with real
// named sub-services — while extractMainPageContent's page-level fallback
// was separately misfiring on an unrelated sub-page (a "Family Law for
// Foreign Service Professionals" article, URL-tokenized as containing the
// word "service" and misclassified as a services LISTING page), producing
// an unstructured nav-text blob instead. This is strictly better evidence
// than either the CSS-keyword body scan or the page-level fallback, so it's
// preferred when found (extractStructuredFacts below).
//
// Mirrors footerCandidatePassesQualityBar's precedent: chrome is scored on
// its own real structural content rather than blanket-excluded once a
// narrow, deliberate evidence signal is present. Never keys off a
// CMS/theme-specific class name (no WordPress/Astra/menu-plugin naming
// anywhere below) — only the semantic <nav>/<ul>/<li> shape and the link's
// own real text, so it generalizes to any site using a dropdown mega-menu.
// ===========================================================================

const SERVICE_MENU_LABEL_PATTERN = /^(our\s+)?(services?|offerings?|products?|practice\s+areas?|menu)$/i;
const MAX_SUBITEMS_PER_CATEGORY = 8;

function findServiceMenuStructure($: cheerio.CheerioAPI, sourceUrl: string): ContentSection[] {
  const sections: ContentSection[] = [];
  const seen = new Set<string>();

  $("nav a").each((_, el) => {
    if (sections.length >= MAX_SECTIONS_PER_CATEGORY) return;
    const $link = $(el);
    const label = $link.text().trim().replace(/\s+/g, " ");
    if (!SERVICE_MENU_LABEL_PATTERN.test(label)) return;

    // The dropdown submenu is either the link's own sibling <ul> or its
    // parent <li>'s child <ul> — the two common menu-markup shapes.
    const siblingSubmenu = $link.siblings("ul").first();
    const submenu = siblingSubmenu.length > 0 ? siblingSubmenu : $link.parent("li").children("ul").first();
    if (submenu.length === 0) return;

    submenu.children("li").each((_, categoryEl) => {
      if (sections.length >= MAX_SECTIONS_PER_CATEGORY) return;
      const $category = $(categoryEl);
      const categoryLabel = $category.children("a").first().text().trim().replace(/\s+/g, " ");
      if (categoryLabel.length === 0) return;

      const subItems = $category
        .children("ul")
        .children("li")
        .map((_, itemEl) => $(itemEl).children("a").first().text().trim().replace(/\s+/g, " "))
        .get()
        .filter((t) => t.length > 0)
        .slice(0, MAX_SUBITEMS_PER_CATEGORY);

      const dedupeKey = `${label}:${categoryLabel}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      sections.push({ heading: categoryLabel, excerpt: subItems.join(", "), sourceUrl });
    });
  });

  return sections;
}

// ===========================================================================
// Menu/price-list structural detection (Phase 4.8 evidence-pipeline pass —
// investigation on a real business, janebond.ca). A real menu item has a
// recognizable SHAPE regardless of what CSS class (if any) a theme wraps it
// in: a short name, a real price the business itself published right next
// to it, often followed by a longer description. This is anchored on the
// PRICE, not on any class/id name or navigation pattern — a bare price
// token is a far more universal, far less false-positive-prone signal
// across arbitrary real-world markup than any one theme's class naming.
//
// Confirmed real and necessary on janebond.ca: the crawl already fetched the
// homepage containing the real menu (dish names, real prices, real
// descriptions, no JavaScript required) — but findServiceMenuStructure above
// only recognizes a nav-dropdown mega-menu (the "practice areas" shape), and
// this business's real menu is a completely different, and more common for
// an actual food/drink menu, shape: a same-page section of repeated
// name+price(+description) blocks. Never keys off any one theme's class
// name (no "menu_single_item"/"item_name"/"item_price" anywhere below) —
// only the structural price anchor plus nearby real text, so this
// generalizes to any business publishing a real price list in roughly this
// shape (restaurant menus, service-rate lists, class-pass pricing, etc.).
//
// Deliberately does NOT attempt price RANGES ("$12–15") or multi-price rows
// (small/large) — a disclosed limitation, not a silent gap: that shape is
// rare enough, and ambiguous enough against other numeric ranges (hours,
// phone extensions), that guessing at it risks a false match more than the
// coverage is worth in this pass.
// ===========================================================================

/** "$18.00", "18.00", "$18" — a bare price token as a leaf element's own full text. Never matches a phone number, date, or plain percentage (those don't fit this narrow shape). */
const PRICE_TOKEN_PATTERN = /^\$\s?\d{1,4}(?:\.\d{2})?$|^\d{1,4}\.\d{2}$/;
/** A single price-shaped element elsewhere on an otherwise-unrelated page (a consultation fee, a "starting at" figure) is real but isn't a menu — a menu is a REPEATED pattern. */
const MIN_MENU_ITEMS_FOR_REAL_MENU = 2;
const MAX_MENU_CATEGORIES = 6;
const MAX_ITEMS_PER_MENU_CATEGORY = 12;
const MENU_ITEM_NAME_MAX_CHARS = 80;
const MENU_ITEM_DESCRIPTION_MAX_CHARS = 300;
/** A candidate category-label sibling must be this short to plausibly be a heading ("Appetizers", "Small Plates") rather than a stray sentence of body text. */
const MENU_CATEGORY_LABEL_MAX_CHARS = 40;
const MENU_FALLBACK_CATEGORY_NAME = "Menu";
/** Elements this broad a selector considers as "a leaf might be a price, or a short heading" candidates — covers every common menu-markup shape (div-per-field, table row, list item) without scanning every element on the page (e.g. <a>, <i>, decorative wrappers). */
const MENU_CANDIDATE_SELECTOR = "h1, h2, h3, h4, h5, h6, p, div, span, li, td";

/**
 * Reconstructs an item's real name + real description from its container's
 * own direct contents (element children AND bare text nodes, in document
 * order) — the same "each field its own child" and "bare text node beside a
 * price" shapes real sites use interchangeably. The first non-empty,
 * non-price chunk is the name; anything real after it is the description.
 * Returns name: null when nothing usable was found — the caller's signal to
 * try climbing one more ancestor level rather than inventing a name.
 */
function extractMenuItemNameAndDescription(
  $: cheerio.CheerioAPI,
  container: ReturnType<cheerio.CheerioAPI>,
  priceText: string
): { name: string | null; description: string | null } {
  if (container.length === 0) return { name: null, description: null };
  const chunks: string[] = [];
  container.contents().each((_, node) => {
    const text = $(node).text().trim().replace(/\s+/g, " ");
    if (text.length === 0 || text === priceText || PRICE_TOKEN_PATTERN.test(text)) return;
    chunks.push(text);
  });
  if (chunks.length === 0) return { name: null, description: null };
  const [name, ...rest] = chunks;
  if (name.length === 0) return { name: null, description: null };
  const description = rest.join(" ").trim();
  return { name, description: description.length > 0 ? description : null };
}

/**
 * Phase 5.1 fix: a category-label candidate must carry a real structural
 * signal that it's a heading, not just be short, non-price text — the real
 * regression this closes (confirmed live during the Phase 5.0 Kitchener
 * validation, on a real, unrelated restaurant): a real site's own marketing
 * tagline and a promo-pricing blurb were both short enough and non-price,
 * so the old "any short leaf text" rule adopted them as fake menu
 * categories, even though item-level extraction on the same page was
 * entirely correct. Two structural signals, matching this file's own
 * existing precedent elsewhere (the Practice-Areas mega-menu detection's
 * own "CSS class/id must contain the category word" rule): a real heading
 * tag (h1-h6), or a class/id whose own name says what it is
 * ("menu_section_title" — janebond.ca's real, unchanged markup —
 * "category-heading", etc.). Deliberately does NOT fall back to guessing
 * from the text's own content/shape (no sentence-detection, no marketing-
 * copy keyword list, no business-specific string) — per this function's own
 * conservative contract, no structural signal means no category, never a
 * guess; the item stays under MENU_FALLBACK_CATEGORY_NAME instead.
 */
function isStructuralMenuCategoryLabel($el: ReturnType<cheerio.CheerioAPI>): boolean {
  if ($el.is("h1, h2, h3, h4, h5, h6")) return true;
  const classAndId = `${$el.attr("class") ?? ""} ${$el.attr("id") ?? ""}`.toLowerCase();
  return classAndId.includes("title") || classAndId.includes("heading");
}

interface RawMenuItem {
  containerNode: unknown;
  name: string;
  description: string | null;
  price: string;
  docIndex: number;
}

function findMenuItemsByStructure($: cheerio.CheerioAPI, sourceUrl: string): MenuCategory[] {
  const candidateEls = $(MENU_CANDIDATE_SELECTOR).toArray();
  const consumedNodes = new Set<unknown>();
  const rawItems: RawMenuItem[] = [];
  const seenItemKey = new Set<string>();

  // Pass 1: resolve every real price-anchored item (name + optional
  // description), independent of category — and mark every node inside its
  // container as "consumed" so pass 2 can never mistake an item's own name
  // (e.g. "Antojitos") for a category heading several items later.
  for (let i = 0; i < candidateEls.length; i++) {
    const el = candidateEls[i];
    const $el = $(el);
    if ($el.closest("nav, header, footer, script, style").length > 0) continue;
    if ($el.children().length > 0) continue; // leaf only
    const text = $el.text().trim();
    if (!PRICE_TOKEN_PATTERN.test(text)) continue;

    let container = $el.parent();
    let info = extractMenuItemNameAndDescription($, container, text);
    if (!info.name) {
      // One documented fallback level — handles a price wrapped one level
      // deeper than its name (e.g. price in its own inner <span>) without
      // unbounded, unpredictable climbing.
      container = container.parent();
      info = extractMenuItemNameAndDescription($, container, text);
    }
    if (!info.name) continue;

    const containerNode = container.get(0);
    if (!containerNode || consumedNodes.has(containerNode)) continue;

    const key = `${info.name}:${text}`;
    if (seenItemKey.has(key)) continue;
    seenItemKey.add(key);

    container
      .find("*")
      .addBack()
      .each((_, node) => {
        consumedNodes.add(node);
      });

    rawItems.push({ containerNode, name: info.name, description: info.description, price: text, docIndex: i });
  }

  if (rawItems.length < MIN_MENU_ITEMS_FOR_REAL_MENU) return [];

  // Pass 2: walk the same candidates in document order, tracking the most
  // recent short, non-consumed, non-price leaf text as the "current
  // category" — assigned to each item as we reach its own docIndex. A page
  // with no real category headings at all just leaves every item under the
  // honest MENU_FALLBACK_CATEGORY_NAME.
  let currentCategory: string | null = null;
  const categoryByDocIndex = new Map<number, string>();
  let itemPointer = 0;
  for (let i = 0; i < candidateEls.length && itemPointer < rawItems.length; i++) {
    if (i === rawItems[itemPointer].docIndex) {
      categoryByDocIndex.set(i, currentCategory ?? MENU_FALLBACK_CATEGORY_NAME);
      itemPointer++;
      continue;
    }
    const el = candidateEls[i];
    if (consumedNodes.has(el)) continue;
    const $el = $(el);
    if ($el.children().length > 0) continue;
    if ($el.closest("nav, header, footer, script, style").length > 0) continue;
    const text = $el.text().trim();
    if (text.length === 0 || text.length > MENU_CATEGORY_LABEL_MAX_CHARS) continue;
    if (PRICE_TOKEN_PATTERN.test(text)) continue;
    if (!isStructuralMenuCategoryLabel($el)) continue;
    currentCategory = text;
  }

  const categories: MenuCategory[] = [];
  const categoryIndexByName = new Map<string, number>();
  for (const item of rawItems) {
    const categoryName = categoryByDocIndex.get(item.docIndex) ?? MENU_FALLBACK_CATEGORY_NAME;
    let idx = categoryIndexByName.get(categoryName);
    if (idx === undefined) {
      if (categories.length >= MAX_MENU_CATEGORIES) continue;
      idx = categories.length;
      categoryIndexByName.set(categoryName, idx);
      categories.push({ name: categoryName, items: [] });
    }
    if (categories[idx].items.length >= MAX_ITEMS_PER_MENU_CATEGORY) continue;
    categories[idx].items.push({
      name: item.name.slice(0, MENU_ITEM_NAME_MAX_CHARS),
      description: item.description ? item.description.slice(0, MENU_ITEM_DESCRIPTION_MAX_CHARS) : null,
      price: item.price,
      sourceUrl,
      confidence: item.description ? "high" : "medium",
    });
  }

  return categories.filter((c) => c.items.length > 0);
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

// ===========================================================================
// Service/offering content-shape gate (Friedman Flagship Final Content
// Pass): the same page-builder theme quirk the FAQ gate above already
// guards against — a generic decorative/utility CSS class that happens to
// contain "service" as a naming coincidence, unrelated to real services
// content. Confirmed real on oldtownlawyers.com: a sub-page's own
// "serviceheaderimage" title-banner wrapper class (a sibling of the
// already-handled "servicetitle" class from the Evidence Depth pass) whose
// nearest heading is "Practice Areas" and whose body is the SAME flattened
// nav-menu link dump findServiceMenuStructure now extracts cleanly from the
// real <nav> — reached via the CSS-keyword scan instead of the page-level
// URL/title fallback this time, so the excerpt===heading guard doesn't
// catch it (there's real text after the heading, just not real prose). A
// genuine service/offering description reads as at least one real sentence;
// a flattened link dump of many short Title Case phrases run together never
// contains a single sentence-terminal ".", "!", or "?". A short, genuinely
// curated real service list (e.g. Lakeshore's real <ul class="services-
// list"> of 4 items in a footer) has this same no-terminal-punctuation
// shape, though, and must NOT be rejected — the distinguishing signal is
// length: a real short list stays well under the excerpt cap, while a
// flattened nav-menu dump (many categories' worth of sub-items concatenated
// with no separators) reliably runs all the way to SECTION_EXCERPT_MAX_CHARS
// and gets cut off mid-word there, never a deliberately short real list.
// ===========================================================================

function looksLikeNavDump(section: ContentSection): boolean {
  const nearExcerptCap = section.excerpt.length >= SECTION_EXCERPT_MAX_CHARS - 10;
  return nearExcerptCap && !/[.!?]/.test(section.excerpt);
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
    // Structural detection first: a real nav mega-menu's own offering index
    // is strictly better evidence than a CSS-class-matched body block or the
    // page-level URL/title fallback (see the comment above
    // findServiceMenuStructure) — mergeSections keeps both, deduped, so a
    // site with neither still correctly produces [].
    services: mergeSections([
      findServiceMenuStructure($, sourceUrl),
      findSectionsByKeywords($, ["service", "offering"], sourceUrl).filter((s) => !looksLikeNavDump(s)),
    ]),
    products: findSectionsByKeywords($, ["product", "shop-item", "store-item"], sourceUrl),
    // Structural detection first: a real per-person name+title match is
    // strictly better evidence than a CSS-class-matched block (which is
    // often just a section wrapper with no per-person separation at all on
    // page-builder sites) — mergeSections keeps both, deduped, so a site
    // that legitimately has neither still correctly produces [].
    team: mergeSections([findTeamMembersByStructure($, sourceUrl), findSectionsByKeywords($, ["team", "staff"], sourceUrl)]),
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
    contact: extractContact($, jsonLd, sourceUrl),
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
    menu: findMenuItemsByStructure($, sourceUrl),
    forms: extractForms($),
    maps: extractMaps($),
  };
}

type StructuredFacts = ReturnType<typeof extractStructuredFacts>;

function mergeContactInfo(perPage: ContactInfo[]): ContactInfo {
  const phoneEvidence: PhoneEvidence[] = [];
  const normalizedPhones = new Set<string>();
  const emailEvidence: EmailEvidence[] = [];
  const seenEmails = new Set<string>();
  const emails = new Set<string>();
  let address: string | null = null;
  let addressSource: "json-ld" | "labeled" | undefined;
  let hours: string | null = null;
  let hoursByDay: HoursEntry[] = [];
  for (const c of perPage) {
    for (const item of c.phoneEvidence ?? c.phones.map((phone) => ({ phone, normalized: phone.replace(/\D/g, ""), sourceUrl: "", source: "visible-text" as const }))) {
      if (normalizedPhones.has(item.normalized)) continue;
      normalizedPhones.add(item.normalized);
      phoneEvidence.push(item);
    }
    c.emails.forEach((e) => emails.add(e));
    for (const item of c.emailEvidence ?? []) {
      const key = item.email.trim().toLowerCase();
      if (seenEmails.has(key)) continue;
      seenEmails.add(key);
      emailEvidence.push(item);
    }
    if (!address && c.address) {
      address = c.address;
      addressSource = c.addressSource;
    }
    if (!hours && c.hours) {
      hours = c.hours;
      hoursByDay = c.hoursByDay ?? [];
    }
  }
  return {
    phones: phoneEvidence.slice(0, MAX_CONTACT_ITEMS).map((item) => item.phone),
    ...(phoneEvidence.length > 0 ? { phoneEvidence: phoneEvidence.slice(0, MAX_CONTACT_ITEMS) } : {}),
    emails: [...emails].slice(0, MAX_CONTACT_ITEMS),
    ...(emailEvidence.length > 0 ? { emailEvidence: emailEvidence.slice(0, MAX_CONTACT_ITEMS) } : {}),
    address,
    ...(addressSource ? { addressSource } : {}),
    hours,
    ...(hoursByDay.length > 0 ? { hoursByDay } : {}),
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

/** Merges menu categories across pages by category name, deduping items within a category the same way mergeSections dedupes content sections — a category real on two different pages (e.g. a "Drinks" page and a homepage excerpt) collapses to one, never doubled. */
function mergeMenu(perPage: MenuCategory[][]): MenuCategory[] {
  const categories: MenuCategory[] = [];
  const categoryIndexByName = new Map<string, number>();
  const seenItemKey = new Set<string>();
  for (const pageCategories of perPage) {
    for (const category of pageCategories) {
      let idx = categoryIndexByName.get(category.name);
      if (idx === undefined) {
        if (categories.length >= MAX_MENU_CATEGORIES) continue;
        idx = categories.length;
        categoryIndexByName.set(category.name, idx);
        categories.push({ name: category.name, items: [] });
      }
      for (const item of category.items) {
        if (categories[idx].items.length >= MAX_ITEMS_PER_MENU_CATEGORY) break;
        const key = `${category.name}:${item.name}:${item.price ?? ""}`;
        if (seenItemKey.has(key)) continue;
        seenItemKey.add(key);
        categories[idx].items.push(item);
      }
    }
  }
  return categories.filter((c) => c.items.length > 0);
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
    menu: mergeMenu(pages.map((p) => p.menu)),
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
