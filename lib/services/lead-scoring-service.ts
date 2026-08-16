import type { CrawlRawResult } from "@/lib/adapters/types";

/**
 * lead-scoring-service.ts — the AI Lead Hunter's Opportunity Scoring Agent
 * (docs/MASTER_BLUEPRINT.md: "the Opportunity Scoring Agent = Qualification").
 * Pure, deterministic functions: CrawlRawResult in, scores out — no I/O, no
 * LLM call, mirroring opportunity-scoring-service.ts's own "deterministic
 * v1 scoring, no AI reasoning, no measurements invented beyond what's in
 * [the evidence]" precedent exactly.
 *
 * THREE DISTINCT SCORES, NEVER CONFLATED (CTO Lead Hunter directive §2):
 *
 * - computeWebsiteScore: how good the CURRENT site already is. Deliberately
 *   NOT the same value as website_analyses.opportunity_score (the existing,
 *   full-pipeline Analysis Engine's Lighthouse/accessibility/SEO-adapter-
 *   blended score) — that requires a real Lighthouse/axe run per candidate,
 *   too expensive to pay for on every one of a 50-100-business scan. This
 *   is a cheaper, real, deterministic proxy computed ONLY from the same
 *   CrawlRawResult a single homepage-plus-sub-pages crawl already produces
 *   (lib/adapters/crawl-adapter.ts's runCrawlAdapter) — real signals, not a
 *   guess, but a coarser instrument than the full Analysis Engine on
 *   purpose. A promoted lead still gets the full, expensive analysis via
 *   the existing, unchanged Analysis Engine once it enters the real mission
 *   pipeline (lib/services/analysis-service.ts) — this score's only job is
 *   deciding which ~5 of ~60 candidates deserve that expensive step at all.
 *
 * - computeLeadOpportunityScore: how worthwhile this business is as a
 *   MAKEOVER PROSPECT — website quality alone is explicitly NOT enough
 *   (CTO directive: "Do not rank businesses solely because their website
 *   looks old"). Blends website-quality upside with real legitimacy/
 *   evidence-richness signals (a real address, real contact info, real
 *   services, the crawl actually succeeding) — a bad website on a business
 *   with thin/unverifiable evidence is a worse prospect than a bad website
 *   on a business with a rich, well-evidenced profile, even though both
 *   might have an identical Website Score.
 *
 * - computeConfidenceScore: how much real data Discovery + qualification
 *   actually managed to capture for this candidate — never a confident-
 *   looking number standing in for data that was never captured (the same
 *   discipline opportunity-report-service.ts already holds every category
 *   to: a category whose check failed reads "Unavailable," never a
 *   plausible-looking guess).
 *
 * v1 WEIGHTS, NOT A FINAL ANSWER — same explicit disclosure opportunity-
 * scoring-service.ts's own EQUAL_CATEGORY_WEIGHT constant already carries:
 * nobody has specified how these signals should really be weighted against
 * real makeover-conversion outcomes yet; these are concrete, revisitable
 * starting values the pipeline needs to compute something end-to-end, not a
 * researched final formula.
 */

// ===========================================================================
// Website Score — a cheap, crawl-only proxy (see module comment above).
// ===========================================================================

export interface WebsiteScoreSignal {
  label: string;
  passed: boolean;
  weight: number;
}

export interface WebsiteScoreResult {
  score: number;
  signals: WebsiteScoreSignal[];
}

const MAX_REASONABLE_HTML_BYTES = 1_500_000;

/**
 * computeWebsiteScore — six equally-weighted, cheap structural signals
 * (v1, see module comment). A crawl that failed outright (fetchError set,
 * or no successful statusCode) scores 0 with a single explanatory signal —
 * never a partial, confident-looking score computed from data that was
 * never actually fetched.
 */
export function computeWebsiteScore(crawl: CrawlRawResult): WebsiteScoreResult {
  if (crawl.fetchError || crawl.statusCode === null || crawl.statusCode < 200 || crawl.statusCode >= 400) {
    return {
      score: 0,
      signals: [{ label: "Site reachable", passed: false, weight: 1 }],
    };
  }

  const signals: WebsiteScoreSignal[] = [
    { label: "Site reachable", passed: true, weight: 1 },
    { label: "Has a meta description", passed: !!crawl.metaDescription, weight: 1 },
    { label: "Exactly one H1 (real heading hierarchy)", passed: crawl.headingCounts.h1 === 1, weight: 1 },
    { label: "robots.txt present", passed: crawl.robotsTxtFound, weight: 1 },
    { label: "sitemap.xml present", passed: crawl.sitemapFound, weight: 1 },
    { label: "Page size is not badly bloated", passed: crawl.htmlByteSize > 0 && crawl.htmlByteSize < MAX_REASONABLE_HTML_BYTES, weight: 1 },
  ];

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const earnedWeight = signals.reduce((sum, s) => sum + (s.passed ? s.weight : 0), 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);

  return { score, signals };
}

// ===========================================================================
// Confidence Score — how much real data was actually captured.
// ===========================================================================

export interface ConfidenceScoreResult {
  score: number;
  /** Which of the checked evidence categories were actually found real content for — the honest basis for the score, not just a bare number. */
  evidenceFound: string[];
}

/**
 * computeConfidenceScore — proportion of a fixed set of real-evidence
 * categories this candidate's crawl actually populated. A crawl that
 * failed outright scores 0 confidence — we know nothing real about this
 * candidate, which is itself an honest, real answer.
 */
export function computeConfidenceScore(crawl: CrawlRawResult): ConfidenceScoreResult {
  if (crawl.fetchError) {
    return { score: 0, evidenceFound: [] };
  }

  const checks: { label: string; present: boolean }[] = [
    { label: "phone", present: crawl.contact.phones.length > 0 },
    { label: "address", present: !!crawl.contact.address },
    { label: "email", present: crawl.contact.emails.length > 0 },
    { label: "services", present: crawl.services.length > 0 },
    { label: "meta description", present: !!crawl.metaDescription },
    { label: "reviews", present: crawl.reviews.count !== null || crawl.reviews.averageRating !== null },
    { label: "testimonials", present: crawl.testimonials.length > 0 },
    { label: "gallery", present: crawl.gallery.length > 0 },
  ];

  const evidenceFound = checks.filter((c) => c.present).map((c) => c.label);
  const score = Math.round((evidenceFound.length / checks.length) * 100);

  return { score, evidenceFound };
}

// ===========================================================================
// Lead Opportunity Score — business-worthiness as a makeover prospect.
// ===========================================================================

export interface LegitimacySignal {
  label: string;
  passed: boolean;
}

export interface OpportunityScoreResult {
  score: number;
  websiteScore: number;
  legitimacyScore: number;
  legitimacySignals: LegitimacySignal[];
}

function computeLegitimacyScore(crawl: CrawlRawResult): { score: number; signals: LegitimacySignal[] } {
  if (crawl.fetchError) {
    return { score: 0, signals: [{ label: "Site reachable", passed: false }] };
  }
  const signals: LegitimacySignal[] = [
    { label: "Real phone or email captured", passed: crawl.contact.phones.length > 0 || crawl.contact.emails.length > 0 },
    { label: "Real address captured", passed: !!crawl.contact.address },
    { label: "Real service/offering content found", passed: crawl.services.length > 0 },
    { label: "Site has real internal structure (more than a single orphan page)", passed: crawl.internalLinkCount > 3 },
    { label: "Has a real, non-empty homepage title", passed: !!crawl.title && crawl.title.trim().length > 0 },
  ];
  const score = Math.round((signals.filter((s) => s.passed).length / signals.length) * 100);
  return { score, signals };
}

/**
 * computeLeadOpportunityScore — legitimacy GATES upside, it doesn't just
 * partially offset it (v1 formula, see module comment): score = upside *
 * (legitimacyScore / 100), where upside = 100 - websiteScore. This is the
 * concrete mechanism behind the CTO directive §1 rule "do not rank
 * businesses solely because their website looks old" — a business with a
 * legitimacyScore of 0 (no real phone/email/address/services/internal
 * structure/title found at all) scores 0 opportunity NO MATTER how bad its
 * website looks, because a website this pipeline can't even verify belongs
 * to a real, reachable, evidenced business isn't a credible makeover
 * prospect yet, only a name and a URL. Symmetrically, a business with a
 * genuinely great existing website scores low/zero opportunity regardless
 * of legitimacy — there's no real upside left to sell, which is exactly
 * "worthwhile as a makeover prospect" (not "how good is the business").
 */
export function computeLeadOpportunityScore(crawl: CrawlRawResult): OpportunityScoreResult {
  const { score: websiteScore } = computeWebsiteScore(crawl);
  const { score: legitimacyScore, signals: legitimacySignals } = computeLegitimacyScore(crawl);

  const upside = 100 - websiteScore;
  const score = Math.round(upside * (legitimacyScore / 100));

  return { score, websiteScore, legitimacyScore, legitimacySignals };
}

// ===========================================================================
// Ranking
// ===========================================================================

export interface RankableLead {
  id: string;
  opportunityScore: number | null;
}

/**
 * rankLeads — highest opportunityScore first; a lead with no score yet
 * (qualification didn't complete) sorts last, never treated as a 0 (a real
 * 0 and "we don't know yet" are different facts, same discipline
 * opportunity-scoring-service.ts's own null-vs-zero handling already
 * applies to an unmeasured category).
 */
export function rankLeads<T extends RankableLead>(leads: T[]): T[] {
  return [...leads].sort((a, b) => {
    if (a.opportunityScore === null && b.opportunityScore === null) return 0;
    if (a.opportunityScore === null) return 1;
    if (b.opportunityScore === null) return -1;
    return b.opportunityScore - a.opportunityScore;
  });
}
