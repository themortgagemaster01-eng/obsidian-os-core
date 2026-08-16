import type { IndustryBucket } from "@/lib/design-references/reference-library";

/**
 * discovery-adapter.ts — the AI Lead Hunter's Discovery Engine I/O layer
 * (docs/MASTER_BLUEPRINT.md: "Discovery Engine (finds businesses with poor
 * websites — real scraping/search logic, not a stub)," named as a future
 * subsystem since Sprint 2, never built until now). Adapters are I/O only
 * (CLAUDE.md) — this module fetches real, public business-listing data and
 * returns it raw; it never scores, ranks, or judges a candidate. That's
 * lib/services/lead-scoring-service.ts's job, one layer up, mirroring the
 * same Crawl/SEO/Lighthouse-adapter-vs-analysis-service split this codebase
 * already holds every other evidence source to.
 *
 * Real, keyless, ToS-compliant source: OpenStreetMap's public Nominatim
 * (geocoding) and Overpass (business-listing query) APIs. Chosen
 * specifically because Robert has no Google Places/Yelp Fusion API key
 * configured (.env.local has no business-directory credential at all) —
 * OSM's data is openly licensed (ODbL) and its public API terms permit this
 * kind of low-volume, identified, rate-limited use, unlike scraping Google/
 * Yelp search results directly (against those platforms' own terms of
 * service — deliberately not built). A future paid provider (Google
 * Places, Yelp Fusion) can be added as a second BusinessDiscoveryProvider-
 * shaped module without changing lib/services/lead-hunter-service.ts's own
 * orchestration, which depends only on the DiscoveredBusiness shape below,
 * never on OSM specifically.
 *
 * Coverage is real but uneven — OSM tagging density (name/website/phone)
 * varies a lot by region and business type, honestly surfaced downstream
 * as this candidate's own Confidence Score (lead-scoring-service.ts), never
 * backfilled with a guess.
 */

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const OVERPASS_BASE_URL = "https://overpass-api.de/api/interpreter";
/**
 * Nominatim's published usage policy caps public, keyless use at 1
 * request/second and specifically asks for "a valid HTTP Referer or
 * User-Agent identifying the application, and preferably a way to contact
 * you (e.g. an email address)" — both honored here, the same "don't hammer,
 * don't hide" discipline lib/adapters/crawl-adapter.ts already applies to
 * every business site it crawls. The exact string matters in practice, not
 * just in policy: confirmed live against both APIs that a UA following the
 * "Mozilla/5.0 (compatible; ...)" convention (common for identifying an
 * automated bot) gets rejected with 406 by both services' Apache front
 * ends, while this plain "<name>/<version> (contact: <email>)" form — the
 * literal shape Nominatim's own docs request — is accepted.
 */
const USER_AGENT = "ObsidianOS/1.0 (contact: themortgagemaster01@gmail.com)";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESULTS_CAP = 200;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Both Nominatim and Overpass's Apache front ends reject a request with
    // no "Accept" header at all (406 Not Acceptable) — Node's fetch doesn't
    // set one by default the way a browser does, confirmed against the
    // real live API during this adapter's own validation.
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...(init?.headers ?? {}) },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export interface GeocodedArea {
  displayName: string;
  latitude: number;
  longitude: number;
  /** [south, north, west, east] — Nominatim's own bounding box for the matched place, used to scope the Overpass query to a real geographic area rather than a fixed-radius guess. */
  boundingBox: [number, number, number, number];
}

/**
 * geocodeLocation — resolves a free-text place name ("Kitchener, Ontario")
 * to a real bounding box via Nominatim. Returns null (never throws, never
 * guesses coordinates) when the place doesn't resolve — an honest "we don't
 * know where that is" the caller must handle, not a fabricated location.
 */
export async function geocodeLocation(location: string): Promise<GeocodedArea | null> {
  const url = `${NOMINATIM_BASE_URL}/search?format=json&limit=1&q=${encodeURIComponent(location)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const results = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
    boundingbox: [string, string, string, string];
  }>;
  if (results.length === 0) return null;
  const match = results[0];
  return {
    displayName: match.display_name,
    latitude: parseFloat(match.lat),
    longitude: parseFloat(match.lon),
    boundingBox: match.boundingbox.map((v) => parseFloat(v)) as [number, number, number, number],
  };
}

/**
 * The OSM tag vocabulary a real business is commonly tagged with, grouped
 * by this codebase's own IndustryBucket (lib/design-references/reference-
 * library.ts) — a generalizable category->tag mapping, never a specific
 * business name or URL. Coverage is a starting set, not exhaustive; a
 * caller can also pass raw `osmTags` directly (see DiscoverBusinessesInput)
 * for a category this table doesn't yet cover.
 */
export const OSM_TAGS_BY_INDUSTRY_BUCKET: Record<IndustryBucket, string[]> = {
  restaurant: ['amenity=restaurant', 'amenity=cafe', 'amenity=fast_food', 'amenity=bar'],
  lawFirm: ["office=lawyer"],
  dentistMedical: ["amenity=dentist", "healthcare=dentist", "amenity=clinic"],
  homeService: ["craft=hvac", "craft=electrician", "craft=plumber", "craft=gardener", "shop=doityourself"],
  realEstate: ["office=estate_agent"],
  fitness: ["leisure=fitness_centre", "leisure=sports_centre"],
  luxuryServices: ["shop=jewelry", "craft=tailor", "shop=beauty"],
  general: ["office=company", "shop=yes"],
} as const;

const INDUSTRY_BUCKET_BY_OSM_TAG: Record<string, IndustryBucket> = Object.fromEntries(
  Object.entries(OSM_TAGS_BY_INDUSTRY_BUCKET).flatMap(([bucket, tags]) => tags.map((tag) => [tag, bucket as IndustryBucket]))
);

/**
 * The authoritative reverse of OSM_TAGS_BY_INDUSTRY_BUCKET — a direct
 * table lookup, not a fuzzy keyword match against the tag's own value (an
 * OSM tag value like "estate_agent" or "jewelry" doesn't reliably contain
 * the same substrings lib/design-references/reference-library.ts's own
 * resolveIndustryBucket keyword list expects, e.g. "real estate"/"luxury"
 * — round-tripping through that classifier would silently misclassify a
 * real, confidently-tagged OSM candidate as "general"). Returns "general"
 * for a tag this table doesn't cover, the same safe-default discipline
 * resolveIndustryBucket itself already uses.
 */
export function industryBucketFromOsmTag(osmTag: string): IndustryBucket {
  return INDUSTRY_BUCKET_BY_OSM_TAG[osmTag] ?? "general";
}

export interface DiscoverBusinessesInput {
  /** A resolved area from geocodeLocation — the query's real geographic scope, never a fixed-radius guess around a raw lat/lon the caller typed in. */
  area: GeocodedArea;
  /** IndustryBucket-derived OSM tags (OSM_TAGS_BY_INDUSTRY_BUCKET) to search for; when omitted, osmTags must be supplied instead. */
  industryBuckets?: IndustryBucket[];
  /** Raw `key=value` OSM tags, for a category OSM_TAGS_BY_INDUSTRY_BUCKET doesn't cover — additive with industryBuckets, never a replacement for the generalizable mapping when one exists. */
  osmTags?: string[];
  /** Hard cap on how many raw OSM elements to request — lead-hunter-service.ts's own scan-size config (CTO directive §1: "make scan size configurable"), clamped here to MAX_RESULTS_CAP so a misconfigured huge scan can't produce an unbounded Overpass query. */
  maxResults?: number;
}

export interface DiscoveredBusiness {
  /** "<osm type>/<osm id>" — the real dedupe key persisted as leads.discovery_external_id (supabase/migrations/0018_lead_hunter.sql). */
  externalId: string;
  name: string;
  /** Real, only when OSM's own website/contact:website tag was present — never guessed from the business name. */
  websiteUrl: string | null;
  phone: string | null;
  /** The literal matched OSM tag ("amenity=restaurant") — lead-hunter-service.ts maps this back to an IndustryBucket; kept raw here since this adapter never classifies, only reports what it found. */
  osmTag: string;
  address: string | null;
  latitude: number;
  longitude: number;
}

/** Exported for direct unit testing of parseOverpassElements against a real, captured response shape, same precedent as crawl-adapter.ts's own raw-response types. */
export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function buildOverpassQuery(area: GeocodedArea, tags: string[], maxResults: number): string {
  const [south, north, west, east] = area.boundingBox;
  const bbox = `${south},${west},${north},${east}`;
  const clauses = tags
    .map((tag) => {
      const [key, value] = tag.split("=");
      const tagFilter = value === "yes" || value === "*" ? `["${key}"]` : `["${key}"="${value}"]`;
      return `  node${tagFilter}(${bbox});\n  way${tagFilter}(${bbox});`;
    })
    .join("\n");
  return `[out:json][timeout:25];\n(\n${clauses}\n);\nout center tags ${maxResults};`;
}

function addressFromTags(tags: Record<string, string>): string | null {
  const parts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(
    (p): p is string => !!p
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

function normalizeWebsiteTag(tags: Record<string, string>): string | null {
  const raw = tags.website ?? tags["contact:website"] ?? null;
  if (!raw) return null;
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

/**
 * discoverBusinesses — real Overpass query against a real geocoded area,
 * parsed into DiscoveredBusiness[]. Never returns more than maxResults
 * (clamped to MAX_RESULTS_CAP); returns [] (never throws past a real fetch
 * failure being surfaced) when the query genuinely finds nothing — an
 * honest empty scan, the same discipline crawl-adapter.ts's own extractors
 * hold to when a page has no matching content.
 */
export async function discoverBusinesses(input: DiscoverBusinessesInput): Promise<DiscoveredBusiness[]> {
  const maxResults = Math.min(input.maxResults ?? 60, MAX_RESULTS_CAP);
  const tags = [
    ...(input.industryBuckets ?? []).flatMap((bucket) => OSM_TAGS_BY_INDUSTRY_BUCKET[bucket] ?? []),
    ...(input.osmTags ?? []),
  ];
  if (tags.length === 0) {
    throw new Error("discoverBusinesses requires at least one of industryBuckets or osmTags to search for.");
  }
  const uniqueTags = [...new Set(tags)];

  const query = buildOverpassQuery(input.area, uniqueTags, maxResults);
  const res = await fetchWithTimeout(OVERPASS_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass API request failed (${res.status}): ${await res.text().catch(() => res.statusText)}`);
  }
  const body = (await res.json()) as { elements: OverpassElement[] };

  return parseOverpassElements(body.elements, uniqueTags).slice(0, maxResults);
}

/** Exported separately from discoverBusinesses for direct unit testing against a real, saved Overpass response fixture — same precedent as crawl-adapter.ts's extractStructuredFacts being tested against real HTML fixtures rather than only through a live network call. */
export function parseOverpassElements(elements: OverpassElement[], searchedTags: string[]): DiscoveredBusiness[] {
  const results: DiscoveredBusiness[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name;
    if (!name) continue; // An unnamed element is not a usable candidate business — never invents a name.

    const externalId = `${el.type}/${el.id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;

    const matchedTag = searchedTags.find((tag) => {
      const [key, value] = tag.split("=");
      return value === "yes" || value === "*" ? key in tags : tags[key] === value;
    });

    results.push({
      externalId,
      name,
      websiteUrl: normalizeWebsiteTag(tags),
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      osmTag: matchedTag ?? "unknown",
      address: addressFromTags(tags),
      latitude: lat,
      longitude: lon,
    });
  }

  return results;
}
