import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import type { DesignBrief, DesignBriefCitation } from "@/lib/services/design-brief-service";
import type { DesignMemory, SignatureElementId } from "@/lib/services/design-intelligence-service";
import { refineDesign, type RefinedDesign } from "@/lib/services/design-refinement-service";
import type { LayoutFamily } from "@/lib/design-intelligence/layout-rules";
import { matchesGenericSaasTemplate } from "@/lib/design-intelligence/layout-rules";
import type { IndustryBucket } from "@/lib/design-references/reference-library";
import type { ContactInfo, ContentSection, ReviewsSummary } from "@/lib/adapters/types";
import { GENERIC_TESTIMONIAL_HEADING } from "@/lib/adapters/types";

import {
  websiteDesignRepository,
  type WebsiteDesignRow,
} from "@/lib/repositories/website-design-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";

/**
 * design-generation-service.ts — takes an approved Design Brief and
 * produces the Wireframe (section order) and the assembled component tree
 * (docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md §1). Sprint 4 Phase 2 scope
 * only: Wireframe generation and Component assembly. Typography/Spacing/
 * Motion passes are Phase 3 (Design Refinement), not this file's concern.
 *
 * Per the founder's Phase 2 guidance: this service ASSEMBLES — it consumes
 * lib/design-intelligence/'s rules (matchesGenericSaasTemplate, below) and
 * the Design Brief's direction, it never reinvents design judgment or reads
 * lib/design-references/ directly. It also never judges its own output —
 * that's design-qa-service.ts, Phase 3, not yet built — and it never calls
 * transitionMissionState(): only design-brief-service.ts owns the
 * researching/designing transitions; this service runs entirely within
 * `designing` and leaves the designing -> qa transition to the future QA
 * service, mirroring how neither adapters nor insight-service.ts/
 * opportunity-scoring-service.ts touch mission state themselves.
 */

// ===========================================================================
// Wireframe (pure data shape + pure generator)
// ===========================================================================

export type SectionType =
  | "hero"
  | "credibility"
  | "team"
  | "services"
  | "menu"
  | "gallery"
  | "schedule"
  | "listings"
  | "testimonials"
  | "serviceArea"
  | "faq"
  | "contact"
  | "footer";

export interface WireframeSection {
  type: SectionType;
  /** Why this section is included at this position — ties back to the Design Brief's direction (§5's editorial-composition standard: order follows the business's story, not a fixed checklist). */
  rationale: string;
}

export interface Wireframe {
  layoutFamily: LayoutFamily;
  sections: WireframeSection[];
  /**
   * Passed through unchanged from DesignBrief.signatureElement — the ONE
   * memorable, business-justified visual treatment Design Intelligence chose
   * for this mission. Previously computed (SIGNATURE_ELEMENT_SECTION below)
   * only to append a sentence to a section's `rationale`, which reaches the
   * rendered page solely as an invisible `title` tooltip attribute
   * (components/design-preview/design-preview.tsx's SectionShell) — never an
   * actual visual treatment. Carrying the raw element id on the Wireframe
   * lets the renderer apply a real, distinctive styling difference to the
   * section it targets (Premium Presentation Pass, §11), falling back to the
   * always-present hero when the targeted section isn't in this business's
   * wireframe (e.g. "service-area-location-motif" chosen for a lawFirm-
   * bucket business, whose template has no "serviceArea" section at all).
   */
  signatureElement: DesignBrief["signatureElement"];
}

/**
 * Per-bucket section order templates, directly derived from
 * docs/DESIGN_INTELLIGENCE.md §10's "what shifts" column — e.g. a
 * restaurant leads with imagery/menu, a law firm leads with credibility.
 * None of these is the banned generic-SaaS sequence (verified below by
 * matchesGenericSaasTemplate rather than just asserted).
 */
const WIREFRAME_TEMPLATE_BY_BUCKET: Record<IndustryBucket, SectionType[]> = {
  restaurant: ["hero", "menu", "gallery", "credibility", "contact", "footer"],
  lawFirm: ["hero", "credibility", "services", "faq", "contact", "footer"],
  dentistMedical: ["hero", "credibility", "services", "faq", "contact", "footer"],
  homeService: ["hero", "services", "serviceArea", "credibility", "faq", "contact", "footer"],
  realEstate: ["hero", "listings", "credibility", "contact", "footer"],
  fitness: ["hero", "schedule", "services", "credibility", "contact", "footer"],
  luxuryServices: ["hero", "services", "credibility", "contact", "footer"],
  general: ["hero", "services", "credibility", "faq", "contact", "footer"],
};

const RATIONALE_BY_SECTION: Record<SectionType, string> = {
  hero: "Leads with the business's actual story per the Design Brief's direction, not a generic centered SaaS hero (§5).",
  credibility: "Credibility signals placed per the Design Brief's positioning — real data only, never a fabricated trust signal (§8).",
  team: "Included only because real team/staff data exists for this mission — omitted otherwise, never a fabricated headcount or bio (§8).",
  services: "Offerings presented in a scannable, content-driven shape, not a default icon-feature grid (§5, §9).",
  menu: "Menu-first structure because the primary visitor decision here is what's being served (§9, §10).",
  gallery: "Imagery leads because atmosphere is functionally part of the pitch for this business (§10).",
  schedule: "A class/session schedule surfaced early because it's the functionally critical next step for this business (§9, §10).",
  listings: "Listings/property imagery lead, matching how prospects actually evaluate this kind of business (§10).",
  testimonials: "Included only because real testimonial data exists for this mission — omitted otherwise, never fabricated (§8).",
  serviceArea: "Service-area coverage surfaced because it's an expected trust signal for this business's category (§10).",
  faq: "Answers real, evidence-grounded objections surfaced by the Analysis stage's Insights, not a generic filler FAQ (§9).",
  contact: "Contact clarity — visible without hunting, per §8's baseline functional requirement.",
  footer: "Closing structural section; carries no direction-specific content.",
};

function insertBeforeContact(order: SectionType[], section: SectionType): SectionType[] {
  const contactIndex = order.indexOf("contact");
  const insertAt = contactIndex === -1 ? order.length - 1 : contactIndex;
  return [...order.slice(0, insertAt), section, ...order.slice(insertAt)];
}

/**
 * Sections Design Intelligence's contentEmphasis may reorder — deliberately
 * excludes hero/contact/footer, which keep their structural positions
 * regardless of emphasis (CTO directive's contentEmphasis vocabulary is
 * scoped to exactly this set in design-intelligence-service.ts's prompt;
 * this is the defensive re-check on the Generation side, never trusting an
 * LLM response's shape alone).
 */
const EMPHASIZABLE_SECTIONS: SectionType[] = [
  "services",
  "testimonials",
  "credibility",
  "menu",
  "gallery",
  "schedule",
  "listings",
  "serviceArea",
  "faq",
];

/**
 * applyContentEmphasis — pure reordering pass. This is the concrete fix for
 * two businesses sharing an industryBucket (e.g. Alltech HVAC and Wilcox
 * Lawn & Landscaping, both "homeService") otherwise producing an identical
 * wireframe section order: each business's real evidence (via Design
 * Intelligence's contentEmphasis) now promotes the sections its own
 * evidence actually supports, ahead of the bucket template's default order.
 * Never introduces a section the bucket template didn't already include —
 * emphasis can only reorder, never add.
 */
export function applyContentEmphasis(order: SectionType[], contentEmphasis: string[] | undefined): SectionType[] {
  if (!contentEmphasis || contentEmphasis.length === 0) return order;

  const rank = contentEmphasis.filter(
    (s): s is SectionType => EMPHASIZABLE_SECTIONS.includes(s as SectionType) && order.includes(s as SectionType)
  );
  if (rank.length === 0) return order;

  const heroIndex = order.indexOf("hero");
  const contactIndex = order.indexOf("contact");
  const footerIndex = order.indexOf("footer");
  const middleStart = heroIndex === -1 ? 0 : heroIndex + 1;
  const middleEnd = contactIndex !== -1 ? contactIndex : footerIndex !== -1 ? footerIndex : order.length;

  const before = order.slice(0, middleStart);
  const middle = order.slice(middleStart, middleEnd);
  const after = order.slice(middleEnd);

  const emphasized = rank.filter((s) => middle.includes(s));
  const rest = middle.filter((s) => !emphasized.includes(s));

  return [...before, ...emphasized, ...rest, ...after];
}

/** Maps each Signature Element (design-intelligence-service.ts's fixed, renderable vocabulary) to the one SectionType it concretely enriches — how a business-specific signature actually reaches the page without any new renderer/component. Exported so the renderer (components/design-preview/design-preview.tsx) can apply real visual treatment to the same section this rationale text already names, instead of only annotating an invisible tooltip. */
export const SIGNATURE_ELEMENT_SECTION: Record<SignatureElementId, SectionType> = {
  "authentic-photography-hero": "hero",
  "menu-editorial-presentation": "menu",
  "testimonial-editorial-treatment": "testimonials",
  "credibility-certification-display": "credibility",
  "service-area-location-motif": "serviceArea",
  "gallery-atmosphere-treatment": "gallery",
  "listing-imagery-treatment": "listings",
  "schedule-energy-treatment": "schedule",
  "faq-evidence-treatment": "faq",
  "service-list-editorial-treatment": "services",
};

/**
 * buildSectionRationale — per-section rationale text, now business-specific
 * rather than a fixed per-SectionType constant. The hero always uses
 * brief.heroThesis when present (a real, evidence-traceable sentence,
 * strictly better than the generic constant it replaces); whichever
 * section signatureElement maps to gets its justification appended. This
 * text already flows to the customer-facing preview's section `title`
 * attribute (components/design-preview/design-preview.tsx's SectionShell)
 * — real evidence reaching the rendered page through existing plumbing,
 * not a new rendering capability.
 */
function buildSectionRationale(type: SectionType, brief: DesignBrief): string {
  const base = type === "hero" && brief.heroThesis ? brief.heroThesis : RATIONALE_BY_SECTION[type];
  const signatureSection = SIGNATURE_ELEMENT_SECTION[brief.signatureElement?.element as SignatureElementId];
  if (signatureSection === type && brief.signatureElement?.justification) {
    return `${base} Signature element: ${brief.signatureElement.justification}`;
  }
  return base;
}

export interface GenerateWireframeOptions {
  /** True only when real, already-captured testimonial data exists for this mission — never assumed (§8). */
  hasRealTestimonials: boolean;
  /** True only when real, already-captured team/staff data exists for this mission — never assumed (§8). Optional (defaults to false) so every existing hasRealTestimonials-only call site stays valid. */
  hasRealTeam?: boolean;
}

/**
 * generateWireframe — the Wireframe pass. Pure function: DesignBrief +
 * options in, Wireframe out. Deterministic and template-driven rather than
 * invented per call, matching this codebase's existing precedent (insight-
 * service.ts, opportunity-report-service.ts) of deterministic, rule-based
 * generation rather than a model call — no code in this repository calls an
 * LLM/model API today (see docs/SPRINT_STATUS.md's Sprint 2 gap, still
 * open), and this service follows that same, already-established shape
 * rather than introducing new infrastructure speculatively.
 *
 * Throws if the resulting section order ever matches the banned generic-
 * SaaS-template pattern (lib/design-intelligence/layout-rules.ts) — this
 * should be unreachable from any of the templates above, but the check
 * makes the "Generation consumes Design Intelligence's rules, never
 * reinvents them" boundary a real, enforced one in code, not just a
 * comment.
 */
export function generateWireframe(brief: DesignBrief, options: GenerateWireframeOptions): Wireframe {
  const baseOrder = WIREFRAME_TEMPLATE_BY_BUCKET[brief.industryBucket];
  const withTestimonials = options.hasRealTestimonials ? insertBeforeContact(baseOrder, "testimonials") : baseOrder;
  const withTeam = options.hasRealTeam ? insertBeforeContact(withTestimonials, "team") : withTestimonials;
  const sectionOrder = applyContentEmphasis(withTeam, brief.contentEmphasis);

  if (matchesGenericSaasTemplate(sectionOrder)) {
    throw new Error(
      "Generated wireframe matched the banned generic-SaaS-template pattern (lib/design-intelligence/layout-rules.ts) — this indicates a wireframe-template bug, not a valid output."
    );
  }

  return {
    layoutFamily: brief.direction.layoutFamily,
    sections: sectionOrder.map((type) => ({ type, rationale: buildSectionRationale(type, brief) })),
    signatureElement: brief.signatureElement,
  };
}

/**
 * resolveSignatureSection — the section a wireframe's signatureElement should
 * actually apply visual treatment to: SIGNATURE_ELEMENT_SECTION's target when
 * that section is present in this wireframe, otherwise "hero" (always
 * present, per refineLayout's leadsWithHero invariant) as the one universal
 * fallback — a chosen signature should still reach the page as a real,
 * visible treatment even when Design Intelligence picked an element whose
 * ideal section this business's industry-bucket template doesn't include
 * (e.g. "service-area-location-motif" for a lawFirm-bucket business, which
 * has no "serviceArea" section). Exported for the renderer; pure lookup, no
 * new design judgment.
 *
 * `wireframe.signatureElement` is typed as required (every Wireframe
 * generateWireframe produces from this point forward carries one), but a
 * `website_designs.wireframe` row already persisted by an OLDER build (from
 * before this field existed) is real JSON this function must still survive
 * at runtime without crashing — confirmed against a real stored row (Veslo
 * Family Restaurant's) during this pass, not a hypothetical. Same "the
 * compile-time type is a promise about new output, not a guarantee about
 * already-persisted data" caution this codebase already applies wherever a
 * `briefRow.brief as unknown as DesignBrief` cast reads a Supabase column.
 */
export function resolveSignatureSection(wireframe: Pick<Wireframe, "sections" | "signatureElement">): SectionType {
  const target = wireframe.signatureElement
    ? SIGNATURE_ELEMENT_SECTION[wireframe.signatureElement.element as SignatureElementId]
    : undefined;
  return target && wireframe.sections.some((s) => s.type === target) ? target : "hero";
}

// ===========================================================================
// Component assembly (pure data shape + pure assembler)
// ===========================================================================

export interface ComponentSlot {
  name: string;
  /** "real" when backed by actual company/mission/analysis data; "placeholder" when the business must supply it. Never populated with invented content (§8). */
  source: "real" | "placeholder";
  value: string | null;
}

export interface ComponentNode {
  section: SectionType;
  componentKind: string;
  slots: ComponentSlot[];
}

const HERO_KIND_BY_LAYOUT_FAMILY: Record<LayoutFamily, string> = {
  "imagery-led": "ImageLedHero",
  "credibility-led": "CredibilityHero",
  "schedule-led": "EnergeticHero",
  "menu-led": "MenuLedHero",
  "listing-led": "ListingLedHero",
  editorial: "EditorialHero",
};

const COMPONENT_KIND_BY_SECTION: Record<Exclude<SectionType, "hero">, string> = {
  credibility: "TrustSignalRow",
  team: "TeamList",
  services: "ServiceList",
  menu: "MenuList",
  gallery: "PhotoGallery",
  schedule: "ScheduleBlock",
  listings: "ListingGrid",
  testimonials: "TestimonialList",
  serviceArea: "ServiceAreaBlock",
  faq: "FaqList",
  contact: "ContactBlock",
  footer: "FooterBlock",
};

const MAX_FAQ_SLOTS = 4;
const MAX_SERVICE_SLOTS = 6;
const MAX_CERTIFICATION_SLOTS = 3;
const MAX_TEAM_SLOTS = 3;

/** A real testimonial quote plus its real attribution, when the crawler found one structurally present next to the quote — attribution is null (never guessed) when none was found, matching crawl-adapter.ts's own GENERIC_TESTIMONIAL_HEADING fallback discipline. */
export interface RealTestimonial {
  quote: string;
  attribution: string | null;
}

export interface AssembleComponentsContext {
  businessName: string;
  citedInsights: DesignBriefCitation[];
  /** Real testimonial quote + attribution, when captured — required if the wireframe includes a "testimonials" section (see generateWireframe's hasRealTestimonials gate). */
  realTestimonials?: RealTestimonial[];
  /** Real, mechanically-extracted contact facts (DesignBrief.contactEvidence) — each field renders as a real slot only when actually captured; missing fields stay honestly placeholder, never invented (§8). */
  contactEvidence: ContactInfo;
  /**
   * DesignBrief.metaDescription passed through unchanged — the business's
   * own real published homepage copy, used as a candidate hero headline
   * when present (§8: reusing a business's own words is not fabrication).
   * buildHeroHeadline below cleans trailing CTA/location fragments off this
   * value and reconciles any location claim it makes against
   * contactEvidence before using it — never promoted to the headline
   * verbatim and unchecked (CTO Design Intelligence Remediation directive,
   * Issues 4 & 5).
   */
  metaDescription?: string | null;
  /**
   * DesignBrief.heroThesis passed through unchanged — Design Intelligence's
   * own one-sentence, evidence-grounded answer to "why does this website
   * belong to THIS business" (see design-intelligence-service.ts). Used as
   * the hero headline whenever metaDescription is absent or was rejected as
   * an unreconciled/malformed candidate — real content that already exists
   * on every Design Brief, not a fabricated fallback (CTO Design
   * Intelligence Remediation directive, Issue 2: this is what actually
   * fixes the empty Veslo/Alltech HVAC heroes, which had no metaDescription
   * to fall back to at all).
   */
  heroThesis?: string;
  /** DesignBrief.services passed through unchanged — real service/offering descriptions the crawler found (homepage or an already-fetched sub-page), each traceable to its real source page. Fills the "services" section's slots when present; stays placeholder otherwise (§8). */
  services?: ContentSection[];
  /** DesignBrief.certifications passed through unchanged — real credentials the crawler found. Fills the credibility section's certifications slots when present; stays placeholder otherwise (§8). */
  certifications?: ContentSection[];
  /** DesignBrief.team passed through unchanged — real team/staff content the crawler found. Adds real team slots to the credibility section only when present — never a fabricated headcount. */
  team?: ContentSection[];
  /** DesignBrief.faqEvidence passed through unchanged — real, already-published FAQ content. Preferred over citedInsights-derived questions when present, since it's the business's own real Q&A rather than a citation reframed as a question. */
  faqEvidence?: ContentSection[];
  /** DesignBrief.reviews passed through unchanged — real review count/rating, when the crawl found structured review data. Fills the credibility section's reviewCount slot when present; stays placeholder otherwise (§8). */
  reviews?: ReviewsSummary;
}

function realSlot(name: string, value: string): ComponentSlot {
  return { name, source: "real", value };
}

function placeholderSlot(name: string): ComponentSlot {
  return { name, source: "placeholder", value: null };
}

// ===========================================================================
// Hero headline assembly (CTO Design Intelligence Remediation directive,
// Issues 2, 4, 5) — previously a bare `context.metaDescription ? real :
// placeholder` passthrough. Three real defects traced to that one line:
// (2) businesses with no captured metaDescription got no headline at all,
// even though Design Intelligence always produces a real, evidence-grounded
// heroThesis for every business; (4) a metaDescription's location claim was
// never checked against the mission's own structured contactEvidence, so a
// stale/inaccurate old-site meta tag could contradict the real address
// rendered two sections later on the same page; (5) a metaDescription
// containing a trailing CTA label and/or a location fragment (both real
// content, but boilerplate/structural rather than part of the sentence)
// rendered as one run-on, badly punctuated sentence.
// ===========================================================================

/** Boilerplate call-to-action phrasing sometimes appended to a business's own <meta name="description"> for SEO — real content, but UI/interface language, not a claim about the business. Stripped from the end of a headline candidate, never from the middle of real prose. */
const TRAILING_CTA_FRAGMENT =
  /\s*(?:learn more|call (?:today|now)|contact us(?: today)?|get (?:a |your )?(?:free )?quote|book now|schedule (?:now|today|an appointment)|shop now|visit (?:us )?today)!?\s*$/i;

/** A "City, ST" (or "City, State") fragment mashed onto the very end of a sentence — belongs in the contact/serviceArea slots, not spliced onto the hero headline. Only strips a clearly trailing fragment; never touches a location named mid-sentence as part of real prose. */
const TRAILING_LOCATION_FRAGMENT = /\s*[,.]?\s*[A-Z][A-Za-z.'-]+(?:\s[A-Z][A-Za-z.'-]+)*,\s*[A-Z]{2}\.?\s*$/;

/** Removes a trailing CTA fragment and/or a trailing "City, ST" fragment from a metaDescription-derived headline candidate (Issue 5 — the Wilcox Lawn & Landscaping splice bug), leaving a clean, complete sentence. Runs the location strip both before and after the CTA strip since either fragment may be outermost. */
function stripTrailingCtaAndLocation(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(TRAILING_LOCATION_FRAGMENT, "").trim();
  cleaned = cleaned.replace(TRAILING_CTA_FRAGMENT, "").trim();
  cleaned = cleaned.replace(TRAILING_LOCATION_FRAGMENT, "").trim();
  if (cleaned && !/[.!?]$/.test(cleaned)) cleaned += ".";
  return cleaned;
}

/** A "3 Milwaukee locations" style multi-location claim can never be corroborated by contactEvidence, which only ever captures one real address — an unsupported claim regardless of whether contactEvidence exists at all. */
const MULTI_LOCATION_CLAIM = /\b\d+\s+[A-Za-z]+(?:\s[A-Za-z]+)?\s+locations?\b/i;

/** A "City, ST" or "City location(s)" phrase named inside the candidate headline text (not necessarily trailing). */
const NAMED_LOCATION_CLAIM = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)(?:,\s*[A-Z]{2}\b|\s+locations?\b)/;

/**
 * True when a metaDescription-derived headline candidate makes a location
 * claim the mission's own real, structured contactEvidence.address can't
 * corroborate (Issue 4 — the Lakeshore Family Dentistry regression: a
 * scraped meta description claimed "3 Milwaukee locations" while
 * contactEvidence.address recorded one real Sarasota, FL address). Per the
 * directive's resolution, contactEvidence — structured, higher-confidence
 * evidence — wins on conflict: the caller drops the conflicting candidate
 * entirely rather than rendering a claim that contradicts the contact card
 * on the same page.
 */
function conflictsWithContactEvidence(candidate: string, address: string | null): boolean {
  if (MULTI_LOCATION_CLAIM.test(candidate)) return true;
  const named = candidate.match(NAMED_LOCATION_CLAIM);
  if (!named) return false;
  if (!address) return true;
  return !address.toLowerCase().includes(named[1].toLowerCase());
}

/**
 * Chooses the hero headline: a cleaned, reconciled metaDescription when one
 * exists and survives cleanup/reconciliation, otherwise the real,
 * evidence-grounded heroThesis Design Intelligence already produced for
 * every business, otherwise an honest placeholder. Never fabricates new
 * headline text — every branch either passes through real content unchanged
 * (after stripping boilerplate CTA/location fragments) or omits the claim
 * entirely.
 */
/**
 * A candidate headline longer than this renders as an oversized wall of
 * display-sized text, especially at mobile widths — the real Veslo
 * regression (CTO Design Intelligence Remediation + Design Brain
 * directive's "Hero Failure" section): a full, analytically-written
 * heroThesis rendered as 30+ lines spanning the entire hero photo and
 * beyond it at 375px. Candidates at or under this length need no splitting.
 */
const LONG_HEADLINE_THRESHOLD = 100;

/** The minimum length a headline segment must retain after a split — guards against splitting on an em dash/period that appears too early to leave a meaningful headline clause. */
const MIN_HEADLINE_SEGMENT = 20;

/**
 * Splits a long headline candidate into a short display headline plus an
 * optional supportingText sentence — structural reformatting of the SAME
 * real content into the two independent hero fields the Structured Design
 * Contract calls for (hero.headline / hero.supportingText), never new
 * content. Prefers an em-dash/hyphen-dash split (common in a "premise —
 * consequence" sentence, e.g. Veslo's real heroThesis), then a sentence
 * boundary, and leaves the text as one unsplit headline when neither
 * exists — the renderer's own length-based responsive sizing is the
 * remaining safety net for that case.
 */
function splitHeroHeadline(text: string): { headline: string; supportingText: string | null } {
  if (text.length <= LONG_HEADLINE_THRESHOLD) return { headline: text, supportingText: null };

  const dashMatch = text.match(/\s[—–-]\s/);
  if (dashMatch && dashMatch.index !== undefined && dashMatch.index >= MIN_HEADLINE_SEGMENT) {
    const splitAt = dashMatch.index;
    let headline = text.slice(0, splitAt).trim();
    if (!/[.!?]$/.test(headline)) headline += ".";
    let rest = text.slice(splitAt + dashMatch[0].length).trim();
    if (rest) rest = rest[0].toUpperCase() + rest.slice(1);
    return { headline, supportingText: rest || null };
  }

  const sentenceMatch = text.match(/[.!?]\s+/);
  if (sentenceMatch && sentenceMatch.index !== undefined && sentenceMatch.index >= MIN_HEADLINE_SEGMENT) {
    const splitAt = sentenceMatch.index + 1;
    const headline = text.slice(0, splitAt).trim();
    const rest = text.slice(splitAt).trim();
    if (rest.length > 0) return { headline, supportingText: rest };
  }

  return { headline: text, supportingText: null };
}

/**
 * True when a metaDescription-derived headline candidate makes a location
 * claim contactEvidence.address can't corroborate — extracted here (rather
 * than inline in buildHeroHeadline) so both the slot-building path and the
 * content-warning path (collectContentWarnings, below) can detect the same
 * condition without duplicating the check.
 */
function hasUnreconciledMetaDescription(context: AssembleComponentsContext): string | null {
  const rawMeta = context.metaDescription?.trim();
  if (!rawMeta) return null;
  const cleaned = stripTrailingCtaAndLocation(rawMeta);
  if (cleaned && conflictsWithContactEvidence(cleaned, context.contactEvidence.address)) return rawMeta;
  return null;
}

/**
 * Telltale phrases indicating a headline candidate describes the design/
 * redesign process or an audit of the business's OLD site, rather than
 * being real, business-voiced marketing copy a visitor to the NEW site
 * would read — the real Veslo/Alltech HVAC/Lakeshore regression (CTO
 * Design Intelligence Remediation + Design Brain directive's Content
 * Boundary rule: internal evidence must never become hero copy). Design
 * Intelligence's Pass 2 critique (violatesContentBoundary,
 * design-intelligence-service.ts) is the primary defense at generation
 * time, but this codebase never trusts an LLM/prompt instruction alone to
 * hold — matchesGenericSaasTemplate and toSafeCssColor follow the same
 * "verify, don't just ask nicely" discipline — so this deterministic
 * render-side backstop keeps contaminated content off the page even if it
 * slips past both LLM passes (as it already did once, in the real data
 * this pattern is drawn from).
 */
const INTERNAL_RATIONALE_PATTERN =
  /\b(site analysis found|accessibility failures?|screen-?reader|keyboard-only|keyboard visitors?|this design(?:'s)?|this site's defining job|current site|old site|existing site|rebuilt site|decoration nobody asked for|built to be the fix)\b/i;

function containsInternalRationaleLanguage(text: string): boolean {
  return INTERNAL_RATIONALE_PATTERN.test(text);
}

function buildHeroHeadline(context: AssembleComponentsContext): ComponentSlot[] {
  const rawMeta = context.metaDescription?.trim();
  if (rawMeta && !hasUnreconciledMetaDescription(context) && !containsInternalRationaleLanguage(rawMeta)) {
    const cleaned = stripTrailingCtaAndLocation(rawMeta);
    if (cleaned) {
      const { headline, supportingText } = splitHeroHeadline(cleaned);
      return [realSlot("headline", headline), supportingText ? realSlot("supportingText", supportingText) : placeholderSlot("supportingText")];
    }
  }
  const heroThesis = context.heroThesis?.trim();
  if (heroThesis && !containsInternalRationaleLanguage(heroThesis)) {
    const { headline, supportingText } = splitHeroHeadline(heroThesis);
    return [realSlot("headline", headline), supportingText ? realSlot("supportingText", supportingText) : placeholderSlot("supportingText")];
  }
  return [placeholderSlot("headline"), placeholderSlot("supportingText")];
}

/**
 * Builds the slots for one section. Every slot is explicitly marked "real"
 * (with the actual value) or "placeholder" (value: null) — never a
 * plausible-sounding invented value standing in for data this pipeline
 * doesn't actually have. The contact section's phone/address/hours slots
 * use context.contactEvidence (the crawl's own captured facts, passed
 * through unchanged) when available and fall back to placeholder otherwise
 * — the same real-vs-placeholder discipline already applied to testimonials.
 * The hero's headline slot is built by buildHeroHeadline above — real,
 * cleaned, evidence-reconciled content, with Design Intelligence's own
 * heroThesis as a real (never fabricated) fallback whenever no usable
 * metaDescription exists. The services section's
 * slots use context.services — real service/offering text the crawler
 * found on the homepage or an already-fetched sub-page (crawl-adapter.ts's
 * mergeStructuredFacts closed the gap where that content was previously
 * discarded after fetching) — one real slot per matched section, capped at
 * MAX_SERVICE_SLOTS, falling back to a single placeholder when nothing was
 * found. credibility's yearsInBusiness/reviewCount/certifications, and
 * menu/gallery's content, remain placeholder-only: confirmed genuinely
 * absent or (Veslo's menu specifically) client-side-rendered and invisible
 * to a plain HTML fetch — a source-site limitation, not a Generation gap.
 */
function buildSlots(section: SectionType, context: AssembleComponentsContext): ComponentSlot[] {
  switch (section) {
    case "hero":
      return [...buildHeroHeadline(context), realSlot("businessName", context.businessName)];
    case "credibility": {
      // yearsInBusiness stays placeholder-only — no crawler signal extracts
      // it today; a genuinely absent evidence source, not a design choice.
      const slots: ComponentSlot[] = [placeholderSlot("yearsInBusiness")];

      slots.push(
        context.reviews && context.reviews.count !== null
          ? realSlot(
              "reviewCount",
              context.reviews.averageRating !== null
                ? `${context.reviews.count} reviews (${context.reviews.averageRating} average)`
                : `${context.reviews.count} reviews`
            )
          : placeholderSlot("reviewCount")
      );

      if (context.certifications && context.certifications.length > 0) {
        context.certifications
          .slice(0, MAX_CERTIFICATION_SLOTS)
          .forEach((c, i) => slots.push(realSlot(`certification-${i + 1}`, c.excerpt)));
      } else {
        slots.push(placeholderSlot("certifications"));
      }

      return slots;
    }
    case "team":
      // A dedicated section (not folded into "credibility") so it gets its
      // own heading and its own editorial treatment instead of surfacing
      // inside "Why choose us" under a raw slot-id label like "TEAM-1" —
      // real regression from the Evidence Depth pass: the generic
      // credibility/contact renderer path (components/design-preview/
      // design-preview.tsx) title-cases each real slot's own internal name
      // as a label, which is appropriate for reviewCount/certification-N but
      // leaked the internal slot id verbatim for team entries.
      //
      // "${heading} — ${excerpt}" mirrors the faq case below: when
      // findTeamMembersByStructure (crawl-adapter.ts) matched a real
      // name+title pair, heading is the real name and excerpt is their real
      // title, so this renders one clean "Carolyn M. Grimes — Partner" line
      // per person through the generic divided-row renderer — not the
      // unstructured "OUR TEAM Attorneys Foster S.B. Friedman Partner
      // Carolyn M. Grimes Partner..." run-on blob a whole-page fallback
      // excerpt produced before that extractor existed (still the fallback
      // for a site with no per-person structural match at all).
      if (context.team && context.team.length > 0) {
        return context.team
          .slice(0, MAX_TEAM_SLOTS)
          .map((t, i) => realSlot(`team-${i + 1}`, `${t.heading} — ${t.excerpt}`));
      }
      return [placeholderSlot("teamMembers")];
    case "services": {
      // "offering-N" is the real practice-area/category name; the
      // "offering-detail-N" companion slot (only emitted when real sub-item
      // evidence exists) is the sub-items belonging to it, e.g.
      // "Divorce, Child Custody, Child Support..." — findServiceMenuStructure
      // (crawl-adapter.ts) sources heading=category, excerpt=joined real
      // sub-items from the business's own nav mega-menu when one exists.
      // Kept as two slots, not one combined string (unlike team's "Name —
      // Title"), so the renderer can give the category name and its
      // supporting detail genuinely different typographic weight — the
      // numbered editorial index this section now gets (design-preview.tsx)
      // rather than the flat "Practice Areas Family Law Family Law
      // Overview Divorce Child Custody..." run-on blob a whole-page
      // fallback excerpt produced before this extractor existed.
      if (context.services && context.services.length > 0) {
        const slots: ComponentSlot[] = [];
        context.services.slice(0, MAX_SERVICE_SLOTS).forEach((section, i) => {
          slots.push(realSlot(`offering-${i + 1}`, section.heading));
          if (section.excerpt) slots.push(realSlot(`offering-detail-${i + 1}`, section.excerpt));
        });
        return slots;
      }
      return [placeholderSlot("offerings")];
    }
    case "menu":
      return [placeholderSlot("menuItems")];
    case "gallery":
      return [placeholderSlot("images")];
    case "schedule":
      return [placeholderSlot("classTimes")];
    case "listings":
      return [placeholderSlot("listings")];
    case "testimonials": {
      if (!context.realTestimonials || context.realTestimonials.length === 0) {
        throw new Error(
          "A wireframe with a \"testimonials\" section requires real testimonial text — this section should only ever be generated when hasRealTestimonials was true (§8's zero-fabrication rule)."
        );
      }
      // A real attribution (e.g. "Carolyn M. Grimes") gets its own slot,
      // named so it's still identifiable as this quote's attribution
      // (testimonial-attribution-N) rather than merged into the quote text
      // itself — the renderer pairs them by index. Omitted entirely (never
      // a placeholder) when the crawler found no real name/attribution next
      // to this quote — never a guessed name (§8).
      const slots: ComponentSlot[] = [];
      context.realTestimonials.forEach((t, i) => {
        slots.push(realSlot(`testimonial-${i + 1}`, t.quote));
        if (t.attribution) slots.push(realSlot(`testimonial-attribution-${i + 1}`, t.attribution));
      });
      return slots;
    }
    case "serviceArea":
      return [placeholderSlot("areasServed")];
    case "faq": {
      // Only the business's own real, already-published FAQ content backs
      // this PUBLIC-facing section now. It used to fall back to reframing a
      // citedInsights statement as a "question" when no real FAQ existed —
      // CTO Design Intelligence Remediation directive, Issue 3: that
      // fallback surfaced raw Lighthouse/axe-style audit findings about the
      // business's OLD site (e.g. "This site has significant barriers for
      // visitors with disabilities... legal risk under... the ADA") as if
      // they were visitor-facing Q&A — not fabricated (citedInsights are
      // real evidence), but the wrong voice/format for public copy, and
      // near-identical across businesses since audit categories repeat. The
      // citation data itself is untouched and still flows through this
      // brief for internal/QA use (design-qa-service.ts's Trust checks,
      // founder-facing brief review) — it's just no longer routed into the
      // public FaqList component. With no real slots, this section is
      // omitted entirely by the renderer's OMIT_SECTION_IF_EMPTY handling
      // (components/design-preview/design-preview.tsx) rather than shown
      // empty or filled with reframed audit copy (§8's zero-fabrication
      // rule: never filler content standing in for a real FAQ that doesn't
      // exist for this business).
      if (context.faqEvidence && context.faqEvidence.length > 0) {
        return context.faqEvidence
          .slice(0, MAX_FAQ_SLOTS)
          .map((f, i) => realSlot(`question-${i + 1}`, `${f.heading} — ${f.excerpt}`));
      }
      return [placeholderSlot("faqContent")];
    }
    case "contact":
      return [
        realSlot("businessName", context.businessName),
        context.contactEvidence.phones.length > 0
          ? realSlot("phone", context.contactEvidence.phones[0])
          : placeholderSlot("phone"),
        context.contactEvidence.address
          ? realSlot("address", context.contactEvidence.address)
          : placeholderSlot("address"),
        context.contactEvidence.hours
          ? realSlot("hours", context.contactEvidence.hours)
          : placeholderSlot("hours"),
      ];
    case "footer":
      // phone reuses context.contactEvidence — already real, already flowing
      // to the contact section's own phone slot above; the footer's own
      // "closing statement" treatment (Premium Presentation Pass, §10) reads
      // better able to restate a real action than end on business-name-only.
      return [
        realSlot("businessName", context.businessName),
        realSlot("copyrightYear", String(new Date().getFullYear())),
        context.contactEvidence.phones.length > 0
          ? realSlot("phone", context.contactEvidence.phones[0])
          : placeholderSlot("phone"),
      ];
  }
}

/**
 * assembleComponents — the Component Assembly pass. Pure function:
 * Wireframe + context in, ComponentNode[] out. Assigns a component kind per
 * section (the hero's kind varies by layout family; every other section's
 * kind is a fixed 1:1 mapping) and populates each slot as real or
 * placeholder per buildSlots above.
 */
export function assembleComponents(
  wireframe: Wireframe,
  context: AssembleComponentsContext
): ComponentNode[] {
  return wireframe.sections.map(({ type }) => {
    const componentKind =
      type === "hero" ? HERO_KIND_BY_LAYOUT_FAMILY[wireframe.layoutFamily] : COMPONENT_KIND_BY_SECTION[type];
    return { section: type, componentKind, slots: buildSlots(type, context) };
  });
}

export interface GenerateWebsiteStructureOptions extends GenerateWireframeOptions {
  realTestimonials?: RealTestimonial[];
  /** Approved per-mission design choices from Design Intelligence. */
  designMemory?: DesignMemory | null;
}

/**
 * A real evidence conflict that was kept off the rendered page (CTO Design
 * Intelligence Remediation + Design Brain directive's "Evidence Conflict
 * Handling": conflicting claims must never reach customers, but must also
 * never be silently discarded — preserved here for Founder/QA review
 * instead). Never rendered by components/design-preview/design-preview.tsx;
 * consumed only by runDesignGeneration's logging/event-publishing and
 * whatever future founder-facing QA surface wants to display it.
 */
export interface ContentWarning {
  section: SectionType;
  field: string;
  rejectedValue: string;
  reason: string;
}

/** Pure detection pass, run alongside (never inside) assembleComponents — keeps assembleComponents's return type unchanged for its many existing callers/tests while still surfacing conflicts for review. */
export function collectContentWarnings(context: AssembleComponentsContext): ContentWarning[] {
  const warnings: ContentWarning[] = [];
  const rejectedMeta = hasUnreconciledMetaDescription(context);
  if (rejectedMeta) {
    warnings.push({
      section: "hero",
      field: "headline",
      rejectedValue: rejectedMeta,
      reason: `metaDescription's location claim conflicts with contactEvidence.address (${context.contactEvidence.address ?? "no verified address captured"}) — dropped rather than rendered; heroThesis used instead where available.`,
    });
  }

  const rawMeta = context.metaDescription?.trim();
  if (rawMeta && containsInternalRationaleLanguage(rawMeta)) {
    warnings.push({
      section: "hero",
      field: "headline",
      rejectedValue: rawMeta,
      reason: "metaDescription reads as internal design rationale/audit commentary rather than customer-facing copy — dropped rather than rendered.",
    });
  }

  const heroThesis = context.heroThesis?.trim();
  if (heroThesis && containsInternalRationaleLanguage(heroThesis)) {
    warnings.push({
      section: "hero",
      field: "headline",
      rejectedValue: heroThesis,
      reason: "heroThesis reads as internal design rationale/audit commentary about the old site or the redesign process, not customer-facing copy — dropped rather than rendered (hero headline may fall to placeholder as a result). This Design Brief should be regenerated to get a clean, business-voiced heroThesis.",
    });
  }

  return warnings;
}

export interface WebsiteStructure {
  wireframe: Wireframe;
  components: ComponentNode[];
  refinedDesign: RefinedDesign;
  /** Real evidence conflicts detected and kept off the page — see ContentWarning. Empty when nothing conflicted. */
  contentWarnings: ContentWarning[];
}

/** Convenience entry point composing the two passes above, mirroring how insight-service/opportunity-scoring-service compose at call sites. */
export function generateWebsiteStructure(
  brief: DesignBrief,
  options: GenerateWebsiteStructureOptions
): WebsiteStructure {
  const wireframe = generateWireframe(brief, options);
  const assembleContext: AssembleComponentsContext = {
    businessName: brief.businessName,
    citedInsights: brief.citedInsights,
    realTestimonials: options.realTestimonials,
    contactEvidence: brief.contactEvidence,
    metaDescription: brief.metaDescription,
    heroThesis: brief.heroThesis,
    services: brief.services,
    certifications: brief.certifications,
    team: brief.team,
    faqEvidence: brief.faqEvidence,
    reviews: brief.reviews,
  };
  const components = assembleComponents(wireframe, assembleContext);
  const contentWarnings = collectContentWarnings(assembleContext);
  const refinedDesign = refineDesign({ wireframe }, brief, options.designMemory);
  return { wireframe, components, refinedDesign, contentWarnings };
}

// ===========================================================================
// Orchestration — mirrors design-brief-service.ts's run shape, which
// mirrors analysis-service.ts's (ADR-012).
// ===========================================================================

type TypedClient = SupabaseClient<Database>;

export interface DesignGenerationServiceDeps {
  client: TypedClient;
  websiteDesignRepository: typeof websiteDesignRepository;
  designBriefRepository: typeof designBriefRepository;
  missionRepository: typeof missionRepository;
  eventBus: EventBus;
}

export function createDesignGenerationServiceDeps(client: TypedClient): DesignGenerationServiceDeps {
  return {
    client,
    websiteDesignRepository,
    designBriefRepository,
    missionRepository,
    eventBus: createEventBus(client),
  };
}

export interface CreateDesignGenerationRunInput {
  designBriefId: string;
  missionId: string;
  organizationId: string;
}

/** The fast, synchronous half: creates the `website_designs` row at `status: 'pending'` and returns immediately, mirroring createDesignBriefRun/createAnalysisRun. */
export async function createDesignGenerationRun(
  deps: DesignGenerationServiceDeps,
  input: CreateDesignGenerationRunInput
): Promise<WebsiteDesignRow> {
  return deps.websiteDesignRepository.insert(deps.client, {
    design_brief_id: input.designBriefId,
    mission_id: input.missionId,
    organization_id: input.organizationId,
    status: "pending",
  });
}

/**
 * Runs the Wireframe + Component Assembly passes for an existing
 * `website_designs` row. Requires the mission to already be at `designing`
 * — which now only happens after a human has called approveDesignBrief()
 * (docs/ARCHITECTURE_SPECIFICATION_V1.md's Founder Approval Gate, item 2;
 * design-brief-service.ts) — and the referenced design brief to be
 * complete. Does NOT transition mission state
 * on completion — per the founder's Phase 2 guidance, Generation assembles,
 * it doesn't judge; only a future design-qa-service.ts (Phase 3) owns the
 * `designing -> qa` transition.
 *
 * realTestimonials is real, evidence-driven: hasRealTestimonials and the
 * testimonial text itself come from brief.testimonials (the crawler's
 * mergeStructuredFacts output — homepage plus already-fetched sub-pages,
 * see crawl-adapter.ts). A wireframe includes the "testimonials" section
 * only when real testimonial text actually exists for this business (§8) —
 * confirmed real, e.g. for a law firm whose own testimonials page the
 * crawler already fetches, and correctly absent for a business with none.
 */
export async function runDesignGeneration(
  deps: DesignGenerationServiceDeps,
  websiteDesignId: string
): Promise<WebsiteDesignRow> {
  const run = await deps.websiteDesignRepository.findById(deps.client, websiteDesignId);
  if (!run) {
    throw new Error(`Website design run ${websiteDesignId} not found.`);
  }

  const mission = await deps.missionRepository.findById(deps.client, run.mission_id);
  if (!mission) {
    throw new Error(`Mission ${run.mission_id} not found.`);
  }

  await deps.websiteDesignRepository.update(deps.client, websiteDesignId, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  try {
    if (mission.state !== "designing") {
      throw new Error(
        `Mission ${mission.id} is at state "${mission.state}", not "designing" — Wireframe/Component Assembly requires a completed Design Brief to have already moved the mission into designing.`
      );
    }

    const briefRow = await deps.designBriefRepository.findById(deps.client, run.design_brief_id);
    if (!briefRow || briefRow.status !== "complete" || !briefRow.brief) {
      throw new Error("No completed Design Brief found for this run — Wireframe/Component Assembly requires one first.");
    }

    const brief = briefRow.brief as unknown as DesignBrief;
    const designMemory = briefRow.design_memory as unknown as DesignMemory | null;
    // attribution stays null (never guessed) when the crawler only found the
    // generic GENERIC_TESTIMONIAL_HEADING fallback rather than a real
    // structurally-present name (crawl-adapter.ts's findTestimonialsByStructure).
    const realTestimonials: RealTestimonial[] = (brief.testimonials ?? []).map((section) => ({
      quote: section.excerpt,
      attribution: section.heading !== GENERIC_TESTIMONIAL_HEADING ? section.heading : null,
    }));
    const { wireframe, components, refinedDesign, contentWarnings } = generateWebsiteStructure(brief, {
      hasRealTestimonials: realTestimonials.length > 0,
      hasRealTeam: (brief.team ?? []).length > 0,
      realTestimonials,
      designMemory,
    });

    // Real evidence conflicts are never rendered, but must never be silently
    // discarded either (CTO Design Intelligence Remediation + Design Brain
    // directive's "Evidence Conflict Handling") — logged in full here, the
    // same visibility precedent this file's own Anthropic-usage logging
    // already established for design-brief-service.ts, and surfaced as a
    // count on the published event below for anyone reviewing mission_events.
    for (const warning of contentWarnings) {
      // eslint-disable-next-line no-console
      console.warn(
        `[website-design ${websiteDesignId}] content warning: ${warning.section}.${warning.field} rejected ("${warning.rejectedValue}") — ${warning.reason}`
      );
    }

    const updated = await deps.websiteDesignRepository.update(deps.client, websiteDesignId, {
      status: "complete",
      completed_at: new Date().toISOString(),
      wireframe: wireframe as unknown as Json,
      components: components as unknown as Json,
      refined_design: refinedDesign as unknown as Json,
    });

    await deps.eventBus.publish({
      type: "WebsiteDesignReady",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: {
        sectionCount: wireframe.sections.length,
        layoutFamily: wireframe.layoutFamily,
        contentWarningCount: contentWarnings.length,
      },
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Website design generation failed for an unknown reason.";

    const failed = await deps.websiteDesignRepository.update(deps.client, websiteDesignId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
    });

    await deps.eventBus.publish({
      type: "WebsiteDesignFailed",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: { errorMessage: message },
    });

    return failed;
  }
}
