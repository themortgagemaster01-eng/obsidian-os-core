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

function categorizeWeaknesses(
  website: ReturnType<typeof computeWebsiteScore>,
  opportunity: ReturnType<typeof computeLeadOpportunityScore>,
  confidence: ReturnType<typeof computeConfidenceScore>,
  forms: FormInfo[],
  contact: ContactInfo
): { weaknesses: BusinessIntelligenceProfile["weaknesses"]; notYetAssessed: string[]; trustSignals: string[] } {
  const seo = website.signals
    .filter((s) => !s.passed && ["Has a meta description", "Exactly one H1 (real heading hierarchy)", "robots.txt present", "sitemap.xml present"].includes(s.label))
    .map((s) => s.label);
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

  if (crawl) {
    const website = computeWebsiteScore(crawl);
    const opportunity = computeLeadOpportunityScore(crawl);
    const confidence = computeConfidenceScore(crawl);
    weaknessBundle = categorizeWeaknesses(website, opportunity, confidence, crawl.forms, contact);
  }

  const heroPattern = (lead.recommended_hero_pattern as HeroPatternId | null) ?? null;
  const strengths = weaknessBundle.trustSignals;

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
