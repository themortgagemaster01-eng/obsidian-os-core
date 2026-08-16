import type { LeadRow } from "@/lib/repositories/lead-repository";
import type { IndustryBucket } from "@/lib/design-references/reference-library";
import type { HeroPatternId } from "@/lib/design-intelligence/section-patterns";
import { HERO_PATTERN_VISUAL_STRATEGY_LABEL } from "@/lib/design-intelligence/section-patterns";
import { resolvePhoneForDisplay } from "@/lib/services/design-generation-service";
import {
  computeWebsiteScore,
  computeConfidenceScore,
  computeLeadOpportunityScore,
  computeMakeoverPotential,
  type MakeoverPotential,
} from "@/lib/services/lead-scoring-service";
import type {
  CrawlRawResult,
  CrawlPage,
  ContactInfo,
  SocialLinks,
  ContentSection,
  ReviewsSummary,
  GalleryImage,
  FormInfo,
} from "@/lib/adapters/types";

/**
 * business-intelligence-service.ts — Phase 2's read-model assembler: takes
 * one qualified `leads` row (Phase 1's real, already-persisted qualification
 * evidence) and normalizes it into the single profile shape the Lead Detail
 * screen renders and Launch Makeover hands to the makeover engine (CTO
 * Phase 2 directive §3). Pure, deterministic, no I/O and no LLM call —
 * mirrors lead-scoring-service.ts's own "CrawlRawResult in, real facts out"
 * discipline, just one layer up: a LeadRow (which already carries its own
 * crawl_result, per 0018_lead_hunter.sql's own comment: "so a promoted
 * lead's already-gathered evidence can seed its Design Brief without
 * re-crawling") in, a normalized profile out.
 *
 * Every field here traces to real, already-captured evidence or an already-
 * documented deterministic recommendation (resolveHeroPattern,
 * HERO_PATTERN_VISUAL_STRATEGY_LABEL, this file's own deriveConversionGoal) —
 * never fabricated. A category with no real evidence (e.g. availableVideos —
 * the crawler has no video-extraction heuristic yet) reads as an honestly
 * empty array, not a guess.
 */

export interface BusinessIntelligenceProfile {
  leadId: string;
  businessName: string;
  industry: string | null;
  industryBucket: IndustryBucket | null;
  location: string | null;
  websiteUrl: string | null;

  phone: string | null;
  phoneDisplay: string | null;
  phoneHref: string | null;
  email: string | null;
  address: string | null;
  hours: string | null;
  socialLinks: SocialLinks | null;

  services: ContentSection[];
  about: {
    metaDescription: string | null;
    team: ContentSection[];
    certifications: ContentSection[];
  };
  reviewSignals: ReviewsSummary | null;
  brandInformation: {
    title: string | null;
    metaDescription: string | null;
  };
  availableImages: GalleryImage[];
  /** The crawler has no video-extraction heuristic yet — honestly empty, never fabricated. */
  availableVideos: string[];
  existingWebsiteStructure: {
    pages: CrawlPage[];
    internalLinkCount: number | null;
    externalLinkCount: number | null;
    headingCounts: CrawlRawResult["headingCounts"] | null;
  };

  weaknesses: {
    design: string[];
    mobile: string[];
    seo: string[];
    performance: string[];
    conversion: string[];
    trust: string[];
  };
  /** Categories this pre-mission qualification crawl has no real signal for at all (e.g. Mobile/Design require the full Analysis Engine's adapters) — named honestly rather than left silently empty next to real findings. */
  notYetAssessed: string[];
  trustSignals: string[];

  /**
   * Phase 3 (CTO Opportunity Intelligence directive): evidence THE BUSINESS
   * ITSELF looks legitimate/healthy — distinct from websiteOpportunitySignals
   * below (evidence about the SITE). Each entry is gated on real captured
   * evidence; a signal the crawl has no way to verify (e.g. "independent
   * business" — this codebase has no franchise/chain-detection heuristic)
   * is never included just because a mockup example listed it.
   */
  businessStrengthSignals: string[];
  /** Phase 3: evidence the CURRENT SITE underperforms or has real, evidenced room for a redesign — never a claim about a category this crawl doesn't measure (Mobile/Design stay in notYetAssessed, not here). */
  websiteOpportunitySignals: string[];
  /**
   * Phase 3: the itemized "why pursue this business" checklist (extends
   * Phase 2's single-sentence whyOpportunity below into structured,
   * evidence-cited bullets) — businessStrengthSignals + websiteOpportunitySignals
   * combined in mockup-checklist order for a REJECTable lead, or the real
   * makeover-potential gate reason(s) when this lead is a Reject (matches
   * the CTO's own Subway-shaped example verbatim in spirit: "Website
   * already performs strongly. No meaningful redesign opportunity
   * identified.").
   */
  opportunityReasons: string[];

  recommendedHeroPattern: HeroPatternId | null;
  recommendedVisualStrategy: string | null;
  recommendedConversionGoal: string | null;

  websiteScore: number | null;
  opportunityScore: number | null;
  confidenceScore: number | null;
  makeoverPotential: MakeoverPotential | null;
  makeoverPotentialReasons: string[];

  whyOpportunity: string;
}

/**
 * deriveConversionGoal — the primary real conversion action this business's
 * own captured contact evidence supports. Follows the same tel: > structured
 * data > visible-text > other priority the contact model already applies
 * (CTO Phase 2 directive §4) — a real phone is the strongest, most direct
 * conversion path for the local-service businesses this pipeline mostly
 * targets, so it's preferred over a form/email goal when both exist.
 */
export function deriveConversionGoal(contact: ContactInfo, forms: FormInfo[]): string {
  if (contact.phones.length > 0) {
    return "Phone call — a real number was captured; make it the primary, most prominent CTA.";
  }
  if (forms.some((f) => f.hasPhoneField || f.hasEmailField)) {
    return "Contact form submission — no phone captured, but a real contact form exists on the site.";
  }
  if (contact.emails.length > 0) {
    return "Email inquiry — a real email address was captured; no phone or contact form found.";
  }
  return "Request more information — no direct contact evidence captured yet; a generic inquiry CTA is the honest fallback.";
}

/**
 * opportunity.legitimacySignals' labels (lead-scoring-service.ts's
 * computeLegitimacyScore) are phrased for the PASSING case ("Real address
 * captured") — reused verbatim for a FAILED signal, that same string reads
 * backwards in a weaknesses list (looks like a claim the evidence exists).
 * This is the honest negation for display; falls back to the raw label
 * (never throws) if lead-scoring-service.ts adds a signal this map doesn't
 * know about yet.
 */
const LEGITIMACY_SIGNAL_WEAKNESS_LABEL: Record<string, string> = {
  "Real phone or email captured": "No real phone or email captured.",
  "Real address captured": "No real address captured.",
  "Real service/offering content found": "No real service/offering content found.",
  "Site has real internal structure (more than a single orphan page)": "Site has no real internal structure — effectively a single orphan page.",
  "Has a real, non-empty homepage title": "No real, non-empty homepage title found.",
};

/**
 * Same passing-case-phrased-label problem as LEGITIMACY_SIGNAL_WEAKNESS_LABEL
 * above, for computeWebsiteScore's own signals (lead-scoring-service.ts) —
 * "Has a meta description" reused verbatim for a FAILED signal read as a
 * positive claim (Phase 3 catch: this was a real, latent bug in the `seo`
 * weakness list below, never exercised by a fixture with a failing SEO
 * signal until now).
 */
const WEBSITE_SIGNAL_WEAKNESS_LABEL: Record<string, string> = {
  "Has a meta description": "No meta description found.",
  "Exactly one H1 (real heading hierarchy)": "No clear single H1 heading found — heading hierarchy is unclear.",
  "robots.txt present": "No robots.txt found.",
  "sitemap.xml present": "No sitemap.xml found.",
};

function categorizeWeaknesses(
  website: ReturnType<typeof computeWebsiteScore>,
  opportunity: ReturnType<typeof computeLeadOpportunityScore>,
  confidence: ReturnType<typeof computeConfidenceScore>,
  forms: FormInfo[],
  contact: ContactInfo
): { weaknesses: BusinessIntelligenceProfile["weaknesses"]; notYetAssessed: string[]; trustSignals: string[] } {
  const seo = website.signals
    .filter((s) => !s.passed && s.label in WEBSITE_SIGNAL_WEAKNESS_LABEL)
    .map((s) => WEBSITE_SIGNAL_WEAKNESS_LABEL[s.label]);
  const performance = website.signals.filter((s) => !s.passed && s.label === "Page size is not badly bloated").map(() => "Homepage is unusually large/bloated (structural proxy — full Lighthouse timing runs after promotion).");

  const conversion: string[] = [];
  if (contact.phones.length === 0 && !forms.some((f) => f.hasPhoneField || f.hasEmailField) && contact.emails.length === 0) {
    conversion.push("No clear call-to-action, contact form, or reachable contact method found on the site.");
  } else if (forms.length === 0) {
    conversion.push("No contact form found — the only conversion path is whatever contact info is captured above.");
  }

  const trustSignals: string[] = [];
  const trust: string[] = [];
  for (const signal of opportunity.legitimacySignals) {
    if (signal.passed) trustSignals.push(signal.label);
    else trust.push(LEGITIMACY_SIGNAL_WEAKNESS_LABEL[signal.label] ?? signal.label);
  }
  for (const check of ["reviews", "testimonials"] as const) {
    if (!confidence.evidenceFound.includes(check)) {
      trust.push(`No real ${check} captured.`);
    } else {
      trustSignals.push(`Real ${check} captured.`);
    }
  }

  return {
    weaknesses: { design: [], mobile: [], seo, performance, conversion, trust },
    notYetAssessed: ["design", "mobile"],
    trustSignals,
  };
}

// ===========================================================================
// Phase 3 (CTO Opportunity Intelligence directive) — businessStrengthSignals
// / websiteOpportunitySignals. v1 thresholds, not a final answer, same
// disclosure lead-scoring-service.ts's own module comment already carries
// for its scoring weights. Deliberately does NOT include every signal the
// CTO's own hypothetical "Bella Luna" mockup listed — "Independent
// business" has no real evidence source in this codebase (no franchise/
// chain-detection heuristic exists), so it's omitted rather than fabricated;
// see this file's own module comment and the Phase 3 report for the full
// disclosure of what's evidence-gated out.
// ===========================================================================

const STRONG_LOCAL_REPUTATION_MIN_RATING = 4.0;
const ESTABLISHED_CUSTOMER_BASE_MIN_REVIEW_COUNT = 15;
const HIGH_QUALITY_PHOTOGRAPHY_MIN_IMAGES = 3;
const STRONG_CONTENT_MIN_SERVICES = 3;
const MULTI_PAGE_REDESIGN_MIN_CONTENT_UNITS = 2;

/**
 * deriveBusinessStrengthSignals — real evidence THE BUSINESS is legitimate
 * and healthy, each entry gated on a real, cited measurement (never present
 * just because a signal "sounds plausible" for this industry).
 */
function deriveBusinessStrengthSignals(crawl: CrawlRawResult, contact: ContactInfo): string[] {
  const signals: string[] = [];

  if (contact.phones.length > 0 || contact.emails.length > 0 || contact.address) {
    signals.push("Real, verifiable contact information published");
  }
  if (crawl.reviews.averageRating !== null && crawl.reviews.averageRating >= STRONG_LOCAL_REPUTATION_MIN_RATING) {
    signals.push(`Strong local reputation (${crawl.reviews.averageRating.toFixed(1)}★ average rating${crawl.reviews.source ? `, ${crawl.reviews.source}` : ""})`);
  }
  if (crawl.reviews.count !== null && crawl.reviews.count >= ESTABLISHED_CUSTOMER_BASE_MIN_REVIEW_COUNT) {
    signals.push(`Established customer base (${crawl.reviews.count} real reviews captured)`);
  }
  if (crawl.testimonials.length > 0) {
    signals.push(`Real client testimonials published (${crawl.testimonials.length} captured)`);
  }
  if (crawl.gallery.length >= HIGH_QUALITY_PHOTOGRAPHY_MIN_IMAGES) {
    signals.push(`High-quality photography available (${crawl.gallery.length} real images captured)`);
  }
  if (crawl.services.length >= STRONG_CONTENT_MIN_SERVICES) {
    signals.push(`Strong menu/service content (${crawl.services.length} real entries captured)`);
  }

  return signals;
}

/**
 * deriveWebsiteOpportunitySignals — real evidence the CURRENT SITE
 * underperforms or has real, evidenced room for a redesign. Reuses the same
 * SEO/performance/conversion weakness labels categorizeWeaknesses already
 * derived (never a second, divergent computation of the same facts), plus
 * one positively-framed structural signal ("multiple real pages/services")
 * that isn't a weakness at all but genuinely is real evidence a redesign
 * has real content to work with — the CTO mockup's own "Multiple pages/
 * services provide redesign opportunity" line.
 */
function deriveWebsiteOpportunitySignals(crawl: CrawlRawResult, weaknesses: BusinessIntelligenceProfile["weaknesses"]): string[] {
  const signals: string[] = [...weaknesses.seo, ...weaknesses.performance, ...weaknesses.conversion];

  const contentUnits = crawl.services.length + Math.max(crawl.pages.length - 1, 0);
  if (contentUnits >= MULTI_PAGE_REDESIGN_MIN_CONTENT_UNITS) {
    signals.push(`Multiple real pages/services (${contentUnits} captured) provide real structure for a redesign, not just a single page to rebuild`);
  }

  return signals;
}

/**
 * deriveOpportunityReasons — Phase 3's itemized "why pursue" checklist
 * (extends Phase 2's single-sentence whyOpportunity into structured,
 * evidence-cited bullets, matching the CTO's own mixed-checklist mockup).
 * A Reject lead gets the real makeover-potential gate reason(s) instead —
 * the CTO's own Subway-shaped example ("Website already performs strongly.
 * No meaningful redesign opportunity identified.") is exactly what
 * computeMakeoverPotential's own reject reasons already say, just not
 * word-for-word (evidence-cited wording wins over matching mockup prose).
 */
function deriveOpportunityReasons(
  businessStrengthSignals: string[],
  websiteOpportunitySignals: string[],
  potential: MakeoverPotential | null,
  potentialReasons: string[]
): string[] {
  if (potential === "reject") {
    return potentialReasons.length > 0 ? potentialReasons : ["Not a credible makeover prospect — insufficient real evidence or no real upside left to sell."];
  }
  return [...businessStrengthSignals, ...websiteOpportunitySignals];
}

/**
 * explainOpportunity — the concrete "why is this business an opportunity"
 * sentence the Lead Detail screen shows (CTO Phase 2 directive §5), composed
 * from real captured evidence and real weaknesses, never a generic template
 * line. Deliberately separate from lead-hunter-service.ts's own terser
 * `main_opportunity` (that one gates scan-time triage; this one is the
 * richer, evidence-cited explanation a founder reviewing one specific lead
 * actually reads).
 */
function explainOpportunity(
  weaknessLabels: string[],
  strengths: string[],
  potential: MakeoverPotential | null,
  potentialReasons: string[]
): string {
  if (potential === "reject") {
    return potentialReasons[0] ?? "Not a credible makeover prospect — insufficient real evidence or no real upside left to sell.";
  }

  const weaknessPart = weaknessLabels.length > 0 ? `Weak on ${weaknessLabels.slice(0, 4).join(", ").toLowerCase()}` : "No major structural weaknesses found";
  const strengthPart = strengths.length > 0 ? `backed by ${strengths.join(", ").toLowerCase()}` : "though captured evidence is thin";

  return `${weaknessPart}, ${strengthPart}. ${potentialReasons[potentialReasons.length - 1] ?? ""}`.trim();
}

/**
 * buildBusinessIntelligenceProfile — the single integration point Phase 2's
 * Lead Detail screen and Launch Makeover action both call. Reads the
 * already-persisted qualification evidence off `lead` (contact_evidence,
 * social_links, crawl_result, the four scores) rather than re-crawling —
 * qualifyCandidate already paid for one real crawl; this never spends a
 * second one to build a display profile.
 */
export function buildBusinessIntelligenceProfile(lead: LeadRow): BusinessIntelligenceProfile {
  const crawl = (lead.crawl_result as unknown as CrawlRawResult | null) ?? null;
  const contact = (lead.contact_evidence as unknown as ContactInfo | null) ?? crawl?.contact ?? { phones: [], emails: [], address: null, hours: null };
  const socials = (lead.social_links as unknown as SocialLinks | null) ?? crawl?.socials ?? null;
  const mainWeaknesses = (lead.main_weaknesses as unknown as string[] | null) ?? [];
  const makeoverPotentialReasons = (lead.makeover_potential_reasons as unknown as string[] | null) ?? [];

  const phoneInfo = resolvePhoneForDisplay(contact);

  let weaknessBundle: ReturnType<typeof categorizeWeaknesses> = {
    weaknesses: { design: [], mobile: [], seo: [], performance: [], conversion: [], trust: [] },
    notYetAssessed: ["design", "mobile", "seo", "performance", "conversion", "trust"],
    trustSignals: [],
  };
  let businessStrengthSignals: string[] = [];
  let websiteOpportunitySignals: string[] = [];

  if (crawl) {
    const website = computeWebsiteScore(crawl);
    const opportunity = computeLeadOpportunityScore(crawl);
    const confidence = computeConfidenceScore(crawl);
    weaknessBundle = categorizeWeaknesses(website, opportunity, confidence, crawl.forms, contact);
    businessStrengthSignals = deriveBusinessStrengthSignals(crawl, contact);
    websiteOpportunitySignals = deriveWebsiteOpportunitySignals(crawl, weaknessBundle.weaknesses);
  }

  const heroPattern = (lead.recommended_hero_pattern as HeroPatternId | null) ?? null;
  const strengths = weaknessBundle.trustSignals;
  const opportunityReasons = deriveOpportunityReasons(businessStrengthSignals, websiteOpportunitySignals, lead.makeover_potential, makeoverPotentialReasons);

  return {
    leadId: lead.id,
    businessName: lead.business_name,
    industry: lead.industry,
    industryBucket: (lead.industry as IndustryBucket | null) ?? null,
    location: lead.location,
    websiteUrl: lead.website_url,

    phone: contact.phones[0] ?? null,
    phoneDisplay: phoneInfo?.display ?? null,
    phoneHref: phoneInfo?.href ?? null,
    email: contact.emails[0] ?? null,
    address: contact.address,
    hours: contact.hours,
    socialLinks: socials,

    services: crawl?.services ?? [],
    about: {
      metaDescription: crawl?.metaDescription ?? null,
      team: crawl?.team ?? [],
      certifications: crawl?.certifications ?? [],
    },
    reviewSignals: crawl?.reviews ?? null,
    brandInformation: {
      title: crawl?.title ?? null,
      metaDescription: crawl?.metaDescription ?? null,
    },
    availableImages: crawl?.gallery ?? [],
    availableVideos: [],
    existingWebsiteStructure: {
      pages: crawl?.pages ?? [],
      internalLinkCount: crawl?.internalLinkCount ?? null,
      externalLinkCount: crawl?.externalLinkCount ?? null,
      headingCounts: crawl?.headingCounts ?? null,
    },

    weaknesses: weaknessBundle.weaknesses,
    notYetAssessed: weaknessBundle.notYetAssessed,
    trustSignals: weaknessBundle.trustSignals,

    businessStrengthSignals,
    websiteOpportunitySignals,
    opportunityReasons,

    recommendedHeroPattern: heroPattern,
    recommendedVisualStrategy: lead.recommended_design_strategy ?? (heroPattern ? HERO_PATTERN_VISUAL_STRATEGY_LABEL[heroPattern] : null),
    recommendedConversionGoal: lead.recommended_conversion_goal ?? null,

    websiteScore: lead.website_score,
    opportunityScore: lead.opportunity_score,
    confidenceScore: lead.confidence_score,
    makeoverPotential: lead.makeover_potential,
    makeoverPotentialReasons,

    whyOpportunity: explainOpportunity(mainWeaknesses, strengths, lead.makeover_potential, makeoverPotentialReasons),
  };
}
