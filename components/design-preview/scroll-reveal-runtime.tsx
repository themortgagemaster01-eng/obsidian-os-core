"use client";

import * as React from "react";

import {
  SCROLL_REVEAL_SELECTOR,
  PENDING_ATTR,
  REVEALED_ATTR,
  REDUCED_MOTION_QUERY,
  SAFETY_REVEAL_TIMEOUT_MS,
  SCROLL_REVEAL_OBSERVER_OPTIONS,
  isAlreadyInViewport,
  shouldPreHide,
  hashTargetId,
} from "@/lib/design-render/scroll-reveal";

/**
 * ScrollRevealRuntime — Phase 6.3's actual scroll-triggered reveal. Mounted
 * once per DesignPreview render (see design-preview.tsx); renders nothing
 * itself. Its only job is WHEN an already-approved reveal plays — it never
 * decides WHETHER one should exist or HOW strong it should be (that stays
 * lib/services/design-refinement-service.ts::refineMotion's decision,
 * expressed on the DOM as each section's own CSS custom properties/
 * transition — see design-preview.tsx's SectionShell). This component only
 * ever ADDS the [data-op-pending] hidden state to a section it has
 * independently confirmed is off-screen; it never hides a section that's
 * already visible, and every section it hides is guaranteed to reach
 * [data-op-revealed] — via real scroll, a deep-link hash match, or the
 * safety timeout — so nothing can be left invisible indefinitely.
 *
 * No dependency added: this is plain browser IntersectionObserver, the
 * same platform API every other production scroll-reveal implementation
 * uses, already broadly supported with no polyfill this app's audience
 * needs.
 */
export function ScrollRevealRuntime(): null {
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;

    // Reduced motion: never touch the DOM at all. Every section keeps
    // whatever it already rendered as (fully visible — see SectionShell's
    // own comment on why the default, no-attribute state IS "visible").
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;

    const root = document.querySelector("[data-design-preview]");
    if (!root) return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>(SCROLL_REVEAL_SELECTOR));
    if (elements.length === 0) return; // e.g. this mission's motion budget is "none" — nothing to observe, nothing to do.

    const pendingTimeouts = new Map<Element, ReturnType<typeof setTimeout>>();

    const reveal = (el: Element) => {
      el.removeAttribute(PENDING_ATTR);
      el.setAttribute(REVEALED_ATTR, "");
      const timeout = pendingTimeouts.get(el);
      if (timeout !== undefined) {
        clearTimeout(timeout);
        pendingTimeouts.delete(el);
      }
      observer.unobserve(el);
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) reveal(entry.target);
      }
    }, SCROLL_REVEAL_OBSERVER_OPTIONS);

    const viewportHeight = window.innerHeight;
    const targetId = hashTargetId(window.location.hash);
    const hashTarget = targetId ? document.getElementById(targetId) : null;

    for (const el of elements) {
      if (el === hashTarget) continue; // deep-linked section: never pre-hide it in the first place.
      const rect = el.getBoundingClientRect();
      const alreadyVisible = isAlreadyInViewport({ top: rect.top, bottom: rect.bottom }, viewportHeight);
      if (!shouldPreHide(alreadyVisible)) continue;

      el.setAttribute(PENDING_ATTR, "");
      observer.observe(el);
      pendingTimeouts.set(
        el,
        setTimeout(() => reveal(el), SAFETY_REVEAL_TIMEOUT_MS)
      );
    }

    // Defense-in-depth for an in-page anchor click (Nav's own links) that
    // lands on a section the geometry check above still marked pending —
    // e.g. the browser's own scroll for that click hasn't completed yet at
    // the moment this effect ran. IntersectionObserver will normally catch
    // this on its own once the scroll settles; this listener just makes the
    // "deep-linked sections must never stay hidden" guarantee immediate
    // rather than dependent on that timing.
    const onHashChange = () => {
      const id = hashTargetId(window.location.hash);
      const target = id ? document.getElementById(id) : null;
      if (target && target.hasAttribute(PENDING_ATTR)) reveal(target);
    };
    window.addEventListener("hashchange", onHashChange);

    return () => {
      observer.disconnect();
      for (const timeout of pendingTimeouts.values()) clearTimeout(timeout);
      pendingTimeouts.clear();
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return null;
}
