import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import type { DesignBrief, DesignBriefCitation } from "@/lib/services/design-brief-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import { refineDesign, type RefinedDesign } from "@/lib/services/design-refinement-service";
import type { LayoutFamily } from "@/lib/design-intelligence/layout-rules";
import { matchesGenericSaasTemplate } from "@/lib/design-intelligence/layout-rules";
import type { IndustryBucket } from "@/lib/design-references/reference-library";
import type { ContactInfo } from "@/lib/adapters/types";

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

export interface GenerateWireframeOptions {
  /** True only when real, already-captured testimonial data exists for this mission — never assumed (§8). */
  hasRealTestimonials: boolean;
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
  const sectionOrder = options.hasRealTestimonials ? insertBeforeContact(baseOrder, "testimonials") : baseOrder;

  if (matchesGenericSaasTemplate(sectionOrder)) {
    throw new Error(
      "Generated wireframe matched the banned generic-SaaS-template pattern (lib/design-intelligence/layout-rules.ts) — this indicates a wireframe-template bug, not a valid output."
    );
  }

  return {
    layoutFamily: brief.direction.layoutFamily,
    sections: sectionOrder.map((type) => ({ type, rationale: RATIONALE_BY_SECTION[type] })),
  };
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

export interface AssembleComponentsContext {
  businessName: string;
  citedInsights: DesignBriefCitation[];
  /** Real testimonial text, when captured — required if the wireframe includes a "testimonials" section (see generateWireframe's hasRealTestimonials gate). */
  realTestimonials?: string[];
  /** Real, mechanically-extracted contact facts (DesignBrief.contactEvidence) — each field renders as a real slot only when actually captured; missing fields stay honestly placeholder, never invented (§8). */
  contactEvidence: ContactInfo;
  /** DesignBrief.metaDescription passed through unchanged — the business's own real published homepage copy, used as real hero headline content when present (§8: reusing a business's own words is not fabrication). */
  metaDescription?: string | null;
}

function realSlot(name: string, value: string): ComponentSlot {
  return { name, source: "real", value };
}

function placeholderSlot(name: string): ComponentSlot {
  return { name, source: "placeholder", value: null };
}

/**
 * Builds the slots for one section. Every slot is explicitly marked "real"
 * (with the actual value) or "placeholder" (value: null) — never a
 * plausible-sounding invented value standing in for data this pipeline
 * doesn't actually have. The contact section's phone/address/hours slots
 * use context.contactEvidence (the crawl's own captured facts, passed
 * through unchanged) when available and fall back to placeholder otherwise
 * — the same real-vs-placeholder discipline already applied to testimonials.
 * The hero's headline slot uses context.metaDescription — the business's
 * own real, published `<meta name="description">` copy — when the crawl
 * captured one, for the same reason: it's real content the business
 * already publishes, not an invented tagline (§8). credibility's
 * yearsInBusiness/reviewCount/certifications, and services/menu/gallery's
 * content, remain placeholder-only: the crawl adapter's keyword/CSS-class
 * heuristic (findSectionsByKeywords) does not reliably extract these from
 * page-builder-generated sites (Wix/WordPress theme markup rarely exposes
 * matching class/id names) — confirmed empty across all five real
 * businesses in the industry benchmark, not a per-business gap. A crawler
 * fix, not a Generation fix — out of scope here.
 */
function buildSlots(section: SectionType, context: AssembleComponentsContext): ComponentSlot[] {
  switch (section) {
    case "hero":
      return [
        context.metaDescription
          ? realSlot("headline", context.metaDescription)
          : placeholderSlot("headline"),
        realSlot("businessName", context.businessName),
      ];
    case "credibility":
      return [placeholderSlot("yearsInBusiness"), placeholderSlot("reviewCount"), placeholderSlot("certifications")];
    case "services":
      return [placeholderSlot("offerings")];
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
      return context.realTestimonials.map((text, i) => realSlot(`testimonial-${i + 1}`, text));
    }
    case "serviceArea":
      return [placeholderSlot("areasServed")];
    case "faq": {
      const uniqueCategories = [...new Set(context.citedInsights.map((c) => c.category))].slice(0, MAX_FAQ_SLOTS);
      return uniqueCategories.map((category) => {
        const citation = context.citedInsights.find((c) => c.category === category)!;
        return realSlot(`question-${category}`, citation.statement);
      });
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
      return [realSlot("businessName", context.businessName), realSlot("copyrightYear", String(new Date().getFullYear()))];
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
  realTestimonials?: string[];
  /** Approved per-mission design choices from Design Intelligence. */
  designMemory?: DesignMemory | null;
}

export interface WebsiteStructure {
  wireframe: Wireframe;
  components: ComponentNode[];
  refinedDesign: RefinedDesign;
}

/** Convenience entry point composing the two passes above, mirroring how insight-service/opportunity-scoring-service compose at call sites. */
export function generateWebsiteStructure(
  brief: DesignBrief,
  options: GenerateWebsiteStructureOptions
): WebsiteStructure {
  const wireframe = generateWireframe(brief, options);
  const components = assembleComponents(wireframe, {
    businessName: brief.businessName,
    citedInsights: brief.citedInsights,
    realTestimonials: options.realTestimonials,
    contactEvidence: brief.contactEvidence,
    metaDescription: brief.metaDescription,
  });
  const refinedDesign = refineDesign({ wireframe }, brief, options.designMemory);
  return { wireframe, components, refinedDesign };
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
 * realTestimonials is hardcoded to none today: no capture pathway for real
 * testimonial data exists anywhere in this codebase yet, so honestly
 * omitting the testimonials section (rather than guessing) is the only
 * correct behavior available (§8).
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
    const { wireframe, components, refinedDesign } = generateWebsiteStructure(brief, {
      hasRealTestimonials: false,
      designMemory,
    });

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
      payload: { sectionCount: wireframe.sections.length, layoutFamily: wireframe.layoutFamily },
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
