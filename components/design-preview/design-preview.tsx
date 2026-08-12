import * as React from "react";

import type { ComponentNode, SectionType, Wireframe } from "@/lib/services/design-generation-service";
import type { RefinedDesign } from "@/lib/services/design-refinement-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import {
  findSectionSpacing,
  findSectionMotion,
  findTypeRole,
  findTouchTarget,
  remToPx,
  SECTION_HEADING_LABEL,
} from "@/lib/design-render/style-helpers";
import { toSafeCssColor, toSafeFontFamilyStack, toCssFontWeight, MUTED_TEXT_OPACITY } from "@/lib/design-render/safe-css";
import { SlotValue, isRealSlot } from "@/components/design-preview/slot-value";

/**
 * components/design-preview/design-preview.tsx — the typed renderer at the
 * center of the rendering capability (docs/SPRINT_4_PHASE_4_DESIGN_REVIEW.md
 * §3's "there is no renderer yet" gap). Consumes the real, structured Design
 * JSON produced by lib/services/design-generation-service.ts (Wireframe,
 * ComponentNode[]) and lib/services/design-refinement-service.ts
 * (RefinedDesign) directly — every value on screen traces to a field on one
 * of these three objects or to DesignMemory's own fields, never to text this
 * component invents. No LLM call happens here; this is a pure mapping from
 * already-generated data to JSX, preserving the Design Intelligence →
 * Generation → Refinement → Rendering separation this project holds to
 * everywhere else.
 *
 * Deliberately NOT built as one component per componentKind (17 kinds,
 * several near-identical) — rendering is keyed off the 12-value SectionType
 * instead. Per the task's explicit instruction: reuse, don't invent a new
 * design language or a large component library.
 *
 * Customer-facing by design (Product Surface Pass, Priority 3): a slot with
 * no real evidence renders nothing (SlotValue), and a whole section with no
 * real slots at all is omitted outright (OMIT_SECTION_IF_EMPTY below) —
 * never the internal `[Field — placeholder]` debug syntax this component
 * used to show, and never a fabricated value standing in for one.
 *
 * Responsive by construction, not by a separate mobile variant: this data
 * model represents a page as a single ordered column
 * (RefinedDesign.mobile.singleColumnVerified, "true by data-model
 * construction") — the one <style> block below only ever adjusts type size
 * and touch-target sizing at narrow widths, using RefinedDesign.mobile's own
 * computed values, never a second hardcoded "mobile" data source.
 */

export interface DesignPreviewProps {
  businessName: string;
  wireframe: Wireframe;
  components: ComponentNode[];
  refinedDesign: RefinedDesign;
  designMemory: DesignMemory | null;
  /**
   * A freshly-resolved signed URL for this mission's real, already-captured
   * website screenshot (app/missions/[id]/preview/page.tsx resolves it at
   * request time — see that file's comment on why it's never persisted).
   * Real business photography when a screenshot exists; `null` and
   * gracefully omitted otherwise (§8 — never a stock/placeholder image
   * standing in for one that was never captured).
   */
  heroImageUrl: string | null;
}

const FALLBACK = {
  neutral: "#FAF7F2",
  primary: "#1E3A5F",
  secondary: "#0B1220",
  accent: "#C9A227",
  text: "#1A1A1A",
  onDark: "#FAFAFA",
};

const FALLBACK_HEADING_STACK = "Georgia, 'Times New Roman', serif";
const FALLBACK_BODY_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const MOBILE_BREAKPOINT_PX = 480;

/** Below this headline length, no responsive display-size damping is applied at all — see SectionBody's hero case. */
const LONG_HEADLINE_SCALE_THRESHOLD = 90;

/**
 * Sections whose entire content can legitimately be nothing but placeholder
 * slots (menu items, service descriptions, credibility stats, gallery
 * images — none of which the crawler extracts today). Per the Product
 * Surface Pass's placeholder rule: when a section has zero real slots, the
 * graceful behavior is to omit the section entirely, not render an empty
 * shell. hero/footer/contact are excluded — they always carry at least the
 * real business name, so they're never fully empty. testimonials is
 * excluded because generateWebsiteStructure only ever includes it in the
 * wireframe when real testimonial content backs it. faq is included here
 * (CTO Design Intelligence Remediation directive, Issue 3): the wireframe's
 * per-bucket templates include "faq" unconditionally, but
 * design-generation-service.ts::buildSlots("faq", ...) now only populates
 * real slots from the business's own real, already-published FAQ content —
 * it no longer falls back to reframing citedInsights (audit findings about
 * the OLD site) as public-facing questions — so a business with no real FAQ
 * evidence correctly has zero real faq slots and belongs in this list.
 */
const OMIT_SECTION_IF_EMPTY: SectionType[] = [
  "menu",
  "gallery",
  "services",
  "schedule",
  "listings",
  "serviceArea",
  "credibility",
  "faq",
];

function hasRealContent(node: ComponentNode): boolean {
  return node.slots.some(isRealSlot);
}

export function DesignPreview({
  businessName,
  wireframe,
  components,
  refinedDesign,
  designMemory,
  heroImageUrl,
}: DesignPreviewProps) {
  const palette = designMemory?.colorPalette;
  const neutral = toSafeCssColor(palette?.neutral, FALLBACK.neutral);
  const primary = toSafeCssColor(palette?.primary, FALLBACK.primary);
  const secondary = toSafeCssColor(palette?.secondary, FALLBACK.secondary);
  const accent = toSafeCssColor(palette?.accent, FALLBACK.accent);

  const headingFontStack = toSafeFontFamilyStack(designMemory?.typography.headingFamily, FALLBACK_HEADING_STACK);
  const bodyFontStack = toSafeFontFamilyStack(designMemory?.typography.bodyFamily, FALLBACK_BODY_STACK);

  const bodyRole = findTypeRole(refinedDesign, "body");
  const desktopBodyPx = bodyRole?.sizePx ?? 16;
  const mobileBodyPx = refinedDesign.mobile.bodyFontSizePx;

  const componentsBySection = new Map(components.map((c) => [c.section, c]));

  return (
    <div
      data-design-preview
      style={{
        backgroundColor: neutral,
        color: FALLBACK.text,
        fontFamily: bodyFontStack,
        fontSize: `${desktopBodyPx}px`,
        lineHeight: refinedDesign.typography.bodyLineHeight,
      }}
    >
      {/* The only rendered CSS beyond inline styles: mobile overrides sourced directly from RefinedDesign.mobile, never a second hand-authored mobile spec. */}
      <style>{`
        @keyframes op-fade-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        [data-design-preview] a, [data-design-preview] button { font-family: inherit; }
        @media (max-width: ${MOBILE_BREAKPOINT_PX}px) {
          [data-design-preview] { font-size: ${mobileBodyPx}px !important; }
          [data-op-touch-target] { min-width: var(--op-tt-w); min-height: var(--op-tt-h); }
        }
      `}</style>

      {wireframe.sections.map(({ type, rationale }) => {
        const node = componentsBySection.get(type);
        if (!node) return null;
        if (OMIT_SECTION_IF_EMPTY.includes(type) && !hasRealContent(node)) return null;
        return (
          <SectionShell
            key={type}
            section={type}
            refinedDesign={refinedDesign}
            rationale={rationale}
            background={type === "footer" ? secondary : type === "hero" ? primary : neutral}
            foreground={type === "footer" || type === "hero" ? FALLBACK.onDark : FALLBACK.text}
            backgroundImageUrl={type === "hero" ? heroImageUrl : null}
          >
            <SectionBody
              node={node}
              refinedDesign={refinedDesign}
              headingFontStack={headingFontStack}
              accent={accent}
              textColor={type === "footer" || type === "hero" ? FALLBACK.onDark : FALLBACK.text}
            />
          </SectionShell>
        );
      })}
    </div>
  );
}

function SectionShell({
  section,
  refinedDesign,
  rationale,
  background,
  foreground,
  backgroundImageUrl,
  children,
}: {
  section: SectionType;
  refinedDesign: RefinedDesign;
  rationale: string;
  background: string;
  foreground: string;
  /** Real, already-captured business photography (see DesignPreviewProps.heroImageUrl) — currently only ever passed for "hero". */
  backgroundImageUrl?: string | null;
  children: React.ReactNode;
}) {
  const spacing = findSectionSpacing(refinedDesign, section);
  const motion = findSectionMotion(refinedDesign, section);
  const paddingRem = spacing?.sectionPaddingRem ?? 4;

  return (
    <section
      data-section={section}
      title={rationale}
      style={{
        backgroundColor: background,
        // A fixed 0.6-opacity black scrim under the real photo, not a
        // guessed value: hero text always renders in FALLBACK.onDark
        // (near-white) regardless of the photo's own colors, and a scrim
        // this dark keeps that pairing readable against any real
        // photograph — the same "reuse an already-safe pairing rather than
        // introduce a new, unvalidated one" discipline as the CTA borders
        // in TouchAffordance above.
        backgroundImage: backgroundImageUrl
          ? `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url("${backgroundImageUrl}")`
          : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: foreground,
        padding: `${paddingRem}rem 1.5rem`,
        borderTop: section === "hero" ? "none" : "1px solid rgba(0,0,0,0.08)",
        animation: motion ? `op-fade-in ${motion.durationMs}ms ${motion.easing} both` : undefined,
      }}
    >
      <div style={{ maxWidth: "72rem", margin: "0 auto" }}>{children}</div>
    </section>
  );
}

function SectionHeading({
  section,
  refinedDesign,
  fontStack,
  color,
}: {
  section: SectionType;
  refinedDesign: RefinedDesign;
  fontStack: string;
  color: string;
}) {
  const label = SECTION_HEADING_LABEL[section];
  if (!label) return null;
  const role = findTypeRole(refinedDesign, "heading2");
  return (
    <h2
      style={{
        fontFamily: fontStack,
        fontSize: role ? `${role.sizePx}px` : "1.75rem",
        fontWeight: role ? toCssFontWeight(role.weight) : 600,
        marginBottom: "1rem",
        color,
      }}
    >
      {label}
    </h2>
  );
}

/**
 * A real, styled call-to-action button — sized from RefinedDesign.mobile's
 * own real computed touch-target dimensions. `label` is deliberately always
 * generic, standard interface copy ("Contact Us", "Get in Touch") rather
 * than a business-specific claim — that's UI convention, not evidence, so
 * it's never subject to the fabrication rule the slot values above it are
 * held to.
 *
 * Text color intentionally reuses the section's own already-chosen
 * foreground (`textColor`, the same value every heading/label in this
 * section already renders in) rather than pairing the accent color as a
 * fill against a guessed contrasting text color — introducing a new,
 * unvalidated background/foreground pairing here is exactly the class of
 * bug the shared MUTED_TEXT_OPACITY fix (safe-css.ts) already had to
 * correct once this session; the accent is used only as a border; a
 * non-text UI element, held to a looser contrast bar than body text.
 */
function TouchAffordance({
  refinedDesign,
  section,
  label,
  accent,
  textColor,
}: {
  refinedDesign: RefinedDesign;
  section: SectionType;
  label: string;
  accent: string;
  textColor: string;
}) {
  const target = findTouchTarget(refinedDesign, section);
  if (!target) return null;
  return (
    <span
      data-op-touch-target
      style={
        {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: `${target.widthPx}px`,
          minHeight: `${target.heightPx}px`,
          padding: "0.5rem 1.5rem",
          border: `1.5px solid ${accent}`,
          color: textColor,
          borderRadius: "0.375rem",
          marginTop: "1rem",
          fontWeight: 500,
          fontSize: "0.9em",
          "--op-tt-w": `${target.widthPx}px`,
          "--op-tt-h": `${target.heightPx}px`,
        } as React.CSSProperties
      }
    >
      {label}
    </span>
  );
}

function SectionBody({
  node,
  refinedDesign,
  headingFontStack,
  accent,
  textColor,
}: {
  node: ComponentNode;
  refinedDesign: RefinedDesign;
  headingFontStack: string;
  accent: string;
  textColor: string;
}) {
  const section = node.section;

  if (section === "hero") {
    const headline = node.slots.find((s) => s.name === "headline");
    const supportingText = node.slots.find((s) => s.name === "supportingText");
    const name = node.slots.find((s) => s.name === "businessName");
    const displayRole = findTypeRole(refinedDesign, "display");
    const baseDisplayPx = displayRole?.sizePx ?? 40;
    // A headline that survived design-generation-service.ts's
    // splitHeroHeadline still unsplit (no natural em-dash/sentence break)
    // can legitimately run long — this is the renderer's own remaining
    // safety net so that case never re-balloons into 30+ lines of
    // full-size display text at mobile widths (CTO Design Intelligence
    // Remediation + Design Brain directive's "Hero Failure"/Veslo
    // regression): scale display size down as headline length grows,
    // rather than rendering every headline at a fixed size regardless of
    // how much real text it actually carries.
    const headlineLength = headline && isRealSlot(headline) ? headline.value!.length : 0;
    const lengthScale = headlineLength > 220 ? 0.6 : headlineLength > 140 ? 0.75 : headlineLength > LONG_HEADLINE_SCALE_THRESHOLD ? 0.88 : 1;
    return (
      <div>
        {name && isRealSlot(name) && (
          <p style={{ fontWeight: 600, marginBottom: "0.75rem" }}>
            <SlotValue slot={name} />
          </p>
        )}
        {headline && isRealSlot(headline) && (
          <div
            style={{
              fontFamily: headingFontStack,
              fontSize: `${Math.round(baseDisplayPx * lengthScale)}px`,
              fontWeight: displayRole ? toCssFontWeight(displayRole.weight) : 600,
            }}
          >
            <SlotValue slot={headline} />
          </div>
        )}
        {supportingText && isRealSlot(supportingText) && (
          <p
            style={{
              fontFamily: headingFontStack,
              fontSize: "1.1em",
              fontWeight: 400,
              marginTop: "1rem",
              opacity: MUTED_TEXT_OPACITY,
              maxWidth: "48rem",
            }}
          >
            <SlotValue slot={supportingText} />
          </p>
        )}
        <TouchAffordance refinedDesign={refinedDesign} section="hero" label="Get in Touch" accent={accent} textColor={textColor} />
      </div>
    );
  }

  if (section === "footer") {
    const name = node.slots.find((s) => s.name === "businessName");
    const year = node.slots.find((s) => s.name === "copyrightYear");
    return (
      <p style={{ fontSize: "0.85rem", opacity: MUTED_TEXT_OPACITY }}>
        {name && isRealSlot(name) && <SlotValue slot={name} />}
        {year && isRealSlot(year) && (
          <>
            {" "}
            © <SlotValue slot={year} />
          </>
        )}
      </p>
    );
  }

  if (section === "faq") {
    return (
      <div>
        <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} />
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {node.slots.filter(isRealSlot).map((slot) => (
            <details key={slot.name} style={{ border: `1px solid ${accent}33`, borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
              <summary
                data-op-touch-target
                style={{ cursor: "pointer", fontWeight: 500, minHeight: findTouchTarget(refinedDesign, "faq")?.heightPx ?? undefined }}
              >
                <SlotValue slot={slot} />
              </summary>
            </details>
          ))}
        </div>
      </div>
    );
  }

  if (section === "testimonials") {
    return (
      <div>
        <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${remToPx(refinedDesign.layout.grid.gutterRem) + 200}px, 1fr))`, gap: `${refinedDesign.layout.grid.gutterRem}rem` }}>
          {node.slots.filter(isRealSlot).map((slot) => (
            <blockquote key={slot.name} style={{ margin: 0, padding: "1rem", border: `1px solid ${accent}33`, borderRadius: "0.5rem" }}>
              <SlotValue slot={slot} />
            </blockquote>
          ))}
        </div>
      </div>
    );
  }

  if (section === "credibility" || section === "contact") {
    const realSlots = node.slots.filter(isRealSlot);
    if (realSlots.length === 0) return null;
    const touchLabel = section === "contact" ? "Contact Us" : undefined;
    return (
      <div>
        <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
          {realSlots.map((slot) => (
            <div key={slot.name} style={{ minWidth: "10rem" }}>
              <p style={{ fontSize: "0.75rem", textTransform: "uppercase", opacity: MUTED_TEXT_OPACITY, marginBottom: "0.25rem" }}>
                {slot.name.replace(/([a-z])([A-Z])/g, "$1 $2")}
              </p>
              <SlotValue slot={slot} />
            </div>
          ))}
        </div>
        {touchLabel && <TouchAffordance refinedDesign={refinedDesign} section="contact" label={touchLabel} accent={accent} textColor={textColor} />}
      </div>
    );
  }

  // Single-slot structural sections (services, menu, gallery, schedule, listings, serviceArea):
  // exactly as many real blocks as buildSlots() actually produced real values for — never a
  // fabricated multi-item grid, and never a placeholder-only grid (the outer OMIT_SECTION_IF_EMPTY
  // check already keeps a fully-empty one of these from reaching this function at all).
  const realSlots = node.slots.filter(isRealSlot);
  const touchLabel =
    section === "schedule" ? "Book Now" : section === "listings" ? "View Listing" : undefined;
  return (
    <div>
      <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} />
      <div style={{ display: "grid", gap: `${refinedDesign.layout.grid.gutterRem}rem` }}>
        {realSlots.map((slot) => (
          <div
            key={slot.name}
            style={{
              padding: "2rem",
              border: `1px solid ${textColor}22`,
              borderRadius: "0.5rem",
              textAlign: "center",
            }}
          >
            <SlotValue slot={slot} />
          </div>
        ))}
      </div>
      {touchLabel && <TouchAffordance refinedDesign={refinedDesign} section={section} label={touchLabel} accent={accent} textColor={textColor} />}
    </div>
  );
}
