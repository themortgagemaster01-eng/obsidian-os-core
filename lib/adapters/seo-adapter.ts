import * as cheerio from "cheerio";

import type { SeoRawResult } from "@/lib/adapters/types";

const FETCH_TIMEOUT_MS = 15_000;
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

function extractStructuredDataTypes($: cheerio.CheerioAPI): string[] {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        const type = entry?.["@type"];
        if (typeof type === "string") types.add(type);
        else if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && types.add(t));
      }
    } catch {
      // Malformed JSON-LD — skip rather than fail the whole adapter.
    }
  });
  return Array.from(types);
}

/**
 * seo-adapter — on-page SEO signals (docs/SPRINT_3_DESIGN_REVIEW.md §1,
 * §8: the SEO category's data source, distinct from Lighthouse's SEO
 * category). Static HTML analysis: title/meta description presence and
 * length, canonical tag, H1 count, image alt-text coverage, structured
 * data (JSON-LD) types present, Open Graph tag coverage, and a
 * robots-noindex check that would otherwise silently keep a site out of
 * search results.
 *
 * Pure function: URL in, raw findings out.
 */
export async function runSeoAdapter(targetUrl: string): Promise<SeoRawResult> {
  let response: Response;
  let html: string;
  try {
    response = await fetchWithTimeout(targetUrl);
    html = await response.text();
  } catch (err) {
    return {
      title: null,
      titleLength: 0,
      metaDescription: null,
      metaDescriptionLength: 0,
      canonicalUrl: null,
      h1Count: 0,
      imageCount: 0,
      imagesMissingAlt: 0,
      structuredDataTypes: [],
      openGraphTagCount: 0,
      hasRobotsNoindex: false,
      fetchError: err instanceof Error ? err.message : "Failed to fetch target URL",
    };
  }

  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const canonicalUrl = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const h1Count = $("h1").length;

  const images = $("img");
  const imageCount = images.length;
  const imagesMissingAlt = images
    .filter((_, el) => {
      const alt = $(el).attr("alt");
      return alt === undefined || alt.trim() === "";
    })
    .toArray().length;

  const structuredDataTypes = extractStructuredDataTypes($);
  const openGraphTagCount = $('meta[property^="og:"]').length;

  const robotsContent = $('meta[name="robots"]').attr("content") ?? "";
  const hasRobotsNoindex = /noindex/i.test(robotsContent);

  return {
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? 0,
    canonicalUrl,
    h1Count,
    imageCount,
    imagesMissingAlt,
    structuredDataTypes,
    openGraphTagCount,
    hasRobotsNoindex,
  };
}
