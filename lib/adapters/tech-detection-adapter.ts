import type { DetectedTechnology, TechDetectionRawResult } from "@/lib/adapters/types";

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

interface Signature {
  name: string;
  category: DetectedTechnology["category"];
  confidence: DetectedTechnology["confidence"];
  test: (html: string, headers: Headers) => boolean;
}

// Deliberately simple string/regex signatures rather than a full
// fingerprinting library (e.g. Wappalyzer) for v1 — cheap, dependency-light,
// and covers the platforms Obsidian OS's target businesses overwhelmingly
// run on. Each signature only claims "high" confidence when the marker is
// close to unambiguous (e.g. a CMS-specific generator meta tag); shared
// markers (e.g. generic CDN scripts) are scored "medium"/"low".
const SIGNATURES: Signature[] = [
  {
    name: "WordPress",
    category: "cms",
    confidence: "high",
    test: (html) => /wp-content|wp-includes/i.test(html) || /generator"\s+content="WordPress/i.test(html),
  },
  {
    name: "Shopify",
    category: "ecommerce",
    confidence: "high",
    test: (html) => /cdn\.shopify\.com|Shopify\.shop/i.test(html),
  },
  {
    name: "Wix",
    category: "cms",
    confidence: "high",
    test: (html) => /static\.wixstatic\.com|wix-code/i.test(html),
  },
  {
    name: "Squarespace",
    category: "cms",
    confidence: "high",
    test: (html) => /squarespace-cdn\.com|generator"\s+content="Squarespace/i.test(html),
  },
  {
    name: "Webflow",
    category: "cms",
    confidence: "high",
    test: (html) => /webflow\.js|data-wf-site/i.test(html),
  },
  {
    name: "Next.js",
    category: "framework",
    confidence: "high",
    test: (html) => /__NEXT_DATA__|\/_next\/static\//i.test(html),
  },
  {
    name: "React",
    category: "framework",
    confidence: "medium",
    test: (html) => /data-reactroot|data-reactid/i.test(html),
  },
  {
    name: "Google Analytics",
    category: "analytics",
    confidence: "high",
    test: (html) => /googletagmanager\.com\/gtag|google-analytics\.com\/analytics\.js/i.test(html),
  },
  {
    name: "Meta Pixel",
    category: "analytics",
    confidence: "high",
    test: (html) => /connect\.facebook\.net\/.*fbevents\.js/i.test(html),
  },
  {
    name: "Cloudflare",
    category: "hosting",
    confidence: "medium",
    test: (_html, headers) => /cloudflare/i.test(headers.get("server") ?? ""),
  },
];

/**
 * tech-detection-adapter — lightweight technology-stack fingerprinting
 * (docs/SPRINT_3_DESIGN_REVIEW.md §1, §8: a contributor, alongside crawl-
 * adapter, to the Technical Health category). Fetches the homepage once
 * and matches its HTML plus response headers against a small, named
 * signature list — CMS, framework, ecommerce platform, hosting/CDN, and
 * common analytics tags. Not a full fingerprinting library; v1 favors a
 * short, honest, explainable list over broad but noisy coverage.
 *
 * Pure function: URL in, raw findings out.
 */
export async function runTechDetectionAdapter(targetUrl: string): Promise<TechDetectionRawResult> {
  let response: Response;
  let html: string;
  try {
    response = await fetchWithTimeout(targetUrl);
    html = await response.text();
  } catch (err) {
    return {
      technologies: [],
      serverHeader: null,
      poweredByHeader: null,
      fetchError: err instanceof Error ? err.message : "Failed to fetch target URL",
    };
  }

  const technologies: DetectedTechnology[] = SIGNATURES.filter((sig) =>
    sig.test(html, response.headers)
  ).map((sig) => ({ name: sig.name, category: sig.category, confidence: sig.confidence }));

  return {
    technologies,
    serverHeader: response.headers.get("server"),
    poweredByHeader: response.headers.get("x-powered-by"),
  };
}
