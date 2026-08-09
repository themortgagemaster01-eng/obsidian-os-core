import type { SectionType } from "@/lib/services/design-generation-service";
import type {
  RefinedDesign,
  SectionMotionValue,
  SectionSpacingValue,
  TypeRoleValue,
} from "@/lib/services/design-refinement-service";
import type { TypeRole } from "@/lib/design-intelligence/types";
import type { TouchTarget } from "@/lib/design-intelligence/mobile-rules";

/**
 * lib/design-render/style-helpers.ts — pure lookups over a RefinedDesign
 * (lib/services/design-refinement-service.ts), keyed by SectionType/TypeRole.
 * No JSX, no Supabase, no defaults invented beyond what RefinedDesign itself
 * already guarantees (refineSpacing/refineMotion/refineMobile always produce
 * an entry for every section they apply to) — this module only does lookup
 * and unit conversion, never generates a design decision of its own.
 */

/** Every RefinedDesign.spacing.sectionSpacing entry is produced by refineSpacing() from the wireframe's own section list, so a lookup miss should be unreachable for a section that's actually in the wireframe — this still returns undefined rather than throwing, so a caller can render a safe fallback instead of crashing the whole preview over one inconsistent record. */
export function findSectionSpacing(
  refinedDesign: RefinedDesign,
  section: SectionType
): SectionSpacingValue | undefined {
  return refinedDesign.spacing.sectionSpacing.find((s) => s.section === section);
}

/** NO_MOTION_SECTIONS (design-refinement-service.ts) — currently just "footer" — legitimately has no entry here; undefined means "no motion for this section," not a data error. */
export function findSectionMotion(
  refinedDesign: RefinedDesign,
  section: SectionType
): SectionMotionValue | undefined {
  return refinedDesign.motion.motions.find((m) => m.section === section);
}

export function findTypeRole(refinedDesign: RefinedDesign, role: TypeRole): TypeRoleValue | undefined {
  return refinedDesign.typography.scale.find((s) => s.role === role);
}

export function remToPx(rem: number): number {
  return rem * 16;
}

/** Structural section labels — describe what kind of section this is, not business-specific content. Distinct from ComponentSlot content, which is the only place real/placeholder business data lives. */
export const SECTION_HEADING_LABEL: Record<SectionType, string> = {
  hero: "",
  credibility: "Why choose us",
  services: "Services",
  menu: "Menu",
  gallery: "Gallery",
  schedule: "Class schedule",
  listings: "Current listings",
  testimonials: "What our customers say",
  serviceArea: "Areas we serve",
  faq: "Frequently asked questions",
  contact: "Get in touch",
  footer: "",
};

/**
 * Mirrors design-refinement-service.ts's own (private, unexported)
 * TOUCH_TARGET_NAME_BY_SECTION — sections refineMobile() computed a real
 * touch-target entry for (INTERACTIVE_SECTIONS). Duplicated rather than
 * imported because the service doesn't export it; kept here only to decide
 * whether to render a sized interactive affordance at all, never to
 * recompute a touch-target value independently of RefinedDesign.mobile.
 */
export const TOUCH_TARGET_NAME_BY_SECTION: Partial<Record<SectionType, string>> = {
  hero: "hero-primary-cta",
  contact: "contact-primary-action",
  faq: "faq-accordion-toggle",
  schedule: "schedule-book-button",
  listings: "listing-view-button",
};

/** Looks up the RefinedDesign.mobile touch target for a section, via the name mapping above — returns undefined for a non-interactive section, which the renderer treats as "no sized affordance to draw," not an error. */
export function findTouchTarget(refinedDesign: RefinedDesign, section: SectionType): TouchTarget | undefined {
  const name = TOUCH_TARGET_NAME_BY_SECTION[section];
  if (!name) return undefined;
  return refinedDesign.mobile.touchTargets.find((t) => t.name === name);
}
