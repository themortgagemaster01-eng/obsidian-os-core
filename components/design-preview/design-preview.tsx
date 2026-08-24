import * as React from "react";

import type { ComponentNode, SectionType, Wireframe } from "@/lib/services/design-generation-service";
import { resolveSignatureSection } from "@/lib/services/design-generation-service";
import type { RefinedDesign } from "@/lib/services/design-refinement-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import type { CompositionVariant } from "@/lib/design-intelligence/composition-variants";
import {
  findSectionSpacing,
  findSectionMotion,
  findSectionHover,
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
  safeAccentTextColor,
} from "@/lib/design-render/safe-css";
import { SlotValue, isRealSlot } from "@/components/design-preview/slot-value";
import { ScrollRevealRuntime } from "@/components/design-preview/scroll-reveal-runtime";

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
   * A signed URL for genuine real business photography (office/team photos,
   * etc.) for this mission, when such an asset actually exists — currently
   * always null, since no adapter in this codebase captures that evidence
   * type yet (app/missions/[id]/preview/page.tsx explains why it's no
   * longer wired to the crawl's above-fold *screenshot*: that's a diagnostic
   * capture of the OLD site's own UI, not photography, and using it here
   * bled the old site's real nav/hero copy through the scrim behind the new
   * design). `null` is gracefully omitted, never backfilled with a stock/
   * placeholder image (§8) — a future real-photography adapter can wire
   * into this same prop.
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

/** The renderer's own prior fixed behavior — used whenever wireframe.compositionVariant is absent (an older persisted design row, or a hand-built test/API fixture predating lib/design-intelligence/composition-variants.ts), so nothing existing changes appearance. */
const DEFAULT_COMPOSITION_VARIANT: CompositionVariant = {
  heroPattern: "editorial-typographic",
  navStyle: "linked",
  ctaVariant: "outline",
  contentWidthRem: 72,
  paddingBiasSteps: 0,
  servicesPattern: "numbered-editorial-index",
  credibilityPattern: "divided-rows",
  footerPattern: "minimal-centered",
};

/** Sections placed evidence-density-thin enough on the page (industry-agnostic — no bucket-specific rule) that a visitor might reasonably need hours/phone/address before reading past them. Content-before-contact position is the real, general signal §9/§10 name for "info visitors check before heading out," not a per-business guess. */
const CONTACT_BURIED_MIN_SECTIONS_BEFORE = 2;

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

/** Real accessible names for the two sections SECTION_HEADING_LABEL leaves blank (hero/footer never render a visible <h2> heading, by design) — every <section>/<footer> landmark below needs a real aria-label regardless of whether it shows a visible heading. Structural labels, not business content, same discipline as SECTION_HEADING_LABEL itself. */
const ARIA_SECTION_LABEL: Partial<Record<SectionType, string>> = { hero: "Introduction", footer: "Site footer" };

function sectionAriaLabel(section: SectionType): string {
  return ARIA_SECTION_LABEL[section] ?? SECTION_HEADING_LABEL[section] ?? section;
}

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
  // Real tel:-ready value, never re-derived from realContactPhone's
  // formatted display text (see resolvePhoneHref's own comment — stripping
  // digits from "(519) 744-9292" drops the +1 country code).
  const contactPhoneHref = contactNode?.slots.find((s) => s.name === "phoneHref");
  const realContactPhoneHref = contactPhoneHref && isRealSlot(contactPhoneHref) ? contactPhoneHref.value! : realContactPhone;

  // One deterministic structural-composition decision for this mission
  // (lib/design-intelligence/composition-variants.ts) — nav style, CTA
  // arrangement, content width, spacing rhythm, and the services/
  // credibility/footer pattern each ComponentNode.pattern below already
  // carries. Defaults to this renderer's own prior fixed behavior for a
  // wireframe predating this field.
  const variant = wireframe.compositionVariant ?? DEFAULT_COMPOSITION_VARIANT;

  // accent used as literal small-text color (nav phone link, services index
  // numeral below) needs its own contrast check against the background it
  // actually renders on — a real axe-core "serious" color-contrast violation
  // traced to exactly this gap (accent was the one text color in this file
  // with no readability check at all). Falls back to the section's own
  // already-guaranteed-readable text color when accent itself doesn't clear
  // WCAG AA against `neutral` (nav/services' shared background).
  const navAccentText = safeAccentTextColor(accent, neutral, FALLBACK.text);

  // Real, evidence-gated "buried contact info" fix (real QA finding on the
  // Jane Bond mission: hours/address/phone pushed past menu/gallery,
  // contradicting the brief's own "visitors check this before heading out"
  // positioning): when contact's real address+hours+phone all exist AND the
  // wireframe places "contact" more than a couple of sections deep, surface a
  // compact real-evidence summary in the hero rather than leaving it only
  // where the bucket template put the full contact section. Industry-
  // agnostic — driven by real section position + real evidence completeness,
  // never a per-bucket/per-business special case.
  const contactSectionIndex = wireframe.sections.findIndex((s) => s.type === "contact");
  const contactIsBuried = contactSectionIndex > CONTACT_BURIED_MIN_SECTIONS_BEFORE;
  const contactAddress = contactNode?.slots.find((s) => s.name === "address");
  const realContactAddress = contactAddress && isRealSlot(contactAddress) ? contactAddress.value! : null;
  // One real line per real day (design-generation-service.ts's
  // buildHoursSlots) when the crawl captured structured day-by-day hours;
  // falls back to the single flat "hours" slot for a business/older row that
  // only ever had that. Real fix for the visual review's "hours renders as
  // one unbroken run-on line" finding — a scannable list, not a wall of text.
  const hoursLines = (contactNode?.slots ?? [])
    .filter((s) => isRealSlot(s) && /^hours-day-\d+$/.test(s.name))
    .sort((a, b) => Number(a.name.split("-")[2]) - Number(b.name.split("-")[2]))
    .map((s) => s.value!);
  if (hoursLines.length === 0) {
    const flatHours = contactNode?.slots.find((s) => s.name === "hours");
    if (flatHours && isRealSlot(flatHours)) hoursLines.push(flatHours.value!);
  }
  const heroQuickFacts =
    contactIsBuried && realContactPhone && realContactAddress && hoursLines.length > 0
      ? { phone: realContactPhone, phoneHref: realContactPhoneHref, address: realContactAddress, hoursLines }
      : null;

  // Split out so the page footer can render as a true sibling landmark
  // (<footer>, outside <main>) rather than nested inside it — nesting a page
  // footer inside <main> would leave it without the implicit "contentinfo"
  // landmark role (HTML-ARIA only grants that role to a <footer> that is NOT
  // a descendant of article/aside/main/nav/section), the same real-landmark
  // discipline the <main> wrap itself exists for.
  const mainSections = renderedSections.filter((s) => s.type !== "footer");
  const footerSection = renderedSections.find((s) => s.type === "footer");

  const renderSection = ({ type, rationale }: { type: SectionType; rationale: string }) => {
    const node = componentsBySection.get(type)!;
    const isSignature = type === signatureSection;
    const background = type === "footer" ? secondary : type === "hero" ? primary : neutral;
    // Hero only gets the fixed FALLBACK.onDark when a real photo is actually
    // present AND heroPattern is one of the two that render it under a fixed
    // dark scrim (SectionShell's own backgroundImage condition, mirrored
    // here) — that scrim guarantees a dark surface regardless of `primary`'s
    // own color, so measuring `primary` directly would measure the wrong
    // pixels. Every OTHER hero pattern (editorial-typographic, split-media-
    // text, oversized-typographic, offset-overlap — no scrim, or split-media-
    // text's image sits beside the text rather than behind it) renders the
    // FLAT, unscrimmed `primary` color, so its text must be measured against
    // that real color the same way footer's `secondary` already is — a real,
    // reproducible axe-core "serious" color-contrast violation this fixes:
    // Jane Bond's real primary tone plus editorial-typographic (no scrim)
    // rendered FALLBACK.onDark white text unmeasured against it.
    const heroPattern = type === "hero" ? node.pattern : undefined;
    const heroHasScrim = !!heroImageUrl && (heroPattern === "image-full-bleed" || heroPattern === "centered-cinematic");
    const foreground =
      type === "footer"
        ? getReadableTextColor(background, FALLBACK.text, FALLBACK.onDark)
        : type === "hero"
          ? heroHasScrim
            ? FALLBACK.onDark
            : getReadableTextColor(background, FALLBACK.text, FALLBACK.onDark)
          : FALLBACK.text;
    return (
      <SectionShell
        key={type}
        section={type}
        refinedDesign={refinedDesign}
        rationale={rationale}
        background={background}
        foreground={foreground}
        backgroundImageUrl={type === "hero" ? heroImageUrl : null}
        heroPattern={type === "hero" ? node.pattern : undefined}
        isSignature={isSignature}
        accent={accent}
      >
        <SectionBody
          node={node}
          refinedDesign={refinedDesign}
          headingFontStack={headingFontStack}
          accent={accent}
          navAccentText={navAccentText}
          textColor={foreground}
          isSignature={isSignature}
          heroImageUrl={type === "hero" ? heroImageUrl : null}
          ctaVariant={variant.ctaVariant}
          quickFacts={type === "hero" ? heroQuickFacts : null}
        />
      </SectionShell>
    );
  };

  // See the <style> element's own comment below for why this is built as a
  // plain string (for dangerouslySetInnerHTML) rather than inline JSX text.
  // Phase 5.4: real 375px horizontal-overflow regression, confirmed live on
  // Canadian Tire's makeover (runRenderedPreviewAdapter's real
  // document.documentElement.scrollWidth > window.innerWidth measurement).
  // No image/text sizing rules existed anywhere in this component before —
  // a real content image wider than its container, or a long unbroken
  // string (a URL, a run-on word from scraped evidence), can force the
  // whole document wider than the viewport. Two generic, always-on rules
  // fix the root cause (never business-specific): real photography scales
  // to its container, long text wraps instead of forcing width. `overflow-
  // x: hidden` on the root container is additional, deliberate defense in
  // depth — `overflow: hidden` clips a wider descendant at THIS element's
  // own boundary, so it stops contributing to document.documentElement's
  // scrollWidth even if some future section ever reintroduces an
  // unconstrained-width element this pass didn't anticipate.
  const mobileStyleCss = `
        /* Phase 6.3 (Scroll-Triggered Storytelling): the DEFAULT state for
           any [data-op-animated] section is fully visible — no opacity/
           transform override at all — so content "remains immediately
           visible" by construction whether or not JS ever runs. The client
           runtime (scroll-reveal-runtime.tsx) is the ONLY thing that ever
           adds [data-op-pending] (the hidden, about-to-reveal state, for a
           section it has confirmed is currently off-screen) or
           [data-op-revealed] (the settled, visible state, once that section
           has scrolled into view or a safety fallback fired).

           transition lives ONLY on the [data-op-revealed] rule, deliberately
           — NOT on the shared [data-op-animated] base selector. A version
           of this pass that put it on the base selector had a real, confirmed
           bug: the runtime's own mount-time getBoundingClientRect() call
           forces a real layout/paint commit at the section's default
           (visible) state, so the VERY NEXT attribute change (default ->
           [data-op-pending], applied moments later in the same effect) was
           itself treated as an animatable transition — a brief, unwanted
           "flash to transparent" on mount, before any scrolling happened,
           for every off-screen section. Scoping transition to only the
           reveal direction means the hide step is always instant (no
           transition rule is active for that change), and only the
           scroll-triggered reveal itself ever animates. --op-scale defaults
           to 1 (a no-op) so the exact same rule covers both "fade" and
           "fade-scale" reveal styles — SectionShell sets --op-scale
           explicitly only for the latter. */
        [data-op-animated][data-op-pending] {
          opacity: 0;
          transform: translateY(var(--op-ty, 12px)) scale(var(--op-scale, 1));
          will-change: opacity, transform;
        }
        [data-op-animated][data-op-revealed] {
          opacity: 1;
          transform: none;
          transition: opacity var(--op-dur, 250ms) var(--op-ease, ease-out) var(--op-delay, 0ms), transform var(--op-dur, 250ms) var(--op-ease, ease-out) var(--op-delay, 0ms);
        }
        [data-design-preview] { overflow-x: hidden; }
        [data-design-preview] img { max-width: 100%; height: auto; }
        [data-design-preview] * { overflow-wrap: break-word; word-break: break-word; }
        [data-design-preview] a, [data-design-preview] button { font-family: inherit; }
        [data-design-preview] a { color: inherit; text-decoration: none; }
        /* Belt-and-suspenders (Phase 6.2's original protection, kept
           unchanged in spirit): the client runtime already checks
           prefers-reduced-motion before ever adding [data-op-pending], so
           this should never actually need to fire — but if it ever did
           (a future bug, a runtime that loaded before this stylesheet), a
           reduced-motion visitor still never sees a hidden section. */
        @media (prefers-reduced-motion: reduce) {
          [data-design-preview] [data-op-animated] { transition: none !important; opacity: 1 !important; transform: none !important; }
        }
        /* Phase 6.2 hover-intensity primitive (high-energy-retail only,
           lib/services/design-refinement-service.ts's SectionHoverValue) —
           scoped entirely inside prefers-reduced-motion:no-preference so a
           visitor requesting reduced motion never sees it at all, rather
           than relying on an !important override at interaction time. */
        @media (prefers-reduced-motion: no-preference) {
          [data-design-preview] [data-op-hover-scale] { transition: transform 150ms ease; }
          [data-design-preview] [data-op-hover-scale]:hover { transform: scale(var(--op-hover-scale, 1)); }
        }
        /* Phase 6.2 polish: image-full-bleed and centered-cinematic are the
           two hero patterns SectionShell's own scrim (the left-to-right
           dark-to-clear gradient behind the hero photo) applies to. The
           scrim's dark zone is fixed in PERCENT of the section's full
           width, while the hero text column's width was a fixed 42rem
           regardless of viewport — at typical desktop widths (~1280-1440px)
           42rem legitimately reaches past where the scrim has already
           faded most of the way out, so a headline long enough to wrap to
           its column's full width can bleed into the zone meant to let the
           photo show through unobstructed (the real Phase 6.2 visual-review
           finding). Capping the column at 40% of the viewport — comfortably
           inside the scrim's own dark zone at every desktop width this app
           targets — fixes the underlying geometry rather than darkening the
           scrim further (which would fight the whole point of a photo-led
           hero); works identically for real photography, not just this
           fixture. Scoped ABOVE the mobile breakpoint only: on a narrow
           viewport the hero has no side column to protect (full-bleed at
           every width) and 40vw would be far too narrow for readable text.
        */
        @media (min-width: ${MOBILE_BREAKPOINT_PX + 1}px) {
          [data-hero-pattern="image-full-bleed"], [data-hero-pattern="centered-cinematic"] { max-width: min(42rem, 40vw) !important; }
        }
        @media (max-width: ${MOBILE_BREAKPOINT_PX}px) {
          [data-design-preview] { font-size: ${mobileBodyPx}px !important; }
          [data-op-touch-target] { min-width: var(--op-tt-w); min-height: var(--op-tt-h); }
          [data-op-nav-links] { display: none !important; }
          [data-hero-hours-chip] { display: none !important; }
          [data-hero-pattern="split-media-text"] { display: block !important; }
          [data-hero-pattern="offset-overlap"] { margin-left: 0 !important; }
          /* Deliberate two-row nav on narrow viewports (Phase 6.2 polish —
             the real regression: business name + phone + a cta-prominent
             Contact button crowding one row, wrapping mid-word, a phone
             number breaking mid-digit). The business name gets its own
             full-width row; the phone + CTA cluster gets a second row,
             spread to the full width — a real responsive hierarchy, not
             just shrinking every item until it technically fits. */
          [data-op-nav-row] { flex-wrap: wrap; row-gap: 0.65rem; }
          [data-op-nav-brand] { flex: 1 1 100%; }
          [data-op-nav-actions] { flex: 1 1 100%; justify-content: space-between; }
        }
      `;

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
      {/* The only rendered CSS beyond inline styles: mobile overrides sourced directly from RefinedDesign.mobile, never a second hand-authored mobile spec, plus a blanket prefers-reduced-motion override (Premium Presentation Pass §12 — previously every fade-in animation played unconditionally).
          dangerouslySetInnerHTML, not JSX text children: a real, reproducible
          hydration-mismatch bug (visible as a persistent error toast
          overlapping the hero on both desktop and mobile) traced to this
          block specifically. <style> is an HTML "raw text" element — browsers
          never HTML-entity-decode its content — but React's JSX-children text
          path HTML-escapes ALL text uniformly, including the quote characters
          in `[data-hero-pattern="split-media-text"]`, turning them into
          `&quot;` server-side. The client then hydrates against the literal
          (never-decoded) `&quot;` the browser actually parsed into the DOM,
          while recomputing the same template literal with real `"`
          characters — a genuine byte-for-byte server/client mismatch, not a
          false positive. dangerouslySetInnerHTML writes the exact same raw
          string via innerHTML on both server and client, so there is nothing
          left to diverge — the fix removes the mismatch's actual cause
          rather than hiding the error it produces. */}
      <style dangerouslySetInnerHTML={{ __html: mobileStyleCss }} />
      {/* Phase 6.3: the one client-side seam in an otherwise fully
          server-rendered component. Renders nothing; only ever ADDS a
          hidden state to a section it has confirmed is off-screen, and
          guarantees every section it hides is later revealed (scroll,
          deep-link, or a safety timeout) — see scroll-reveal-runtime.tsx's
          own module comment for the full contract. */}
      <ScrollRevealRuntime />

      <Nav
        businessName={businessName}
        renderedSections={renderedSections.map((s) => s.type)}
        realContactPhone={realContactPhone}
        realContactPhoneHref={realContactPhoneHref}
        neutral={neutral}
        textColor={FALLBACK.text}
        accent={navAccentText}
        headingFontStack={headingFontStack}
        navStyle={variant.navStyle}
        refinedDesign={refinedDesign}
      />

      {/* DesignPreview is always embedded inside a page that already
          provides its own page-level <main> (app/missions/[id]/preview/
          page.tsx) — wrapping this component's own content in a SECOND
          <main> here nests one landmark inside another, which is itself a
          real axe-core violation (landmark-no-duplicate-main/
          landmark-main-is-top-level/landmark-unique — confirmed via a real
          rendered QA run against the Jane Bond mission while fixing the
          original "region" violation this replaced). Each section still
          gets its own aria-label (below) so a screen-reader's landmark/
          heading list is genuinely navigable regardless of which element
          owns the page's one <main> landmark. */}
      {mainSections.map(renderSection)}
      {footerSection && renderSection(footerSection)}
    </div>
  );
}

/**
 * Nav — a polished top bar generated entirely from real structure: the
 * business's real name, an anchor per section that actually rendered
 * (SECTION_HEADING_LABEL's existing structural labels — "Services",
 * "Get in touch", etc. — never a business-specific claim), and the real
 * contact phone as a plain-text utility link when one exists. No dead links
 * (§7): a section that was omitted for having no real content never gets a
 * nav entry, and there is no nav entry at all beyond the phone utility when
 * every non-hero/footer section was omitted (a business this evidence-thin
 * still gets a real, honest, uncluttered bar rather than an empty one padded
 * with placeholder items).
 *
 * navStyle (lib/design-intelligence/composition-variants.ts's real, per-
 * mission structural choice, propagated from the same hero pattern the rest
 * of the page's composition already keys off): "minimal" (Editorial/Luxury
 * Minimal) drops the section-link row entirely — business name + phone
 * utility only, matching those two strategies' restraint; "linked"
 * (Cinematic/Local Story) is this component's original, unchanged behavior;
 * "cta-prominent" (Service/Product/Bold Commerce) adds a real filled Contact
 * button beside the links, matching those two strategies' conversion-forward
 * register — reusing TouchAffordance's own already-validated sizing/contrast
 * rather than a new one-off button.
 */
function Nav({
  businessName,
  renderedSections,
  realContactPhone,
  realContactPhoneHref,
  neutral,
  textColor,
  accent,
  headingFontStack,
  navStyle,
  refinedDesign,
}: {
  businessName: string;
  renderedSections: SectionType[];
  realContactPhone: string | null;
  realContactPhoneHref: string | null;
  neutral: string;
  textColor: string;
  accent: string;
  headingFontStack: string;
  navStyle: "minimal" | "linked" | "cta-prominent";
  refinedDesign: RefinedDesign;
}) {
  const links = navStyle === "minimal" ? [] : renderedSections.filter((s) => !NAV_EXCLUDED_SECTIONS.includes(s));
  const showContactCta = navStyle === "cta-prominent" && renderedSections.includes("contact");
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
        data-op-nav-row
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
          data-op-nav-brand
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
        {/* data-op-nav-actions: the phone utility + (when cta-prominent) the
            Contact button — grouped under one data attribute so the mobile
            layout below can give this cluster its own full-width row,
            deliberately separated from the business name, rather than
            letting three unrelated-width items compete for one 375px row
            (the real regression this fixes: business name/phone/CTA
            crowding and wrapping mid-word, a phone number breaking
            mid-digit under the sitewide overflow-wrap:break-word rule). */}
        <nav data-op-nav-actions style={{ display: "flex", alignItems: "center", gap: "1.75rem" }}>
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
            <a
              href={`tel:${(realContactPhoneHref ?? realContactPhone).replace(/[^\d+]/g, "")}`}
              // A phone number is one atomic unit, never a candidate for the
              // sitewide overflow-wrap:break-word rule (meant for long
              // scraped text/URLs) — without this, a tight flex row breaks
              // it mid-digit, e.g. "(519" / ")" / "555" / "-123" / "4".
              style={{ fontSize: "0.85rem", fontWeight: 600, color: accent, whiteSpace: "nowrap", flexShrink: 0 }}
            >
              {realContactPhone}
            </a>
          )}
          {showContactCta && (
            <TouchAffordance
              refinedDesign={refinedDesign}
              section="contact"
              label="Contact"
              accent={accent}
              textColor={textColor}
              href={`#${sectionAnchorId("contact")}`}
              variant="filled"
            />
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
  heroPattern,
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
  heroPattern?: string;
  /** True for exactly the one section design-generation-service.ts's resolveSignatureSection targets — see SignatureRule. */
  isSignature: boolean;
  accent: string;
  children: React.ReactNode;
}) {
  const spacing = findSectionSpacing(refinedDesign, section);
  const motion = findSectionMotion(refinedDesign, section);
  const paddingRem = spacing?.sectionPaddingRem ?? 4;
  const isHero = section === "hero";
  const contentWidthRem = refinedDesign.layout.contentWidthRem ?? 72;
  // Real semantic <footer> (a landmark by itself) rather than a generic
  // <section> for the closing section — part of the same "region" axe-core
  // fix as the <main> wrapper above: every real page landmark should use its
  // real semantic element, not a labeled-but-generic one everywhere.
  const Tag = section === "footer" ? "footer" : "section";

  // Phase 6.3 (Scroll-Triggered Storytelling): this element never animates
  // on its own — it only declares, via CSS custom properties, what a
  // reveal transition WOULD look like if the client runtime
  // (scroll-reveal-runtime.tsx) decides this section should be pre-hidden
  // and later revealed on scroll. Every value here is read straight off
  // RefinedDesign.motion (refineMotion's already-resolved decision) — this
  // component never computes or re-derives a motion value of its own. A
  // section this maps to "fade-scale" gets --op-scale > 1 (its hidden state
  // is very slightly scaled up as well as offset); every other section gets
  // --op-scale: 1 (a no-op scale, so the SAME transform expression in the
  // stylesheet below covers both reveal styles without two separate
  // keyframe names). `??` defaults (12px, 1, 0ms) reproduce the exact
  // pre-6.3 fixed values, so a wireframe predating Phase 6.1's
  // ExperiencePlan (no revealStyle/translateYPx/delayMs on its motion
  // entries) still renders a sensible hidden state if it's ever observed.
  const revealScale = motion?.revealStyle === "fade-scale" ? 1.03 : 1;

  return (
    <Tag
      id={sectionAnchorId(section)}
      data-section={section}
      data-op-animated={motion ? "" : undefined}
      title={rationale}
      aria-label={sectionAriaLabel(section)}
      style={{
        backgroundColor: background,
        // A left-to-right black scrim under the real photo, not a flat
        // wash: hero text always renders in FALLBACK.onDark (near-white)
        // and always sits left-anchored within the section (see the hero
        // content container below — flex-start, no justifyContent
        // override), so the scrim only needs to stay opaque enough to
        // guarantee that pairing's contrast under the actual text column;
        // past that column it fades out so the real photograph reads
        // bright and undimmed. The dark zone (0-42%) and the darkest stop
        // (0.72) are both slightly wider/stronger than the old flat 0.6 to
        // keep the same safety margin now that it's localized rather than
        // applied everywhere.
        //
        // Phase 6.2 polish: the far-right stops were raised from 0.18/0.12
        // to 0.30/0.26 (still a normal, modest photo-hero darkening — not
        // the "excessively dark overlay" the founder's polish-pass
        // instruction warned against; photography still reads clearly
        // through it) after a real visual-review finding: on a narrow
        // (mobile) viewport the hero text column isn't narrowed the way the
        // desktop-only maxWidth cap below narrows it — mobile deliberately
        // keeps using the available width for readability (see the
        // headline's own clamp()-based sizing comment) — so headline text
        // there can legitimately reach the same far-right zone a busy real
        // photo's own bright/detailed area could sit in. Raising the FLOOR
        // (not the whole gradient) keeps the desktop-visible photo just as
        // bright while giving every viewport width a real contrast safety
        // margin, rather than depending on the text column staying out of
        // that zone at every possible width.
        backgroundImage: backgroundImageUrl && (heroPattern === "image-full-bleed" || heroPattern === "centered-cinematic")
          ? `linear-gradient(to right, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.72) 42%, rgba(0,0,0,0.58) 62%, rgba(0,0,0,0.48) 85%, rgba(0,0,0,0.45) 100%), url("${backgroundImageUrl}")`
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
        // No `animation` and no unconditional inline `transition` here —
        // Phase 6.3 replaced the automatic load-time keyframe with a
        // scroll-triggered reveal driven by the [data-op-pending]/
        // [data-op-revealed] attributes the client runtime toggles (see the
        // stylesheet below). The transition itself is declared ONLY on the
        // stylesheet's [data-op-revealed] rule, deliberately — an earlier
        // version of this pass declared `transition` unconditionally here,
        // which meant the client runtime's OWN synchronous mount-time
        // `getBoundingClientRect()` call (forcing a real layout/paint
        // commit at the section's natural, fully-visible default state)
        // could make the browser treat the very next attribute change
        // (default -> [data-op-pending]) as an animatable transition too —
        // a real, confirmed brief "flash to transparent" on mount, before
        // any scrolling happened, for every off-screen section. Declaring
        // the transition only on [data-op-revealed] means the default ->
        // pending hide is always instant (no transition rule is active for
        // that change), and only the pending -> revealed reveal — the
        // scroll-triggered moment this is actually for — ever animates.
        // Only the raw TIMING values (duration/easing/delay/offset/scale)
        // are set here, as custom properties the stylesheet's own
        // transition/transform declarations read.
        "--op-dur": motion ? `${motion.durationMs}ms` : undefined,
        "--op-ease": motion ? motion.easing : undefined,
        "--op-delay": motion ? `${motion.delayMs ?? 0}ms` : undefined,
        "--op-ty": motion ? `${motion.translateYPx ?? 12}px` : undefined,
        "--op-scale": motion ? revealScale : undefined,
      } as React.CSSProperties}
    >
      <div style={{ maxWidth: `${contentWidthRem}rem`, margin: "0 auto", width: "100%" }}>{children}</div>
    </Tag>
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
/**
 * variant (CTO Benchmark Follow-Up directive §3: CTA structure must be part
 * of what genuinely varies between hero patterns, not just imagery/type):
 * "outline" is every existing call site's original, unchanged look —
 * Editorial/Cinematic/Local Story hero CTAs, plus every non-hero section's
 * CTA (contact/schedule/listings/faq), all keep this default exactly as
 * before. "filled" (Service/Product, Bold Commerce — the two CTO names as
 * the more conversion-forward patterns) is a solid accent-color button,
 * higher visual weight. "text-link" (Luxury Minimal) drops the box/border
 * entirely — restraint itself is the signal, per docs/DESIGN_INTELLIGENCE.md's
 * luxury-services guidance that whitespace/typography should carry the
 * "premium" read rather than a boxed CTA competing with it.
 */
function TouchAffordance({
  refinedDesign,
  section,
  label,
  accent,
  textColor,
  href,
  variant = "outline",
}: {
  refinedDesign: RefinedDesign;
  section: SectionType;
  label: string;
  accent: string;
  textColor: string;
  href?: string;
  variant?: "outline" | "filled" | "text-link";
}) {
  const target = findTouchTarget(refinedDesign, section);
  if (!target) return null;
  // Phase 6.2's hover-intensity primitive — undefined for every section
  // except under high-energy-retail at a motion budget above "none" (see
  // refineMotionFromExperiencePlan, lib/services/design-refinement-
  // service.ts). data-op-hover-scale is only ever added when a real entry
  // exists, so an affordance with no hover treatment renders with no hover
  // wiring at all, not a no-op scale(1).
  const hover = findSectionHover(refinedDesign, section);
  const Tag = href ? "a" : "span";
  const variantStyle: React.CSSProperties =
    variant === "filled"
      ? { border: `1.5px solid ${accent}`, backgroundColor: accent, color: getReadableTextColor(accent) }
      : variant === "text-link"
        ? { border: "none", borderBottom: `1.5px solid ${accent}`, borderRadius: 0, padding: "0.4rem 0", color: textColor }
        : { border: `1.5px solid ${accent}`, color: textColor };
  return (
    <Tag
      data-op-touch-target
      {...(hover ? { "data-op-hover-scale": "" } : {})}
      href={href}
      title={hover ? hover.purpose : undefined}
      style={
        {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: `${target.widthPx}px`,
          minHeight: `${target.heightPx}px`,
          padding: "0.6rem 1.75rem",
          borderRadius: "0.25rem",
          marginTop: "1.5rem",
          fontWeight: 600,
          fontSize: "0.85em",
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          // A CTA label is one short, atomic phrase — never a candidate for
          // the sitewide overflow-wrap:break-word rule; flexShrink:0 keeps a
          // flex-row placement (Nav's cta-prominent button) from being
          // squeezed narrower than its own minWidth/padding can honor.
          whiteSpace: "nowrap",
          flexShrink: 0,
          "--op-tt-w": `${target.widthPx}px`,
          "--op-tt-h": `${target.heightPx}px`,
          ...(hover ? { "--op-hover-scale": hover.scale } : {}),
          ...variantStyle,
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

/**
 * Prefers the real "phoneHref" slot (design-generation-service.ts's
 * resolvePhoneForDisplay — the full E.164 value, e.g. "+15197449292") over
 * re-deriving a tel: link from the formatted display text, which would
 * silently drop the +1 country code telHref's own digit-stripping can't
 * recover ("(519) 744-9292" -> "5197449292", not "+15197449292"). Falls
 * back to telHref(displayValue) only for an older stored design predating
 * the phoneHref slot (CTO Benchmark Follow-Up directive §1: "preserve the
 * underlying tel: link").
 */
function resolvePhoneHref(slots: ComponentNode["slots"], displayValue: string): string {
  const hrefSlot = slots.find((s) => s.name === "phoneHref");
  if (hrefSlot && isRealSlot(hrefSlot)) return telHref(hrefSlot.value!);
  return telHref(displayValue);
}

function SectionBody({
  node,
  refinedDesign,
  headingFontStack,
  accent,
  navAccentText,
  textColor,
  isSignature,
  heroImageUrl,
  ctaVariant,
  quickFacts,
}: {
  node: ComponentNode;
  refinedDesign: RefinedDesign;
  headingFontStack: string;
  accent: string;
  /** accent, pre-checked for readable contrast against this section's own background (safeAccentTextColor) — used wherever accent renders as literal small text (e.g. the services numeral below) rather than a border/rule. */
  navAccentText: string;
  textColor: string;
  isSignature: boolean;
  heroImageUrl: string | null;
  /** lib/design-intelligence/composition-variants.ts's per-mission CTA arrangement — applied to every non-hero CTA (hero derives its own from the same resolved heroPattern, see below) so CTA styling is consistent sitewide, not just in the hero. */
  ctaVariant: "outline" | "filled" | "text-link";
  /** Real, evidence-gated hours/phone/address summary (DesignPreview's heroQuickFacts) — only ever passed for "hero", and only when contact is genuinely buried deep in the section order AND all three fields are real. */
  quickFacts: { phone: string; phoneHref: string | null; address: string; hoursLines: string[] } | null;
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
    const heroPattern = node.pattern ?? "editorial-typographic";
    // CTO Benchmark Follow-Up directive §3: layout, composition, typography
    // scale, and CTA structure must all genuinely vary per pattern, not
    // just color. See section-patterns.ts's module comment for the full
    // A-F CTO-pattern mapping each id below corresponds to.
    const isSplit = heroPattern === "split-media-text" && !!heroImageUrl;
    // ctaVariant comes from the prop now (lib/design-intelligence/
    // composition-variants.ts's BASE_VARIANT_BY_HERO_PATTERN table produces
    // exactly this same outline/filled/text-link mapping per heroPattern) —
    // a single resolved source rather than a second, independently
    // maintained copy of the same per-pattern logic.
    const containerStyle: React.CSSProperties = {
      maxWidth: heroPattern === "oversized-typographic" ? "64rem" : "42rem",
      display: isSplit ? "grid" : undefined,
      gridTemplateColumns: isSplit ? "minmax(0, 1fr) minmax(14rem, 0.85fr)" : undefined,
      alignItems: "center",
      gap: isSplit ? "3rem" : undefined,
      marginLeft: heroPattern === "offset-overlap" ? "8%" : undefined,
      borderLeft: heroPattern === "editorial-typographic" ? `2px solid ${accent}` : undefined,
      paddingLeft: heroPattern === "editorial-typographic" ? "1.5rem" : undefined,
      textAlign: heroPattern === "centered-cinematic" ? "center" : undefined,
    };
    const proseStyle: React.CSSProperties = {
      transform: heroPattern === "offset-overlap" ? "translateY(-2rem)" : undefined,
      padding: heroPattern === "offset-overlap" ? "2rem" : undefined,
      backgroundColor: heroPattern === "offset-overlap" ? `${textColor}12` : undefined,
    };
    return (
      <div style={containerStyle} data-hero-pattern={heroPattern}>
        <div style={proseStyle}>
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
              // clamp(), not a fixed px value: the prior fixed size was
              // identical on a 390px phone and a 1440px desktop, so a
              // headline that read as a normal 2-3 line display headline on
              // desktop rendered as 7 lines of oversized type consuming
              // almost the entire mobile first screen — the real visual-
              // review finding (headline pushed phone/hours/CTA below the
              // fold on mobile). The MAX bound is exactly the same value
              // this always computed before — desktop is unchanged; only
              // narrow viewports now genuinely scale down, continuously
              // rather than at one arbitrary breakpoint.
              fontSize: `clamp(1.75rem, 6vw, ${Math.round(baseDisplayPx * lengthScale * (heroPattern === "oversized-typographic" ? 1.5 : 1.15))}px)`,
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
        {quickFacts && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1.5rem",
              marginTop: "1.5rem",
              paddingTop: "1.25rem",
              borderTop: `1px solid ${textColor}33`,
            }}
          >
            <a href={quickFacts.phoneHref ? `tel:${quickFacts.phoneHref.replace(/[^\d+]/g, "")}` : undefined} style={{ fontSize: "0.9rem", fontWeight: 600 }}>
              {quickFacts.phone}
            </a>
            <span style={{ fontSize: "0.85rem", opacity: MUTED_TEXT_OPACITY }}>{quickFacts.address}</span>
            {/* One real chip per real day (design-generation-service.ts's
                buildHoursSlots) rather than one run-on sentence — each entry
                reads on its own, and flex-wrap keeps the strip from ever
                forcing a single unbroken line. Hidden below the mobile
                breakpoint (data-hero-hours-chip, see the mobile <style>
                rule) — a real regression this guards against, found in this
                same visual-review pass: all 7 real day chips stacking to
                their own lines on a narrow viewport pushed the CTA back
                below the fold, undoing the headline-clamp fix above. Phone
                and address (the two most essential facts) stay visible; the
                full day-by-day breakdown is never lost — it's the dedicated
                contact section's own job further down the page. */}
            {quickFacts.hoursLines.map((line, i) => (
              <span key={i} data-hero-hours-chip style={{ fontSize: "0.8rem", opacity: MUTED_TEXT_OPACITY, whiteSpace: "nowrap" }}>
                {line}
              </span>
            ))}
          </div>
        )}
        <TouchAffordance refinedDesign={refinedDesign} section="hero" label="Get in Touch" accent={accent} textColor={textColor} href={`#${sectionAnchorId("contact")}`} variant={ctaVariant} />
        </div>
        {isSplit && <img src={heroImageUrl!} alt="" style={{ width: "100%", minHeight: "22rem", objectFit: "cover", display: "block" }} />}
      </div>
    );
  }

  if (section === "footer") {
    const name = node.slots.find((s) => s.name === "businessName");
    const year = node.slots.find((s) => s.name === "copyrightYear");
    const phone = node.slots.find((s) => s.name === "phone");
    // multi-column (composition-variants.ts, Service/Product and Bold
    // Commerce's pattern): the same three real fields as separate grid
    // columns with their own labels, rather than one inline name+phone
    // row — a genuinely denser closing treatment matching those two
    // strategies' page-wide rhythm, not a cosmetic tweak of the same layout.
    if (node.pattern === "multi-column") {
      return (
        <div>
          <div style={{ width: "2.5rem", height: "2px", backgroundColor: `${textColor}55`, marginBottom: "1.5rem" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "1.5rem" }}>
            {name && isRealSlot(name) && (
              <p style={{ fontWeight: 600, fontSize: "1.05rem", margin: 0 }}>
                <SlotValue slot={name} />
              </p>
            )}
            {phone && isRealSlot(phone) && (
              <div>
                <p style={{ fontSize: "0.75rem", textTransform: "uppercase", opacity: MUTED_TEXT_OPACITY, margin: "0 0 0.25rem" }}>Contact</p>
                <a href={resolvePhoneHref(node.slots, phone.value!)} style={{ fontSize: "0.9rem" }}>
                  <SlotValue slot={phone} />
                </a>
              </div>
            )}
            {year && isRealSlot(year) && (
              <p style={{ fontSize: "0.8rem", opacity: MUTED_TEXT_OPACITY, margin: 0 }}>
                {name && isRealSlot(name) && <SlotValue slot={name} />} © <SlotValue slot={year} />
              </p>
            )}
          </div>
        </div>
      );
    }
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
              <a href={resolvePhoneHref(node.slots, phone.value!)} style={{ fontSize: "0.9rem", opacity: MUTED_TEXT_OPACITY, display: "inline-block", marginTop: "0.35rem" }}>
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
    // one large quotation at a time rather than a grid of bordered cards.
    // Real attribution (design-generation-service.ts's "testimonial-
    // attribution-N" slot, when the crawler found a real name structurally
    // next to the quote) is paired with its quote by matching index below
    // the divider rule; a quote with no real attribution just omits that
    // line rather than pairing a name this pipeline doesn't actually have.
    const quotes = node.slots.filter((s) => isRealSlot(s) && s.name.startsWith("testimonial-") && !s.name.includes("attribution"));
    const attributionByIndex = new Map(
      node.slots
        .filter((s) => isRealSlot(s) && s.name.startsWith("testimonial-attribution-"))
        .map((s) => [s.name.replace("testimonial-attribution-", ""), s] as const)
    );
    return (
      <div>
        <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          {quotes.map((slot) => {
            const attribution = attributionByIndex.get(slot.name.replace("testimonial-", ""));
            return (
              <blockquote key={slot.name} style={{ margin: 0, maxWidth: "44rem" }}>
                <p style={{ fontFamily: headingFontStack, fontSize: "1.4em", lineHeight: 1.4, fontWeight: 400 }}>
                  <SlotValue slot={slot} />
                </p>
                <div style={{ width: "2rem", height: "2px", backgroundColor: accent, marginTop: "1rem" }} />
                {attribution && (
                  <p style={{ fontSize: "0.85rem", opacity: MUTED_TEXT_OPACITY, marginTop: "0.6rem" }}>
                    <SlotValue slot={attribution} />
                  </p>
                )}
              </blockquote>
            );
          })}
        </div>
      </div>
    );
  }

  if (section === "services") {
    // Editorial numbered index (Friedman Flagship Final Content Pass): each
    // real practice-area/category name (design-generation-service.ts's
    // "offering-N" slot) gets its own row with a large muted index numeral,
    // and — only when real sub-item evidence exists ("offering-detail-N",
    // paired by index like testimonials' attribution) — a lighter
    // supporting line beneath it. Not the flat "Practice Areas Family Law
    // Family Law Overview Divorce Child Custody..." run-on blob a whole-
    // page fallback excerpt produced before findServiceMenuStructure
    // (crawl-adapter.ts) existed. Hairline dividers and restrained accent
    // numerals, not bordered/rounded cards — same "stop building everything
    // as cards" discipline as the generic divided-row fallback below.
    const categories = node.slots.filter((s) => isRealSlot(s) && s.name.startsWith("offering-") && !s.name.includes("detail"));
    const detailByIndex = new Map(
      node.slots
        .filter((s) => isRealSlot(s) && s.name.startsWith("offering-detail-"))
        .map((s) => [s.name.replace("offering-detail-", ""), s] as const)
    );

    // grid-cards (composition-variants.ts, Service/Product and Bold
    // Commerce's pattern): the same real offering evidence as a responsive
    // card grid rather than a numbered index — a genuinely denser,
    // conversion-forward register matching those two strategies' hero
    // treatment, only reachable when this business has enough real offerings
    // to fill it out honestly (resolveCompositionVariant's evidence gate).
    if (node.pattern === "grid-cards") {
      return (
        <div>
          <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))", gap: "1.25rem" }}>
            {categories.map((slot) => {
              const detail = detailByIndex.get(slot.name.replace("offering-", ""));
              return (
                <div key={slot.name} style={{ padding: "1.5rem", border: `1px solid ${textColor}22`, borderTop: `3px solid ${accent}` }}>
                  <p style={{ fontFamily: headingFontStack, fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>
                    <SlotValue slot={slot} />
                  </p>
                  {detail && (
                    <p style={{ fontSize: "0.9rem", opacity: MUTED_TEXT_OPACITY, marginTop: "0.6rem" }}>
                      <SlotValue slot={detail} />
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // numbered-editorial-index (Friedman Flagship Final Content Pass):
    // Editorial/Cinematic/Local Story/Luxury Minimal's pattern — each real
    // practice-area/category name gets its own row with a large muted index
    // numeral, and — only when real sub-item evidence exists — a lighter
    // supporting line beneath it. Not the flat "Practice Areas Family Law
    // Family Law Overview Divorce Child Custody..." run-on blob a whole-
    // page fallback excerpt produced before findServiceMenuStructure
    // (crawl-adapter.ts) existed. Hairline dividers and restrained accent
    // numerals, not bordered/rounded cards — same "stop building everything
    // as cards" discipline as the generic divided-row fallback below.
    return (
      <div>
        <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
        <div>
          {categories.map((slot, i) => {
            const detail = detailByIndex.get(slot.name.replace("offering-", ""));
            return (
              <div
                key={slot.name}
                style={{
                  display: "flex",
                  gap: "1.5rem",
                  alignItems: "baseline",
                  padding: "1.5rem 0",
                  borderTop: i === 0 ? "none" : `1px solid ${textColor}1a`,
                }}
              >
                <span
                  style={{
                    fontFamily: headingFontStack,
                    fontSize: "0.95rem",
                    fontWeight: 500,
                    color: navAccentText,
                    minWidth: "2.25rem",
                    flexShrink: 0,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p style={{ fontFamily: headingFontStack, fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
                    <SlotValue slot={slot} />
                  </p>
                  {detail && (
                    <p style={{ fontSize: "0.9rem", opacity: MUTED_TEXT_OPACITY, marginTop: "0.4rem", maxWidth: "40rem" }}>
                      <SlotValue slot={detail} />
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (section === "gallery") {
    // real-photo-grid (SECTION_PATTERN_REGISTRY.gallery): the business's own
    // real photos (design-generation-service.ts's "image-N" slots, sourced
    // from crawl-adapter.ts's extractGallery — never a diagnostic page
    // screenshot) in a simple grid, each with its own real alt text
    // ("image-alt-N", paired by index) when the crawler captured one.
    // SlotValue alone can't render this — it only ever emits text — so this
    // section needs its own real <img> markup, unlike every other section
    // here, which is real content data flowing through plain text/typography.
    const images = node.slots.filter((s) => isRealSlot(s) && s.name.startsWith("image-") && !s.name.includes("alt"));
    const altByIndex = new Map(
      node.slots
        .filter((s) => isRealSlot(s) && s.name.startsWith("image-alt-"))
        .map((s) => [s.name.replace("image-alt-", ""), s] as const)
    );
    return (
      <div>
        <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))", gap: "0.75rem" }}>
          {images.map((slot) => {
            const alt = altByIndex.get(slot.name.replace("image-", ""));
            return (
              <img
                key={slot.name}
                src={slot.value!}
                alt={alt?.value ?? ""}
                style={{ width: "100%", height: "16rem", objectFit: "cover", display: "block" }}
              />
            );
          })}
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
      // Real per-day hours (design-generation-service.ts's buildHoursSlots)
      // pulled out for their own structured list, rather than falling into
      // the generic label/value grid below as N separate "Hours Day 1"-
      // labeled rows or (the pre-fix behavior) one run-on sentence.
      const hoursDaySlots = realSlots
        .filter((s) => /^hours-day-\d+$/.test(s.name))
        .sort((a, b) => Number(a.name.split("-")[2]) - Number(b.name.split("-")[2]));
      const flatHoursSlot = realSlots.find((s) => s.name === "hours");
      const rest = realSlots.filter(
        (s) => s.name !== "phone" && s.name !== "phoneHref" && s.name !== "businessName" && !hoursDaySlots.includes(s) && s !== flatHoursSlot
      );
      const displayRole = findTypeRole(refinedDesign, "heading1");
      return (
        <div>
          <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
          {phone && (
            <a
              href={resolvePhoneHref(node.slots, phone.value!)}
              style={{
                display: "block",
                fontFamily: headingFontStack,
                fontSize: displayRole ? `${displayRole.sizePx}px` : "2rem",
                fontWeight: 600,
                marginBottom: rest.length > 0 || hoursDaySlots.length > 0 || flatHoursSlot ? "1.5rem" : "0",
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
          {(hoursDaySlots.length > 0 || flatHoursSlot) && (
            <div style={{ marginBottom: "1rem" }}>
              <p style={{ fontSize: "0.75rem", textTransform: "uppercase", opacity: MUTED_TEXT_OPACITY, marginBottom: "0.4rem" }}>Hours</p>
              {hoursDaySlots.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                  {hoursDaySlots.map((slot) => (
                    <span key={slot.name} style={{ fontSize: "0.9rem" }}>
                      <SlotValue slot={slot} />
                    </span>
                  ))}
                </div>
              ) : (
                <SlotValue slot={flatHoursSlot!} />
              )}
            </div>
          )}
          {!phone && <TouchAffordance refinedDesign={refinedDesign} section="contact" label="Contact Us" accent={accent} textColor={textColor} variant={ctaVariant} />}
        </div>
      );
    }

    // stat-strip (composition-variants.ts, Service/Product and Bold
    // Commerce's pattern): the same real credibility evidence
    // (reviewCount/certifications) as an equal-width horizontal row of large
    // stat blocks with vertical dividers — a real trust-badge register
    // matching those two strategies' denser hero treatment, only reachable
    // when this business's real evidence (certifications or a real review
    // count) actually backs it (resolveCompositionVariant's evidence gate).
    // divided-rows (every other strategy's pattern) is the flex-wrap
    // label/value list below, unchanged.
    if (node.pattern === "stat-strip") {
      return (
        <div>
          <SectionHeading section={section} refinedDesign={refinedDesign} fontStack={headingFontStack} color={textColor} isSignature={isSignature} accent={accent} />
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {realSlots.map((slot, i) => (
              <div
                key={slot.name}
                style={{
                  flex: "1 1 10rem",
                  textAlign: "center",
                  padding: "0 1.5rem",
                  borderLeft: i === 0 ? "none" : `1px solid ${textColor}22`,
                }}
              >
                <p style={{ fontFamily: headingFontStack, fontSize: "1.5rem", fontWeight: 600, margin: 0, color: navAccentText }}>
                  <SlotValue slot={slot} />
                </p>
                <p style={{ fontSize: "0.75rem", textTransform: "uppercase", opacity: MUTED_TEXT_OPACITY, marginTop: "0.35rem" }}>
                  {slot.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/-\d+$/, "")}
                </p>
              </div>
            ))}
          </div>
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

  // Single-slot structural sections (menu, gallery, schedule, listings, serviceArea):
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
      {touchLabel && <TouchAffordance refinedDesign={refinedDesign} section={section} label={touchLabel} accent={accent} textColor={textColor} variant={ctaVariant} />}
    </div>
  );
}
