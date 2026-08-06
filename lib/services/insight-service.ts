import type { AnalysisCategory, NormalizedAnalysis } from "@/lib/services/analysis-types";

export type InsightSeverity = "low" | "medium" | "high";

/**
 * A single business-language observation derived from one measurement
 * (docs/SPRINT_3_DESIGN_REVIEW.md §10: every insight traces to a specific
 * measurement). `source` is deliberately plain-language, not a tool/vendor
 * name — the report must never leak implementation terminology ("no raw
 * JSON, no 'Lighthouse', no internal score names, no adapter names in
 * anything user-facing"), and that applies to the Evidence section too
 * (§6.8), not just the narrative sections. Specificity for traceability
 * comes from `statement` (which names exactly what was found) plus
 * `source` naming *which check* found it in plain terms — not from naming
 * the underlying tool.
 */
export interface Insight {
  id: string;
  category: AnalysisCategory;
  severity: InsightSeverity;
  statement: string;
  source: string;
}

type ScoreBand = "good" | "moderate" | "poor" | "unknown";

function scoreBand(score: number | null): ScoreBand {
  if (score === null) return "unknown";
  if (score >= 90) return "good";
  if (score >= 70) return "moderate";
  return "poor";
}

const SOURCE = {
  performance: "Page speed test",
  mobile: "Mobile display check",
  seo: "Search visibility check",
  accessibility: "Accessibility scan",
  technicalHealth: "Website health check",
} as const;

/**
 * Every statement below is written to the Phase 2 product bar: it should
 * read like a senior digital consultant wrote it, not a website-auditing
 * tool, and should implicitly answer three questions — what was found,
 * why it matters to the business, and what improves if it's fixed. No
 * jargon (no "Lighthouse," "H1," "viewport," "canonical," etc.) — every
 * technical concept is translated into what a non-technical business
 * owner would actually care about.
 */

// ---------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------

function performanceInsights(a: NormalizedAnalysis): Insight[] {
  const band = scoreBand(a.lighthouse.performance);
  if (band === "good" || band === "unknown") return [];

  const statement =
    band === "poor"
      ? "Pages on this site load significantly slower than what visitors expect today. Slow-loading pages are one of the most common reasons a visitor leaves before ever contacting a business, which can mean lost calls and inquiries."
      : "Pages load a bit slower than ideal. Even small delays can cause some visitors — especially those on mobile — to give up and move on to a competitor.";

  return [
    {
      id: "slow-page-load",
      category: "performance",
      severity: band === "poor" ? "high" : "medium",
      statement,
      source: SOURCE.performance,
    },
  ];
}

// ---------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------

function mobileInsights(a: NormalizedAnalysis): Insight[] {
  const insights: Insight[] = [];
  const band = scoreBand(a.mobileScore);

  if (band === "poor" || band === "moderate") {
    insights.push({
      id: "mobile-experience-gap",
      category: "mobile",
      severity: band === "poor" ? "high" : "medium",
      statement:
        band === "poor"
          ? "The site isn't set up to display properly on phones and tablets, where most visitors are likely browsing from. A cramped or hard-to-use mobile experience often drives potential customers away before they ever see what the business offers."
          : "The site's mobile experience has some rough edges. Since most visitors browse from a phone, even small friction points can cost the business inquiries.",
      source: SOURCE.mobile,
    });
  }

  for (const finding of a.mobileFindings) {
    if (finding.includes("No viewport meta tag found")) {
      insights.push({
        id: "missing-mobile-display-setup",
        category: "mobile",
        severity: "high",
        statement:
          "The site has no settings telling phones and tablets how to properly display the page, so it likely renders as a shrunken, hard-to-use version of the desktop site. This is often the single biggest reason a mobile visitor leaves within seconds.",
        source: SOURCE.mobile,
      });
    } else if (finding.includes("disables user zoom")) {
      insights.push({
        id: "mobile-zoom-disabled",
        category: "mobile",
        severity: "medium",
        statement:
          "Visitors are blocked from zooming in on the site. This frustrates users — especially anyone with vision difficulties — and can push them to a competitor's site instead.",
        source: SOURCE.mobile,
      });
    } else if (finding.includes("No responsive breakpoints")) {
      insights.push({
        id: "no-responsive-layout",
        category: "mobile",
        severity: "medium",
        statement:
          "The site's layout doesn't adjust to fit different screen sizes. On a phone, this usually means text and buttons that are too small or a layout that's awkward to navigate.",
        source: SOURCE.mobile,
      });
    } else if (finding.includes("font-size declaration")) {
      insights.push({
        id: "small-mobile-text",
        category: "mobile",
        severity: "low",
        statement:
          "Some text on the site is small enough to be hard to read on a phone without zooming in, which makes the site feel less polished and harder to use.",
        source: SOURCE.mobile,
      });
    }
  }

  return insights;
}

// ---------------------------------------------------------------------
// SEO / search visibility
// ---------------------------------------------------------------------

function seoInsights(a: NormalizedAnalysis): Insight[] {
  const insights: Insight[] = [];
  const band = scoreBand(a.seoScore);

  if (band === "poor" || band === "moderate") {
    insights.push({
      id: "search-visibility-gap",
      category: "seo",
      severity: band === "poor" ? "high" : "medium",
      statement:
        band === "poor"
          ? "Search engines currently have a hard time understanding what this website is about. That typically means the business shows up less often — or not at all — when local customers search for what it offers."
          : "There are some gaps in how well search engines can understand and rank this site, which is likely limiting how many potential customers find it through search.",
      source: SOURCE.seo,
    });
  }

  for (const finding of a.seoFindings) {
    if (finding.includes("marked noindex")) {
      insights.push({
        id: "site-hidden-from-search",
        category: "seo",
        severity: "high",
        statement:
          "The site is currently telling search engines not to show it in results at all. This is a critical issue — right now, this page can't be found through a Google search no matter how well it would otherwise rank.",
        source: SOURCE.seo,
      });
    } else if (finding.includes("Missing <title>")) {
      insights.push({
        id: "missing-page-title",
        category: "seo",
        severity: "high",
        statement:
          "The homepage is missing a title, one of the strongest signals search engines use to understand what a page is about and decide when to show it in results. Fixing this is one of the fastest ways to improve search visibility.",
        source: SOURCE.seo,
      });
    } else if (finding.includes("Missing meta description")) {
      insights.push({
        id: "missing-search-summary",
        category: "seo",
        severity: "medium",
        statement:
          "There's no summary text for search engines to show under this site's listing in search results, so Google is left to guess. A clear, written summary usually earns more clicks from people already searching for this kind of business.",
        source: SOURCE.seo,
      });
    } else if (finding.includes("No H1 heading found")) {
      insights.push({
        id: "unclear-main-topic",
        category: "seo",
        severity: "medium",
        statement:
          "The homepage doesn't clearly communicate its primary topic to search engines. This can reduce online visibility and makes it harder for visitors to quickly understand what the business does.",
        source: SOURCE.seo,
      });
    } else if (/H1 headings found/.test(finding)) {
      insights.push({
        id: "multiple-main-topics",
        category: "seo",
        severity: "low",
        statement:
          "The homepage sends mixed signals about its main topic, which can slightly weaken how well it ranks for the business's core services.",
        source: SOURCE.seo,
      });
    } else if (/images are missing alt text/.test(finding)) {
      insights.push({
        id: "images-missing-descriptions",
        category: "seo",
        severity: "medium",
        statement:
          "Several images on the site have no description behind them. This hurts accessibility for visitors using screen readers and means those images can't be found through image search — a missed source of extra traffic.",
        source: SOURCE.seo,
      });
    } else if (finding.includes("No canonical URL")) {
      insights.push({
        id: "duplicate-page-signal-risk",
        category: "seo",
        severity: "low",
        statement:
          "A minor technical detail is missing that can occasionally cause search engines to split ranking credit across duplicate versions of the same page, slightly diluting search performance.",
        source: SOURCE.seo,
      });
    } else if (finding.includes("No structured data")) {
      insights.push({
        id: "no-rich-search-results",
        category: "seo",
        severity: "low",
        statement:
          "The site isn't using a format that helps search engines display richer, more eye-catching results — like hours or ratings shown directly in search. Adding it is a low-effort way to stand out from competitors in search results.",
        source: SOURCE.seo,
      });
    } else if (finding.includes("No Open Graph")) {
      insights.push({
        id: "no-social-share-preview",
        category: "seo",
        severity: "low",
        statement:
          "When someone shares this site on social media, it won't show a preview image or description — just a bare link. That makes shared links look less trustworthy and less likely to be clicked.",
        source: SOURCE.seo,
      });
    }
  }

  return insights;
}

// ---------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------

function accessibilityInsights(a: NormalizedAnalysis): Insight[] {
  const insights: Insight[] = [];
  const band = scoreBand(a.accessibilityScore);
  const highImpactCount = a.accessibilityFindings.filter((f) =>
    /^\[(critical|serious)\]/.test(f)
  ).length;

  if (band === "poor" || band === "moderate") {
    insights.push({
      id: "accessibility-barriers",
      category: "accessibility",
      severity: band === "poor" ? "high" : "medium",
      statement:
        band === "poor"
          ? "This site has significant barriers for visitors with disabilities — for example, people using screen readers or navigating by keyboard may not be able to use large parts of it at all. Beyond excluding real customers, this also creates legal risk under accessibility laws like the ADA."
          : "This site has some accessibility gaps that could make it harder for visitors with disabilities to use comfortably. Addressing these both grows the pool of customers who can use the site and reduces legal risk.",
      source: SOURCE.accessibility,
    });
  }

  if (highImpactCount > 0) {
    insights.push({
      id: "accessibility-high-impact-issues",
      category: "accessibility",
      severity: "high",
      statement: `${highImpactCount} of the issues found are severe enough that they could stop someone from completing a task on the site entirely — for example, submitting a contact form or finding a phone number. These are the highest-priority fixes.`,
      source: SOURCE.accessibility,
    });
  }

  return insights;
}

// ---------------------------------------------------------------------
// Technical health
// ---------------------------------------------------------------------

function technicalHealthInsights(a: NormalizedAnalysis): Insight[] {
  const insights: Insight[] = [];
  const band = scoreBand(a.technicalHealthScore);

  if (band === "poor" || band === "moderate") {
    insights.push({
      id: "technical-health-gap",
      category: "technicalHealth",
      severity: band === "poor" ? "high" : "medium",
      statement:
        band === "poor"
          ? "This site has underlying technical problems that go beyond how it looks. Left alone, these can quietly hurt search rankings and make the site less reliable for visitors."
          : "A few technical loose ends were found. They're not urgent on their own, but cleaning them up removes small drags on search performance and reliability.",
      source: SOURCE.technicalHealth,
    });
  }

  for (const finding of a.technicalHealthFindings) {
    if (finding.includes("HTTP status")) {
      insights.push({
        id: "site-not-loading-normally",
        category: "technicalHealth",
        severity: "high",
        statement:
          "When tested, the homepage didn't load normally — visitors or search engines may be encountering an error instead of the actual site. This should be treated as urgent, since it can mean the site is effectively unreachable for some visitors.",
        source: SOURCE.technicalHealth,
      });
    } else if (finding.includes("robots.txt")) {
      insights.push({
        id: "missing-search-crawl-settings",
        category: "technicalHealth",
        severity: "low",
        statement:
          "A small standard file that guides how search engines explore the site is missing. On its own this is minor, but it's a quick, easy fix.",
        source: SOURCE.technicalHealth,
      });
    } else if (finding.includes("sitemap.xml")) {
      insights.push({
        id: "missing-sitemap",
        category: "technicalHealth",
        severity: "low",
        statement:
          "There's no file helping search engines find and index every page on the site. Without it, some pages may take longer to show up in search or be missed entirely.",
        source: SOURCE.technicalHealth,
      });
    } else if (finding.includes("No internal links")) {
      insights.push({
        id: "no-site-navigation-links",
        category: "technicalHealth",
        severity: "medium",
        statement:
          "The homepage doesn't link to any other pages on the site. This can strand visitors with nowhere obvious to click next, and makes it harder for search engines to discover the rest of the site.",
        source: SOURCE.technicalHealth,
      });
    }
  }

  return insights;
}

/**
 * generateInsights — the single entry point insight-service.ts exposes.
 * Pure function: NormalizedAnalysis in, Insight[] out. No adapters, no
 * database, no knowledge of scoring or report layout — translation only,
 * per docs/SPRINT_3_DESIGN_REVIEW.md §1 ("one job only: translate technical
 * findings into plain business language").
 */
export function generateInsights(analysis: NormalizedAnalysis): Insight[] {
  return [
    ...performanceInsights(analysis),
    ...mobileInsights(analysis),
    ...seoInsights(analysis),
    ...accessibilityInsights(analysis),
    ...technicalHealthInsights(analysis),
  ];
}
