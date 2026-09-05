import type { ContactInfo } from "@/lib/adapters/types";

/**
 * lib/services/identity-verification-service.ts — Phase 14
 * (docs/PHASE_14_IDENTITY_VERIFICATION_AUDIT.md,
 * docs/PHASE_14_IMPLEMENTATION_PLAN.md). A confidence/risk gate, not a
 * brittle exact-match rule (Robert's own framing): real businesses
 * legitimately get new phone numbers, move addresses, rebrand domains, or
 * run their whole web presence through a parent company's site or a
 * third-party platform. This module never fails a mission over any single
 * mismatched signal — see resolveIdentityVerdict's own corroboration rule.
 *
 * A pure, deterministic function — no database call, no LLM, no network
 * fetch, same shape as resolveIndustryBucket/generateInsights/every other
 * decision function in this codebase. lib/services/design-brief-service.ts
 * is the one caller; this file has no opinion on what a verdict *does* to a
 * mission (see runDesignBrief's own gate logic for that).
 *
 * "Services have one job each" (CLAUDE.md) — this file never touches
 * lead-scoring-service.ts's opportunity/qualification math,
 * design-qa-service.ts's QA checks, or reference-library.ts's industry-
 * bucket keyword vocabulary. Where a check here resembles one of those
 * (e.g. the content-category signal below), it is a deliberately separate,
 * independent copy — narrower in scope, never a shared import — so this
 * module can never silently change what those protected files do.
 */

export type SignalVerdict = "match" | "mismatch" | "inconclusive";

export interface SignalResult {
  /** One of the eight named signals from docs/PHASE_14_IMPLEMENTATION_PLAN.md §2. */
  signal:
    | "redirect"
    | "business_name"
    | "address"
    | "phone"
    | "json_ld"
    | "domain_brand"
    | "content_category"
    | "redirect_destination";
  verdict: SignalVerdict;
  /** Plain-language reasoning — every claim traces to something checkable, never a bare label (same discipline design-qa-service.ts's own category reasoning already holds itself to). */
  detail: string;
}

export type IdentityVerdict = "confirmed" | "uncertain" | "failed";

export interface IdentityVerificationResult {
  verdict: IdentityVerdict;
  signals: SignalResult[];
  /**
   * Populated only when verdict === "uncertain" — which NormalizedAnalysis
   * fields runDesignBrief should clear to their honest-empty defaults
   * before building citedInsights, per docs/PHASE_14_IMPLEMENTATION_PLAN.md
   * §7. Always empty for "confirmed" (nothing to suppress) and "failed"
   * (the mission never reaches Design Brief construction at all).
   */
  suppressedEvidenceCategories: string[];
}

export interface VerifyBusinessIdentityInput {
  businessName: string;
  /** The mission's own known geography, when available (a batch run's `location`, or a lead's reverse-geocodable lat/long) — independent of anything the crawl itself reports. */
  expectedLocation: { raw: string | null; countryHint: string | null } | null;
  /** DiscoveredBusiness's own OSM-tagged phone (lib/repositories, once leads.discovery_phone is read) — null when no lead exists for this mission, or OSM never had one. Never treated as a mismatch merely for being absent. */
  osmPhone: string | null;
  /** Same as osmPhone, for address. */
  osmAddress: string | null;
  crawl: {
    requestedUrl: string;
    finalUrl: string;
    title: string | null;
    metaDescription: string | null;
    jsonLdName: string | null;
    jsonLdType: string | string[] | null;
    contact: ContactInfo;
  };
}

// ===========================================================================
// Small, disclosed helpers — deliberately narrow, never a claim of full
// correctness beyond what's stated.
// ===========================================================================

/**
 * A small, explicit list of multi-label public suffixes this helper
 * recognizes — NOT a full Public Suffix List. Disclosed limitation, same
 * spirit as crawl-adapter.ts's own "deliberately does NOT attempt price
 * ranges" comment: a registrable-domain guess that's wrong for an
 * unrecognized multi-label TLD (e.g. some ".co.jp" shapes) degrades to
 * treating one label too many as "the registrable domain," which only
 * makes the redirect/domain-brand signals slightly more conservative
 * (more likely to call two different-looking hostnames "different"), never
 * unsafe in the other direction.
 */
const KNOWN_MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "co.nz", "co.za", "co.jp", "co.kr", "co.in",
  "com.au", "net.au", "org.au",
  "com.br", "com.mx",
]);

function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (KNOWN_MULTI_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Recognized business-hosting/ordering platforms a real business legitimately runs its whole web presence through — redirecting to one of these is never itself treated as a structural mismatch (docs/PHASE_14_IMPLEMENTATION_PLAN.md §8). Deliberately narrow and explicit, not a heuristic. */
const THIRD_PARTY_PLATFORM_DOMAINS = new Set([
  "facebook.com", "instagram.com", "linktr.ee",
  "toasttab.com", "squareup.com", "square.site", "clover.com",
  "google.com", // Google Business Profile / Maps listing pages
]);

/** A normalized token set for fuzzy, punctuation/case-insensitive overlap checks — never an exact-string requirement. */
function normalizedTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/&/g, " and ")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3)
  );
}

/** Common generic business-name words that carry no real corroborating signal on their own ("the", "restaurant", "cafe", "inc", "llc", etc.) — excluded so a match isn't claimed on a word most businesses in a category share. */
const GENERIC_NAME_TOKENS = new Set([
  "the", "and", "llc", "inc", "co", "corp", "company",
  "restaurant", "cafe", "cafeteria", "diner", "grill", "bar", "kitchen",
  "shop", "store", "services", "group",
]);

function meaningfulTokens(text: string): Set<string> {
  const tokens = normalizedTokens(text);
  for (const generic of GENERIC_NAME_TOKENS) tokens.delete(generic);
  return tokens;
}

function hasTokenOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) if (b.has(token)) return true;
  return false;
}

/**
 * A small, explicit vocabulary for content categories that essentially
 * never legitimately overlap with a local service business's own website —
 * illegal-streaming, gambling, and pharmaceutical-spam being the well-
 * documented common ones squatted/hijacked domains redirect to (real and
 * demonstrated necessary by the Freight House Cafe case: the crawled
 * title/metaDescription were literally about football livestreams).
 * Deliberately narrow, deterministic, never machine-learned — and per §9 of
 * the implementation plan, never used alone to reach IDENTITY_FAILED.
 */
const SPAM_NETWORK_VOCABULARY = [
  "livestream", "live stream", "trực tiếp", "bóng đá", "xem trực tuyến",
  "casino", "slot machine", "sportsbook", "bet now", "jackpot",
  "cheap viagra", "generic cialis", "buy pills online",
];

/** Domain-parking/for-sale boilerplate — a real, distinct pattern from spam-network content. */
const PARKING_PAGE_PHRASES = [
  "this domain may be for sale", "buy this domain", "domain parking",
  "the owner of this domain", "is parked free", "checkout the",
];

function containsAnyPhrase(haystack: string, phrases: string[]): string | null {
  const lower = haystack.toLowerCase();
  return phrases.find((p) => lower.includes(p)) ?? null;
}

// ===========================================================================
// Individual signal resolution — each one independent, each one resolves to
// match/mismatch/inconclusive on its own, never a shared running score.
// ===========================================================================

/**
 * §6/§10 of the implementation plan: a cross-domain redirect is not itself
 * proof of anything wrong — a legitimate rebrand looks identical at the URL
 * level to a hijacked domain. The redirect signal resolves `match` when the
 * new domain's own content corroborates the business (the rebrand case),
 * `inconclusive` for a recognized third-party platform (§8) regardless of
 * content, and `mismatch` only when the redirect target's content does NOT
 * corroborate the business at all — `businessNameVerdict` (already computed
 * against the crawled title/meta/JSON-LD, which reflect whatever page is
 * actually being served post-redirect) is the corroboration check, passed
 * in rather than recomputed, so there is exactly one place this codebase
 * decides whether the crawled content names the business.
 */
function resolveRedirectSignal(input: VerifyBusinessIdentityInput, businessNameVerdict: SignalVerdict): SignalResult {
  const requestedHost = hostnameOf(input.crawl.requestedUrl);
  const finalHost = hostnameOf(input.crawl.finalUrl);
  if (!requestedHost || !finalHost) {
    return { signal: "redirect", verdict: "inconclusive", detail: "Could not parse requestedUrl/finalUrl as real URLs." };
  }
  const requestedRoot = registrableDomain(requestedHost);
  const finalRoot = registrableDomain(finalHost);
  if (requestedRoot === finalRoot) {
    return { signal: "redirect", verdict: "match", detail: `No cross-domain redirect (${requestedRoot}).` };
  }
  if (THIRD_PARTY_PLATFORM_DOMAINS.has(finalRoot)) {
    return {
      signal: "redirect",
      verdict: "inconclusive",
      detail: `Redirects to ${finalRoot}, a recognized third-party business-hosting platform — not itself treated as suspicious.`,
    };
  }
  if (businessNameVerdict === "match") {
    return {
      signal: "redirect",
      verdict: "match",
      detail: `Redirects to a different registrable domain (${finalRoot}), but its own content names the business — consistent with a legitimate rebrand, not penalized.`,
    };
  }
  return {
    signal: "redirect",
    verdict: "mismatch",
    detail: `requestedUrl (${requestedRoot}) redirects to a different registrable domain (${finalRoot}) whose content does not name the business.`,
  };
}

function resolveBusinessNameSignal(input: VerifyBusinessIdentityInput): SignalResult {
  const nameTokens = meaningfulTokens(input.businessName);
  if (nameTokens.size === 0) {
    return { signal: "business_name", verdict: "inconclusive", detail: "Business name has no distinctive tokens to check for." };
  }
  const sources = [input.crawl.title, input.crawl.metaDescription, input.crawl.jsonLdName].filter(
    (v): v is string => !!v && v.trim().length > 0
  );
  if (sources.length === 0) {
    return { signal: "business_name", verdict: "inconclusive", detail: "No title, meta description, or JSON-LD name to check." };
  }
  const found = sources.some((s) => hasTokenOverlap(nameTokens, normalizedTokens(s)));
  return found
    ? { signal: "business_name", verdict: "match", detail: "Business name (or a distinctive part of it) appears in the crawled title/meta/JSON-LD." }
    : {
        signal: "business_name",
        verdict: "mismatch",
        detail: `Business name does not appear in any of: title (${input.crawl.title ?? "none"}), meta description, or JSON-LD name (${input.crawl.jsonLdName ?? "none"}).`,
      };
}

function resolveJsonLdSignal(input: VerifyBusinessIdentityInput): SignalResult {
  const type = input.crawl.jsonLdType;
  if (!type) {
    return { signal: "json_ld", verdict: "inconclusive", detail: "No schema.org @type declared on the homepage." };
  }
  const types = (Array.isArray(type) ? type : [type]).map((t) => t.toLowerCase());
  const businessShaped = types.some((t) =>
    ["localbusiness", "restaurant", "foodestablishment", "store", "organization", "corporation"].some((known) => t.includes(known))
  );
  const unrelatedShaped = types.some((t) => ["website", "webpage", "videoobject", "newsarticle", "sportsevent", "article"].some((known) => t.includes(known)));
  if (businessShaped) {
    return { signal: "json_ld", verdict: "match", detail: `JSON-LD @type (${types.join(", ")}) is business-shaped.` };
  }
  if (unrelatedShaped) {
    const nameTokens = meaningfulTokens(input.businessName);
    const nameMatches = input.crawl.jsonLdName ? hasTokenOverlap(nameTokens, normalizedTokens(input.crawl.jsonLdName)) : false;
    if (!nameMatches) {
      return {
        signal: "json_ld",
        verdict: "mismatch",
        detail: `JSON-LD @type (${types.join(", ")}) is not business-shaped, and its declared name ("${input.crawl.jsonLdName ?? "none"}") does not match the business.`,
      };
    }
  }
  return { signal: "json_ld", verdict: "inconclusive", detail: `JSON-LD @type (${types.join(", ")}) is not clearly business-shaped or unrelated-shaped.` };
}

function resolveDomainBrandSignal(input: VerifyBusinessIdentityInput): SignalResult {
  const finalHost = hostnameOf(input.crawl.finalUrl);
  if (!finalHost) {
    return { signal: "domain_brand", verdict: "inconclusive", detail: "Could not parse finalUrl." };
  }
  const finalRoot = registrableDomain(finalHost);
  if (THIRD_PARTY_PLATFORM_DOMAINS.has(finalRoot)) {
    return {
      signal: "domain_brand",
      verdict: "inconclusive",
      detail: `${finalRoot} is a recognized third-party platform — its own domain name is never expected to relate to any one business it hosts.`,
    };
  }
  const sld = finalRoot.split(".")[0] ?? "";
  const nameTokens = meaningfulTokens(input.businessName);
  if (nameTokens.size === 0) {
    return { signal: "domain_brand", verdict: "inconclusive", detail: "Business name has no distinctive tokens to check for." };
  }
  const sldTokens = normalizedTokens(sld.replace(/-/g, " "));
  if (hasTokenOverlap(nameTokens, sldTokens) || [...nameTokens].some((t) => sld.includes(t))) {
    return { signal: "domain_brand", verdict: "match", detail: `The domain currently being served (${sld}) textually relates to the business name.` };
  }
  return { signal: "domain_brand", verdict: "mismatch", detail: `The domain currently being served (${sld}) shares no text with the business name.` };
}

function resolveContentCategorySignal(input: VerifyBusinessIdentityInput): SignalResult {
  const text = `${input.crawl.title ?? ""} ${input.crawl.metaDescription ?? ""}`;
  if (text.trim().length === 0) {
    return { signal: "content_category", verdict: "inconclusive", detail: "No title/meta description to check." };
  }
  const spamHit = containsAnyPhrase(text, SPAM_NETWORK_VOCABULARY);
  if (spamHit) {
    return { signal: "content_category", verdict: "mismatch", detail: `Crawled content matches a known unrelated-content-network pattern ("${spamHit}").` };
  }
  return { signal: "content_category", verdict: "inconclusive", detail: "No known unrelated-content-network pattern found (does not by itself confirm the content IS about this business)." };
}

function resolveRedirectDestinationSignal(input: VerifyBusinessIdentityInput, redirectSignal: SignalResult): SignalResult {
  if (redirectSignal.verdict !== "mismatch") {
    return { signal: "redirect_destination", verdict: "inconclusive", detail: "No cross-domain redirect to classify." };
  }
  const text = `${input.crawl.title ?? ""} ${input.crawl.metaDescription ?? ""}`;
  const parkedHit = containsAnyPhrase(text, PARKING_PAGE_PHRASES);
  if (parkedHit) {
    return { signal: "redirect_destination", verdict: "mismatch", detail: `Redirect target matches a domain-parking/for-sale page pattern ("${parkedHit}").` };
  }
  const spamHit = containsAnyPhrase(text, SPAM_NETWORK_VOCABULARY);
  if (spamHit) {
    return { signal: "redirect_destination", verdict: "mismatch", detail: `Redirect target matches a known unrelated-content-network pattern ("${spamHit}").` };
  }
  return { signal: "redirect_destination", verdict: "inconclusive", detail: "Redirect target's content doesn't match a known parked/spam pattern (does not by itself confirm it's legitimate)." };
}

function resolveAddressSignal(input: VerifyBusinessIdentityInput): SignalResult {
  const crawledAddress = input.crawl.contact.address;
  if (!crawledAddress) {
    return { signal: "address", verdict: "inconclusive", detail: "No address was crawled to check." };
  }
  const independentAnchor = input.osmAddress ?? input.expectedLocation?.raw ?? null;
  if (!independentAnchor) {
    return { signal: "address", verdict: "inconclusive", detail: "No independent address or expected location known to check the crawled address against." };
  }
  const anchorTokens = meaningfulTokens(independentAnchor);
  const crawledTokens = meaningfulTokens(crawledAddress);
  if (anchorTokens.size === 0) {
    return { signal: "address", verdict: "inconclusive", detail: "Independent address/location has no distinctive tokens to check for." };
  }
  return hasTokenOverlap(anchorTokens, crawledTokens)
    ? { signal: "address", verdict: "match", detail: `Crawled address ("${crawledAddress}") shares real location tokens with the known/expected location.` }
    : { signal: "address", verdict: "mismatch", detail: `Crawled address ("${crawledAddress}") shares no tokens with the known/expected location ("${independentAnchor}").` };
}

/** A very small set of country hints inferable from a phone number's leading digits — deliberately narrow (not a full E.164 country-code table), sufficient to catch a gross mismatch like a Vietnamese number for a US business. */
function phoneCountryHint(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+1") || (digits.length === 10 && !digits.startsWith("+"))) return "US";
  if (digits.startsWith("+84")) return "VN";
  if (digits.startsWith("+44")) return "GB";
  if (digits.startsWith("+91")) return "IN";
  return null;
}

function resolvePhoneSignal(input: VerifyBusinessIdentityInput): SignalResult {
  const crawledPhones = input.crawl.contact.phones;
  if (crawledPhones.length === 0) {
    return { signal: "phone", verdict: "inconclusive", detail: "No phone number was crawled to check." };
  }
  const expectedCountry = (input.osmPhone && phoneCountryHint(input.osmPhone)) ?? input.expectedLocation?.countryHint ?? null;
  if (!expectedCountry) {
    return { signal: "phone", verdict: "inconclusive", detail: "No independent phone or expected country known to check the crawled phone against." };
  }
  const crawledCountries = crawledPhones.map(phoneCountryHint).filter((c): c is string => !!c);
  if (crawledCountries.length === 0) {
    return { signal: "phone", verdict: "inconclusive", detail: "Could not determine the crawled phone number's own country." };
  }
  return crawledCountries.includes(expectedCountry)
    ? { signal: "phone", verdict: "match", detail: `Crawled phone number's country (${expectedCountry}) matches the expected country.` }
    : { signal: "phone", verdict: "mismatch", detail: `Crawled phone number(s) (${crawledCountries.join(", ")}) do not match the expected country (${expectedCountry}).` };
}

// ===========================================================================
// Combination — corroboration, not counting (docs/PHASE_14_IMPLEMENTATION_PLAN.md §3).
// ===========================================================================

/** Signals capable of independently detecting real content/domain misidentification — FAILED requires at least one of these among its two corroborating mismatches, never two purely "soft" signals (business_name/address/phone/domain_brand) alone, which are each individually explainable by a legitimate rebrand/move/new-number. */
const STRUCTURAL_SIGNALS = new Set<SignalResult["signal"]>(["redirect", "redirect_destination", "content_category", "json_ld"]);

const EVIDENCE_SUPPRESSION_BY_SIGNAL: Partial<Record<SignalResult["signal"], string[]>> = {
  redirect: ["gallery", "contactEvidence"],
  redirect_destination: ["gallery", "contactEvidence"],
  content_category: ["gallery"],
  business_name: ["gallery"],
  address: ["contactEvidence"],
  phone: ["contactEvidence"],
};

export function verifyBusinessIdentity(input: VerifyBusinessIdentityInput): IdentityVerificationResult {
  const businessName = resolveBusinessNameSignal(input);
  const redirect = resolveRedirectSignal(input, businessName.verdict);
  const signals: SignalResult[] = [
    redirect,
    businessName,
    resolveAddressSignal(input),
    resolvePhoneSignal(input),
    resolveJsonLdSignal(input),
    resolveDomainBrandSignal(input),
    resolveContentCategorySignal(input),
    resolveRedirectDestinationSignal(input, redirect),
  ];

  const mismatches = signals.filter((s) => s.verdict === "mismatch");
  const matches = signals.filter((s) => s.verdict === "match");
  const structuralMismatches = mismatches.filter((s) => STRUCTURAL_SIGNALS.has(s.signal));

  const isFailed = mismatches.length >= 2 && structuralMismatches.length >= 1;
  const isConfirmed = !isFailed && matches.length >= 1 && mismatches.length === 0;

  const verdict: IdentityVerdict = isFailed ? "failed" : isConfirmed ? "confirmed" : "uncertain";

  const suppressedEvidenceCategories =
    verdict === "uncertain"
      ? Array.from(new Set(mismatches.flatMap((s) => EVIDENCE_SUPPRESSION_BY_SIGNAL[s.signal] ?? [])))
      : [];

  return { verdict, signals, suppressedEvidenceCategories };
}
