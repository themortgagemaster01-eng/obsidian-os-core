import * as React from "react";

import type { ComponentNode, SectionType, Wireframe } from "@/lib/services/design-generation-service";
import { resolveSignatureSection } from "@/lib/services/design-generation-service";
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
import {
  toSafeCssColor,
  toSafeFontFamilyStack,
  toCssFontWeight,
  MUTED_TEXT_OPACITY,
  getReadableTextColor,
  relativeLuminanceOfCssColor,
} from "@/lib/design-render/safe-css";
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
 * Premium Presentation Pass (flagship: Friedman, Grimes, Meinken & Leischner
 * PLLC) — this file was reworked from "one uniform section shell + a generic
 * per-SectionType body" into a composition that varies by real signal
 * (whether a section carries the wireframe's one signatureElement, whether a
 * section is single- vs. multi-slot, whether the hero has a real photo) —
 * still fully reusable/data-driven: no `if businessName === ...` anywhere in
 * this file. Three renderer-level additions worth naming here since they
 * don't correspond to a single line elsewhere: a generated top Nav (site
 * links + a real phone utility, never a fabricated menu item), section
 * anchors so Nav can actually navigate, and per-section motion respecting
 * `prefers-reduced-motion` (previously unconditional).
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
 * used to show, and never a fabricated value standing in for one. The same
 * discipline holds for signatureElement.justification (design-generation-
 * service.ts): it is often internal-audit-flavored reasoning text ("the only
 * concrete, real, non-fabricated content anchors available are..."), so it
 * is used only to pick WHICH section gets the signature's visual treatment
 * (resolveSignatureSection) — its text is never rendered on the page.
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

/** Sections a generated top Nav never links to — hero is the page itself (a "Home" link back to the top a visitor is already at is noise), footer has no content of its own worth jumping to. */
const NAV_EXCLUDED_SECTIONS: SectionType[] = ["hero", "footer"];

function hasRealContent(node: ComponentNode): boolean {
  return node.slots.some(isRealSlot);
}

function sectionAnchorId(section: SectionType): string {
  return `op-section-${section}`;
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
  const accent = toSafeCssColor(palette?.accent, FALLBACK.accent);

  // Resolve which of DesignMemory's three named tones is the page
  // background vs. the hero fill vs. the footer fill by actually measured
  // luminance, rather than trusting primary/secondary/neutral's field names
  // to carry a fixed role — design-intelligence-service.ts's prompt schema
  // never defines what each name means (it's typed as a bare "string" with
  // no role description), so a real Design Brief is free to (and, for
  // Friedman, Grimes, Meinken & Leischner PLLC, genuinely did) use "primary"
  // for a heading TEXT color and "secondary" for the actual page BACKGROUND
  // — the reverse of this renderer's previous fixed assumption (primary =>
  // hero fill, secondary => footer fill, neutral => page background), which
  // rendered that business's real "warm off-white / bone" background choice
  // as a muddy mid-grey (its real "secondary text" tone) instead. The same
  // "verify, don't assume the pairing holds" discipline getReadableTextColor
  // already applies to text-on-background contrast, applied here to
  // background *selection*: lightest measured tone becomes the page
  // background, darkest becomes the hero fill, the remaining one becomes the
  // footer fill — an unmeasurable tone (not a hex token) sorts to the middle
  // rather than crashing or silently winning an extreme role.
  const rawTones = [
    toSafeCssColor(palette?.neutral, FALLBACK.neutral),
    toSafeCssColor(palette?.primary, FALLBACK.primary),
    toSafeCssColor(palette?.secondary, FALLBACK.secondary),
  ];
  const [neutral, secondary, primary] = [...rawTones].sort((a, b) => {
    const la = relativeLuminanceOfCssColor(a) ?? 0.5;
    const lb = relativeLuminanceOfCssColor(b) ?? 0.5;
    return lb - la; // lightest first
  });

  const headingFontStack = toSafeFontFamilyStack(designMemory?.typography.headingFamily, FALLBACK_HEADING_STACK);
  const bodyFontStack = toSafeFontFamilyStack(designMemory?.typography.bodyFamily, FALLBACK_BODY_STACK);

  const bodyRole = findTypeRole(refinedDesign, "body");
  const desktopBodyPx = bodyRole?.sizePx ?? 16;
  const mobileBodyPx = refinedDesign.mobile.bodyFontSizePx;

  const componentsBySection = new Map(components.map((c) => [c.section, c]));

  // The set of sections that will actually render, once OMIT_SECTION_IF_EMPTY
  // is applied — computed once so Nav and the section loop below agree
  // exactly on what's really on the page (never a nav link to a section that
  // then renders nothing).
  const renderedSections = wireframe.sections.filter(({ type }) => {
    const node = componentsBySection.get(type);
    if (!node) return false;
    if (OMIT_SECTION_IF_EMPTY.includes(type) && !hasRealContent(node)) return false;
    return true;
  });

  // The ONE section that gets the wireframe's signatureElement's visual
  // treatment (design-generation-service.ts's resolveSignatureSection) —
  // falls further back to "hero" here if even the resolved fallback section
  // didn't end up rendering (e.g. its only real slots were filtered by
  // OMIT_SECTION_IF_EMPTY at generation time in a way this pass re-checks).
  const idealSignatureSection = resolveSignatureSection(wireframe);
  const signatureSection = renderedSections.some((s) => s.type === idealSignatureSection) ? idealSignatureSection : "hero";

  const contactNode = componentsBySection.get("contact");
  const contactPhone = contactNode?.slots.find((s) => s.name === "phone");
  const realContactPhone = contactPhone && isRealSlot(contactPhone) ? contactPhone.value! : null;

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
      {/* The only rendered CSS beyond inline styles: mobile overrides sourced directly from RefinedDesign.mobile, never a second hand-authored mobile spec, plus a blanket prefers-reduced-motion override (Premium Presentation Pass §12 — previously every fade-in animation played unconditionally). */}
      <style>{`
        @keyframes op-fade-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        [data-design-preview] a, [data-design-preview] button { font-family: inherit; }
        [data-design-preview] a { color: inherit; text-decoration: none; }
        @media (prefers-reduced-motion: reduce) {
          [data-design-preview] [data-op-animated] { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
        @media (max-width: ${MOBILE_BREAKPOINT_PX}px) {
          [data-design-preview] { font-size: ${mobileBodyPx}px !important; }
          [data-op-touch-target] { min-width: var(--op-tt-w); min-height: var(--op-tt-h); }
          [data-op-nav-links] { display: none !important; }
        }
      `}</style>

      <Nav
        businessName={businessName}
        renderedSections={renderedSections.map((s) => s.type)}
        realContactPhone={realContactPhone}
        neutral={neutral}
        textColor={FALLBACK.text}
        accent={accent}
        headingFontStack={headingFontStack}
      />

      {renderedSections.map(({ type, rationale }) => {
        const node = componentsBySection.get(type)!;
        const isSignature = type === signatureSection;
        const background = type === "footer" ? secondary : type === "hero" ? primary : neutral;
        // Hero's flat background always gets FALLBACK.onDark: when a real photo is present
        // it renders under a fixed dark scrim (see SectionShell's backgroundImage comment
        // below) that guarantees a dark surface regardless of `primary`'s own color, so
        // measuring `primary` directly here would be measuring the wrong pixels. Footer has
        // no such guarantee -- `secondary` renders as-is, so its text color must actually be
        // measured against it rather than assumed dark (the Friedman Grimes Meinken &
        // Leischner regression: `secondary` resolved to a light neutral, #F6F4EF, and
        // FALLBACK.onDark white text against it was functionally invisible).
        const foreground =
          type === "footer" ? getReadableTextColor(background, FALLBACK.text, FALLBACK.onDark) : type === "hero" ? FALLBACK.onDark : FALLBACK.text;
        return (
          <SectionShell
            key={type}
            section={type}
            refinedDesign={refinedDesign}
            rationale={rationale}
            background={background}
            foreground={foreground}
            backgroundImageUrl={type === "hero" ? heroImageUrl : null}
            isSignature={isSignature}
            accent={accent}
          >
            <SectionBody
              node={node}
              refinedDesign={refinedDesign}
              headingFontStack={headingFontStack}
              accent={accent}
              textColor={foreground}
              isSignature={isSignature}
            />
          </SectionShell>
        );
      })}
    </div>
  );
}

/**
 * Nav — a polished, minimal top bar generated entirely from real structure:
 * the business's real name, an anchor per section that actually rendered
 * (SECTION_HEADING_LABEL's existing structural labels — "Services",
 * "Get in touch", etc. — never a business-specific claim), and the real
 * contact phone as a plain-text utility link when one exists. No dead links
 * (§7): a section that was omitted for having no real content never gets a
 * nav entry, and there is no nav entry at all beyond the phone utility when
 * every non-hero/footer section was omitted (a business this evidence-thin
 * still gets a real, honest, uncluttered bar rather than an empty one padded
 * with placeholder items).
 */
function Nav({
  businessName,
  renderedSections,
  realContactPhone,
  neutral,
  textColor,
  accent,
  headingFontStack,
}: {
  businessName: string;
  renderedSections: SectionType[];
  realContactPhone: string | null;
  neutral: string;
  textColor: string;
  accent: string;
  headingFontStack: string;
}) {
  const links = renderedSections.filter((s) => !NAV_EXCLUDED_SECTIONS.includes(s));
  return (
    <header
      style={{
        backgroundColor: neutral,
        color: textColor,
        borderBottom: `1px solid ${textColor}17`,
        padding: "1.1rem 1.5rem",
      }}
    >
      <div
        style={{
          maxWidth: "72rem",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1.5rem",
        }}
      >
        <a
          href={`#${sectionAnchorId("hero")}`}
          style={{
            fontFamily: headingFontStack,
            fontWeight: 600,
            fontSize: "1rem",
            letterSpacing: "0.01em",
          }}
        >
          {businessName}
        </a>
        <nav style={{ display: "flex", alignItems: "center", gap: "1.75rem" }}>
          {links.length > 0 && (
            <div data-op-nav-links style={{ display: "flex", gap: "1.75rem" }}>
              {links.map((type) => (
                <a key={type} href={`#${sectionAnchorId(type)}`} style={{ fontSize: "0.85rem", opacity: MUTED_TEXT_OPACITY }}>
                  {SECTION_HEADING_LABEL[type] || type}
                </a>
              ))}
            </div>
          )}
          {realContactPhone && (
            <a href={`tel:${realContactPhone.replace(/[^\d+]/g, "")}`} style={{ fontSize: "0.85rem", fontWeight: 600, color: accent }}>
              {realContactPhone}
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}

/**
 * SignatureRule — the one recurring visual motif tying a business's chosen
 * signatureElement to something a visitor can actually see (Premium
 * Presentation Pass §11): a short accent-colored rule. Reused at three
 * strengths — a small eyebrow-underline in the hero (every business gets
 * this baseline, since hero is the universal signature fallback), and a
 * wider top-of-section bar plus a tinted wash for whichever OTHER section
 * resolveSignatureSection actually targeted. Never text, never a decoration
 * invented beyond "this business's one signature moment gets a slightly
 * different, deliberate treatment than every other section of the same
 * type" — the concrete, checkable form of "not decoration for its own sake."
 */
function SignatureRule({ accent, widthRem = 3 }: { accent: string; widthRem?: number }) {
  return <div style={{ width: `${widthRem}rem`, height: "2px", backgroundColor: accent, margin: "0.9rem 0 1.25rem" }} />;
}

function SectionShell({
  section,
  refinedDesign,
  rationale,
  background,
  foreground,
  backgroundImageUrl,
  isSignature,
  accent,
  children,
}: {
  section: SectionType;
  refinedDesign: RefinedDesign;
  rationale: string;
  background: string;
  foreground: string;
  /** Real, already-captured business photography (see DesignPreviewProps.heroImageUrl) — currently only ever passed for "hero". */
  backgroundImageUrl?: string | null;
  /** True for exactly the one section design-generation-service.ts's resolveSignatureSection targets — see SignatureRule. */
  isSignature: boolean;
  accent: string;
  children: React.ReactNode;
}) {
  const spacing = findSectionSpacing(refinedDesign, section);
  const motion = findSectionMotion(refinedDesign, section);
  const paddingRem = spacing?.sectionPaddingRem ?? 4;
  const isHero = section === "hero";

  return (
    <section
      id={sectionAnchorId(section)}
      data-section={section}
      data-op-animated={motion ? "" : undefined}
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
          : isSignature && !isHero
            ? `linear-gradient(${background}, ${background}), linear-gradient(${accent}14, ${accent}14)`
            : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: foreground,
        padding: isHero ? `${paddingRem}rem 1.5rem` : `${paddingRem}rem 1.5rem`,
        minHeight: isHero ? "min(46rem, 88vh)" : undefined,
        display: isHero ? "flex" : undefined,
        alignItems: isHero ? "center" : undefined,
        borderTop: isHero ? "none" : isSignature ? `3px solid ${accent}` : "1px solid rgba(0,0,0,0.08)",
        animation: motion ? `op-fade-in ${motion.durationMs}ms ${motion.easing} both` : undefined,
      }}
    >
      <div style={{ maxWidth: "72rem", margin: "0 auto", width: "100%" }}>{children}</div>
    </section>
  );
}

function SectionHeading({
  section,
  refinedDesign,
  fontStack,
  color,
  isSignature,
  accent,
}: {
  section: SectionType;
  refinedDesign: RefinedDesign;
  fontStack: string;
  color: string;
  isSignature?: boolean;
  accent?: string;
}) {
  const label = SECTION_HEADING_LABEL[section];
  if (!label) return null;
  const role = findTypeRole(refinedDesign, isSignature ? "display" : "heading2");
  return (
    <div>
      <h2
        style={{
          fontFamily: fontStack,
          fontSize: role ? `${Math.round(role.sizePx * (isSignature ? 0.75 : 1))}px` : "1.75rem",
          fontWeight: role ? toCssFontWeight(role.weight) : 600,
          marginBottom: isSignature ? "0" : "1rem",
          color,
        }}
      >
        {label}
      </h2>
      {isSignature && accent && <SignatureRule accent={accent} widthRem={2.25} />}
    </div>
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
  href,
}: {
  refinedDesign: RefinedDesign;
  section: SectionType;
  label: string;
  accent: string;
  textColor: string;
  href?: string;
}) {
  const target = findTouchTarget(refinedDesign, section);
  if (!target) return null;
  const Tag = href ? "a" : "span";
  return (
    <Tag
      data-op-touch-target
      href={href}
      style={
        {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: `${target.widthPx}px`,
          minHeight: `${target.heightPx}px`,
          padding: "0.6rem 1.75rem",
          border: `1.5px solid ${accent}`,
          color: textColor,
          borderRadius: "0.25rem",
          marginTop: "1.5rem",
          fontWeight: 600,
          fontSize: "0.85em",
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          "--op-tt-w": `${target.widthPx}px`,
          "--op-tt-h": `${target.heightPx}px`,
        } as React.CSSProperties
      }
    >
      {label}
    </Tag>
  );
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function SectionBody({
  node,
  refinedDesign,
  headingFontStack,
  accent,
  textColor,
  isSignature,
}: {
  node: ComponentNode;
  refinedDesign: RefinedDesign;
  headingFontStack: string;
  accent: string;
  textColor: string;
  isSignature: boolean;
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
      <div style={{ maxWidth: "42rem" }}>
        {name && isRealSlot(name) && (
          <div>
            <p
              style={{
                fontWeight: 600,
                fontSize: "0.8rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                opacity: MUTED_TEXT_OPACITY,
                margin: 0,
              }}
            >
              <SlotValue slot={name} />
            </p>
            <SignatureRule accent={accent} />
          </div>
        )}
        {headline && isRealSlot(headline) && (
          <div
            style={{
              fontFamily: headingFontStack,
              fontSize: `${Math.round(baseDisplayPx * lengthScale * 1.15)}px`,
              fontWeight: displayRole ? toCssFontWeight(displayRole.weight) : 600,
              lineHeight: 1.08,
              letterSpacing: "-0.01em",
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
              marginTop: "1.25rem",
              opacity: MUTED_TEXT_OPACITY,
              maxWidth: "48rem",
            }}
          >
            <SlotValue slot={supportingText} />
          </p>
        )}
        <TouchAffordance refinedDesign={refinedDesign} section="hero" label="Get in Touch" accent={accent} textColor={textColor} href={`#${sectionAnchorId("contact")}`} />
      </div>
    );
  }

  if (section === "footer") {
    const name = node.slots.find((s) => s.name === "businessName");
    const year = node.slots.find((s) => s.name === "copyrightYear");
    const phone = node.slots.find((s) => s.name === "phone");
    return (
      <div>
        <div style={{ width: "2.5rem", height: "2px", backgroundColor: `${textColor}55`, marginBottom: "1.5rem" }} />
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: "1rem" }}>
          <div>
            {name && isRealSlot(name) && (
              <p style={{ fontWeight: 600, fontSize: "1.05rem", margin: 0 }}>
                <SlotValue slot={name} />
              </p>
            )}
            {phone && isRealSlot(phone) && (
              <a href={telHref(phone.value!)} style={{ fontSize: "0.9rem", opacity: MUTED_TEXT_OPACITY, display: "inline-block", marginTop: "0.35rem" }}>
                <SlotValue slot={phone} />
              </a>
            )}
          </div>
          {year && isRealSlot(year) && (
            <p style={{ fontSize: "0.8rem", opacity: MUTED_TEXT_OPACITY, margin: 0 }}>
              {name && isRealSlot(name) && <SlotValue slot={name} />} © <SlotValue slot={year} />
            </p>
          )}
        </div>
      </div>
    );
  }

  if (section === "faq") {
    return (
      <div>
        <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          {node.slots.filter(isRealSlot).map((slot) => (
            <details key={slot.name} style={{ borderTop: `1px solid ${textColor}22`, padding: "1.1rem 0" }}>
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
    // Editorial pull-quote treatment (Premium Presentation Pass §5/§6):
    // one large quotation at a time rather than a grid of bordered cards —
    // real attribution isn't captured separately from the excerpt today
    // (design-generation-service.ts only ever produces the excerpt text
    // itself), so each quote stands alone rather than pairing a name this
    // pipeline doesn't actually have.
    const quotes = node.slots.filter(isRealSlot);
    return (
      <div>
        <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          {quotes.map((slot) => (
            <blockquote key={slot.name} style={{ margin: 0, maxWidth: "44rem" }}>
              <p style={{ fontFamily: headingFontStack, fontSize: "1.4em", lineHeight: 1.4, fontWeight: 400 }}>
                <SlotValue slot={slot} />
              </p>
              <div style={{ width: "2rem", height: "2px", backgroundColor: accent, marginTop: "1rem" }} />
            </blockquote>
          ))}
        </div>
      </div>
    );
  }

  if (section === "credibility" || section === "contact") {
    const realSlots = node.slots.filter(isRealSlot);
    if (realSlots.length === 0) return null;

    if (section === "contact") {
      // Closing-statement treatment: the real phone number (when present)
      // is promoted to a large, direct tel: link — for a business whose
      // evidence is otherwise thin (a real risk this renderer must handle
      // gracefully, not just the content-rich case), the verified phone
      // number IS the single most important, most-real thing on the page,
      // so it earns proportionate visual weight rather than sitting in the
      // same small label/value row as every other field.
      const phone = realSlots.find((s) => s.name === "phone");
      const rest = realSlots.filter((s) => s.name !== "phone" && s.name !== "businessName");
      const displayRole = findTypeRole(refinedDesign, "heading1");
      return (
        <div>
          <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
          {phone && (
            <a
              href={telHref(phone.value!)}
              style={{
                display: "block",
                fontFamily: headingFontStack,
                fontSize: displayRole ? `${displayRole.sizePx}px` : "2rem",
                fontWeight: 600,
                marginBottom: rest.length > 0 ? "1.5rem" : "0",
              }}
            >
              <SlotValue slot={phone} />
            </a>
          )}
          {rest.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", marginBottom: "1rem" }}>
              {rest.map((slot) => (
                <div key={slot.name} style={{ minWidth: "10rem" }}>
                  <p style={{ fontSize: "0.75rem", textTransform: "uppercase", opacity: MUTED_TEXT_OPACITY, marginBottom: "0.25rem" }}>
                    {slot.name.replace(/([a-z])([A-Z])/g, "$1 $2")}
                  </p>
                  <SlotValue slot={slot} />
                </div>
              ))}
            </div>
          )}
          {!phone && <TouchAffordance refinedDesign={refinedDesign} section="contact" label="Contact Us" accent={accent} textColor={textColor} />}
        </div>
      );
    }

    return (
      <div>
        <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
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
      </div>
    );
  }

  // Single-slot structural sections (services, menu, gallery, schedule, listings, serviceArea):
  // exactly as many real blocks as buildSlots() actually produced real values for — never a
  // fabricated multi-item grid, and never a placeholder-only grid (the outer OMIT_SECTION_IF_EMPTY
  // check already keeps a fully-empty one of these from reaching this function at all). Editorial
  // divided rows (Premium Presentation Pass §6) rather than a grid of individually bordered boxes —
  // "stop building everything as cards."
  const realSlots = node.slots.filter(isRealSlot);
  const touchLabel =
    section === "schedule" ? "Book Now" : section === "listings" ? "View Listing" : undefined;
  return (
    <div>
      <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
      <div>
        {realSlots.map((slot, i) => (
          <div
            key={slot.name}
            style={{
              padding: "1.5rem 0",
              borderTop: i === 0 ? "none" : `1px solid ${textColor}1a`,
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
