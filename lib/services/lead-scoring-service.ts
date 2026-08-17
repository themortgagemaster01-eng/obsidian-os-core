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

export type EvidenceQuality = "high" | "medium" | "low" | "none";

export interface ConfidenceCategoryResult {
  label: string;
  quality: EvidenceQuality;
  /** Why this tier — real, evidence-cited, never a bare label (CLAUDE.md's "confidence ratings are mandatory... a reason" principle, applied one level deeper than the aggregate score). */
  reason: string;
}

/** v1 weights, not a final answer (see module comment) — high/medium/low/none map to 100/60/25/0%, not a straight present-or-not binary. */
const QUALITY_WEIGHT: Record<EvidenceQuality, number> = { high: 1, medium: 0.6, low: 0.25, none: 0 };

export interface ConfidenceScoreResult {
  score: number;
  /** Which of the checked evidence categories were found at all (quality !== "none") — kept for existing callers ("N/8 real evidence categories captured" etc.). `categories` below is the real basis for the score. */
  evidenceFound: string[];
  categories: ConfidenceCategoryResult[];
}

/**
 * Phone/email quality (CTO Phase 3.5 directive §4-5: "whether structured
 * data backs it up, whether directly observed vs inferred"). Reuses
 * PhoneEvidence/EmailEvidence's own real source tracking (crawl-adapter.ts)
 * — a tel:/mailto: link or JSON-LD entry is a deliberate, structural site
 * element (directly observed); a number/address only matched by loose
 * regex scanning of the page's visible text is inferred, and stays low
 * confidence even though it's still real, honestly-found evidence.
 */
function phoneQuality(crawl: CrawlRawResult): ConfidenceCategoryResult {
  if (crawl.contact.phones.length === 0) return { label: "phone", quality: "none", reason: "No phone number found by any method." };
  const direct = (crawl.contact.phoneEvidence ?? []).some((e) => e.source === "tel-link" || e.source === "json-ld");
  return direct
    ? { label: "phone", quality: "high", reason: "Confirmed via a real tel: link or structured JSON-LD data — directly observed, not inferred." }
    : { label: "phone", quality: "low", reason: "Only matched via loose text pattern-matching on the page body — no tel: link or structured data corroborates it." };
}

function emailQuality(crawl: CrawlRawResult): ConfidenceCategoryResult {
  if (crawl.contact.emails.length === 0) return { label: "email", quality: "none", reason: "No email address found by any method." };
  const direct = (crawl.contact.emailEvidence ?? []).some((e) => e.source === "mailto-link" || e.source === "json-ld");
  return direct
    ? { label: "email", quality: "high", reason: "Confirmed via a real mailto: link or structured JSON-LD data — directly observed, not inferred." }
    : { label: "email", quality: "low", reason: "Only matched via loose text pattern-matching on the page body — no mailto: link or structured data corroborates it." };
}

/** Address quality: JSON-LD is directly observed (high); a real, explicitly-labeled DOM element ("Address: ...") is a deliberate site element but hand-authored, not machine-structured (medium) — crawl-adapter.ts's extractAddress has no unlabeled-inference fallback the way hours does, so there is no "low" tier for address today. */
function addressQuality(crawl: CrawlRawResult): ConfidenceCategoryResult {
  if (!crawl.contact.address) return { label: "address", quality: "none", reason: "No address found by any method." };
  return crawl.contact.addressSource === "json-ld"
    ? { label: "address", quality: "high", reason: "Confirmed via structured JSON-LD data — directly observed, not inferred." }
    : { label: "address", quality: "medium", reason: "Found via a real, explicitly-labeled \"Address:\" element — a deliberate site element, but not machine-structured data." };
}

/** A direct <meta name="description"> read is inherently unambiguous — there's no "inferred" tier for it the way there is for regex-scraped contact fields. */
function metaDescriptionQuality(crawl: CrawlRawResult): ConfidenceCategoryResult {
  return crawl.metaDescription
    ? { label: "meta description", quality: "high", reason: "A direct read of the page's own <meta> tag — no inference involved." }
    : { label: "meta description", quality: "none", reason: "No <meta name=\"description\"> tag found." };
}

/** extractReviews (crawl-adapter.ts) only ever reads real aggregateRating from JSON-LD — no DOM star-rating/badge scraping fallback exists — so a present review is always directly observed, never inferred. */
function reviewsQuality(crawl: CrawlRawResult): ConfidenceCategoryResult {
  if (crawl.reviews.count === null && crawl.reviews.averageRating === null) {
    return { label: "reviews", quality: "none", reason: "No real review data found — this pipeline only trusts structured aggregateRating data, never a scraped star icon or third-party badge." };
  }
  return { label: "reviews", quality: "high", reason: `Confirmed via ${crawl.reviews.source ?? "structured data"} — directly observed, not inferred.` };
}

/**
 * Richness-tiered categories (services/testimonials/gallery): no
 * structured-data alternative exists for these — both crawl-adapter.ts's
 * heuristic content-matchers are the only source. A second independent real
 * entry corroborates that this business genuinely publishes this category
 * of content (not a one-off heuristic false match), so 2+ real entries earn
 * full credit; exactly one earns partial credit; none earns none.
 */
function richnessQuality(label: string, count: number): ConfidenceCategoryResult {
  if (count === 0) return { label, quality: "none", reason: `No real ${label} content found.` };
  if (count === 1) return { label, quality: "medium", reason: `Exactly one real ${label} entry found — real, but not corroborated by a second independent instance.` };
  return { label, quality: "high", reason: `${count} real ${label} entries found — multiple independent instances corroborate this is a genuine, published category.` };
}

/**
 * computeConfidenceScore — a genuine evidence-QUALITY signal (CTO Phase 3.5
 * directive §4-5), not "how many of 8 fields happen to be populated."
 * v1 THIS ONLY REPLACES: previously every populated category scored full
 * credit regardless of how it was captured — a phone found only via loose
 * regex-scanning of body text counted identically to one confirmed by a
 * real tel: link AND structured JSON-LD. Each category is now graded on
 * how it was actually captured: structured data (JSON-LD) or a direct,
 * unambiguous read (meta description) is high; a real but merely-labeled
 * DOM element is medium; content only found via loose regex/heuristic
 * pattern-matching with no corroboration is low; absent is none. A crawl
 * that failed outright still scores 0 confidence — we know nothing real
 * about this candidate, which is itself an honest, real answer. This is
 * NOT a threshold change and does not target any particular output number
 * — a genuinely thin-evidence business still scores low confidence here,
 * same as before.
 */
export function computeConfidenceScore(crawl: CrawlRawResult): ConfidenceScoreResult {
  if (crawl.fetchError) {
    return { score: 0, evidenceFound: [], categories: [] };
  }

  const categories: ConfidenceCategoryResult[] = [
    phoneQuality(crawl),
    addressQuality(crawl),
    emailQuality(crawl),
    richnessQuality("services", crawl.services.length),
    metaDescriptionQuality(crawl),
    reviewsQuality(crawl),
    richnessQuality("testimonials", crawl.testimonials.length),
    richnessQuality("gallery", crawl.gallery.length),
  ];

  const evidenceFound = categories.filter((c) => c.quality !== "none").map((c) => c.label);
  const totalWeight = categories.reduce((sum, c) => sum + QUALITY_WEIGHT[c.quality], 0);
  const score = Math.round((totalWeight / categories.length) * 100);

  return { score, evidenceFound, categories };
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
  /** Optional tie-break (CTO Phase 3 directive: "ranking-by-opportunity-then-confidence"); a caller ranking leads that don't carry a confidence score yet (or don't care about the tie-break) can omit it — ties then keep their relative input order, same as before this field existed. */
  confidenceScore?: number | null;
}

// ===========================================================================
// Makeover Potential — the fourth score (Phase 2, CTO Lead Hunter directive
// §2). Not a fifth independent measurement: a deliberate READ of the three
// scores above plus real evidence richness, same "derive from evidence, not
// arbitrary thresholds alone" discipline this whole module already holds
// itself to. Legitimacy still gates everything (mirrors
// computeLeadOpportunityScore's own gate) — a candidate with no verifiable
// real business behind it is never a makeover prospect no matter how bad
// its website looks. Symmetrically, a genuinely good existing website
// (opportunityScore 0) is Reject too — the CTO's own Subway example: a real,
// legitimate business with nothing left to sell a redesign on.
// ===========================================================================

export type MakeoverPotential = "very_high" | "high" | "medium" | "low" | "reject";

export interface MakeoverPotentialResult {
  potential: MakeoverPotential;
  /** Real, evidence-cited reasons for the verdict — never just the bare enum value (CTO directive §2: "explain WHY a lead is valuable"). */
  reasons: string[];
}

/**
 * computeMakeoverPotential — reads the three already-computed scores (never
 * re-touches CrawlRawResult itself, keeping this a pure read over other
 * pure results, same shape as rankLeads above) and buckets into five tiers.
 * `richness` is the count of real evidence categories confidenceScore's own
 * evidenceFound already found (services/testimonials/gallery/reviews/etc.)
 * — a business with a genuinely rich captured profile is a stronger
 * makeover prospect than one that merely scored the same opportunity number
 * on thinner evidence, so richness can lift (never invent) a tier alongside
 * opportunity/confidence.
 */
export function computeMakeoverPotential(
  website: WebsiteScoreResult,
  opportunity: OpportunityScoreResult,
  confidence: ConfidenceScoreResult
): MakeoverPotentialResult {
  const reasons: string[] = [];

  if (opportunity.legitimacyScore === 0) {
    return {
      potential: "reject",
      reasons: ["No real, verifiable evidence this is an operating business (no phone/email, address, services, internal site structure, or homepage title captured) — not a credible makeover prospect yet, only a name and a URL."],
    };
  }

  if (opportunity.score === 0) {
    return {
      potential: "reject",
      reasons: [`The existing website already scores ${website.score}/100 on real structural signals — there's no real upside left to sell a redesign on, regardless of business legitimacy.`],
    };
  }

  const richness = confidence.evidenceFound.length;

  reasons.push(`Website scores ${website.score}/100 (real upside: ${100 - website.score} points) with ${opportunity.legitimacyScore}/100 business-legitimacy signals confirmed.`);
  reasons.push(`${richness}/8 real evidence categories captured: ${confidence.evidenceFound.length > 0 ? confidence.evidenceFound.join(", ") : "none"}.`);

  let potential: MakeoverPotential;
  if (opportunity.score >= 70 && confidence.score >= 60 && richness >= 4) {
    potential = "very_high";
    reasons.push("Strong opportunity, strong confidence, and rich real evidence — ready to pursue now.");
  } else if (opportunity.score >= 45 && confidence.score >= 40) {
    potential = "high";
    reasons.push("Solid opportunity backed by real, reasonably rich evidence.");
  } else if (opportunity.score >= 25) {
    potential = "medium";
    reasons.push(confidence.score < 40 ? "Real opportunity, but thinner captured evidence — worth a second look before committing." : "Moderate opportunity.");
  } else {
    potential = "low";
    reasons.push("Limited real upside or evidence found — not a priority prospect right now.");
  }

  return { potential, reasons };
}

// ===========================================================================
// Ranking — Rank, the CTO Phase 3 directive's own explicit pipeline stage
// (Research -> Rank -> Design), not an implicit side effect of a database
// ORDER BY a caller might forget to apply consistently.
// ===========================================================================

/**
 * rankLeads — highest opportunityScore first; a lead with no score yet
 * (qualification didn't complete) sorts last, never treated as a 0 (a real
 * 0 and "we don't know yet" are different facts, same discipline
 * opportunity-scoring-service.ts's own null-vs-zero handling already
 * applies to an unmeasured category). Ties on opportunityScore break on
 * confidenceScore next (same null-sorts-last treatment) — "ranking-by-
 * opportunity-then-confidence" per the CTO Phase 3 directive: of two leads
 * with an identical real upside, the one this pipeline actually knows more
 * about is the safer one to queue first.
 */
export function rankLeads<T extends RankableLead>(leads: T[]): T[] {
  return [...leads].sort((a, b) => {
    if (a.opportunityScore !== b.opportunityScore) {
      if (a.opportunityScore === null) return 1;
      if (b.opportunityScore === null) return -1;
      return b.opportunityScore - a.opportunityScore;
    }
    const aConfidence = a.confidenceScore ?? null;
    const bConfidence = b.confidenceScore ?? null;
    if (aConfidence === bConfidence) return 0;
    if (aConfidence === null) return 1;
    if (bConfidence === null) return -1;
    return bConfidence - aConfidence;
  });
}
