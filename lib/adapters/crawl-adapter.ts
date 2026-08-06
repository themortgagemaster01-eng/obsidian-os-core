import * as cheerio from "cheerio";

import type { CrawlPage, CrawlRawResult } from "@/lib/adapters/types";

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

/**
 * crawl-adapter — fetches the target URL and its immediate structure
 * (docs/SPRINT_3_DESIGN_REVIEW.md §1): the homepage itself, its links
 * (internal/external counts), and a small bounded sample of same-domain
 * pages linked from the homepage. This is deliberately NOT a recursive
 * site crawl — v1 needs "does this business have a real, navigable site,"
 * not a full sitemap.
 *
 * Pure function: no Supabase, no mission concept, just a URL in and a raw
 * result out — reusable by any future sprint that needs "go fetch this
 * site's structure" independent of the Analysis Engine.
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
  };
}
