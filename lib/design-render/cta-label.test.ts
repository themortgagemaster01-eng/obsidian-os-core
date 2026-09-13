import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveHeroCtaLabel, LEGACY_HERO_CTA_LABEL } from "@/lib/design-render/cta-label";

// ===========================================================================
// Fix #10 (Design Intelligence -> Production Decisions Audit) — the hero CTA
// label was a hardcoded "Get in Touch" literal, discarding DesignMemory's own
// real ctaHierarchy.primary reasoning entirely. The audit confirmed against
// live production data that four of six real missions had reasoned a specific
// VERIFIED phone number as the strongest primary action and rendered the
// generic string anyway. This resolver is the bounded, deterministic bridge —
// never an LLM call, never a general natural-language parser, never a
// fabricated digit.
// ===========================================================================

describe("cta-label: resolveHeroCtaLabel — recognized intents", () => {
  test("(1) call intent with an explicit phone number renders that exact number", () => {
    assert.equal(resolveHeroCtaLabel("Call 845-803-8728"), "Call 845-803-8728");
  });

  test("(2) call intent with no phone number in the source renders the generic call label — never a fabricated number", () => {
    assert.equal(resolveHeroCtaLabel("Call the restaurant directly"), "Call Now");
  });

  test("(3) email intent renders the short email label, never the raw sentence", () => {
    assert.equal(resolveHeroCtaLabel("Email the shop (hello@example.com) — the only verified channel"), "Email Us");
  });

  test("(4) reserve intent", () => {
    assert.equal(resolveHeroCtaLabel("Reserve a table"), "Reserve a Table");
  });

  test("(5) book intent", () => {
    assert.equal(resolveHeroCtaLabel("Book now"), "Book Now");
  });

  test("(6) schedule intent", () => {
    assert.equal(resolveHeroCtaLabel("Schedule a visit"), "Schedule a Visit");
  });

  test("(7) view-menu intent", () => {
    assert.equal(resolveHeroCtaLabel("View menu"), "View Menu");
    assert.equal(resolveHeroCtaLabel("View the menu"), "View the Menu");
  });

  test("(8) order intent", () => {
    assert.equal(resolveHeroCtaLabel("Order online"), "Order Online");
  });

  test("(9) view-listing intent", () => {
    assert.equal(resolveHeroCtaLabel("View listing"), "View Listing");
  });

  test("inquire and contact intents resolve within the bounded vocabulary", () => {
    // Already-short CTA copy keeps the business's own real wording (title-cased)
    // rather than being replaced by this module's generic per-intent label.
    assert.equal(resolveHeroCtaLabel("Inquire about availability"), "Inquire About Availability");
    // ...while longer inquire reasoning collapses to the bounded generic label.
    assert.equal(
      resolveHeroCtaLabel("Inquire about availability through the contact form, kept prominent on mobile"),
      "Inquire Now"
    );
    // "contact" intent IS the legacy generic action — same string by design.
    assert.equal(resolveHeroCtaLabel("Contact the studio to get started today"), LEGACY_HERO_CTA_LABEL);
  });
});

describe("cta-label: resolveHeroCtaLabel — fallback behavior", () => {
  test("(10) ambiguous prose that never leads with a recognized action falls back", () => {
    assert.equal(resolveHeroCtaLabel("A single clear action point, phrased generically"), LEGACY_HERO_CTA_LABEL);
    assert.equal(resolveHeroCtaLabel("The primary conversion path should feel effortless"), LEGACY_HERO_CTA_LABEL);
  });

  test("(11) empty/missing CTA falls back", () => {
    assert.equal(resolveHeroCtaLabel(""), LEGACY_HERO_CTA_LABEL);
    assert.equal(resolveHeroCtaLabel("   "), LEGACY_HERO_CTA_LABEL);
    assert.equal(resolveHeroCtaLabel(undefined), LEGACY_HERO_CTA_LABEL);
    assert.equal(resolveHeroCtaLabel(null), LEGACY_HERO_CTA_LABEL);
  });

  test("(12) an unsupported action verb outside the closed vocabulary falls back — never an invented label", () => {
    assert.equal(resolveHeroCtaLabel("Download our brochure"), LEGACY_HERO_CTA_LABEL);
    assert.equal(resolveHeroCtaLabel("Subscribe to the newsletter"), LEGACY_HERO_CTA_LABEL);
    assert.equal(resolveHeroCtaLabel("Join the loyalty program"), LEGACY_HERO_CTA_LABEL);
  });

  test("(13) a long explanatory sentence is never rendered verbatim, even when it leads with a recognized action", () => {
    const prose =
      "Reserve a table through the online booking widget, which should stay visible in the sticky header on every screen size and reinforce the restaurant's premium positioning";
    const label = resolveHeroCtaLabel(prose);
    assert.notEqual(label, prose);
    assert.ok(label.length <= 40, `resolved label must stay button-sized, got ${label.length} chars: "${label}"`);
    assert.equal(label, "Reserve Now");
  });

  test("(14) malformed/partial phone data never produces a fabricated number", () => {
    // Too few digits to be a real phone — must degrade to the generic call label, never pad or guess.
    assert.equal(resolveHeroCtaLabel("Call 845-803"), "Call Now");
    assert.equal(resolveHeroCtaLabel("Call us, serving the area since 1994"), "Call Now");
    assert.equal(resolveHeroCtaLabel("Call the number on our storefront sign"), "Call Now");
  });

  test("(15) the legacy fallback string itself is exactly unchanged", () => {
    assert.equal(LEGACY_HERO_CTA_LABEL, "Get in Touch");
  });

  test("a keyword appearing mid-prose never triggers an intent — only the LEADING action counts", () => {
    // This is the discriminator the real Brooklyn Organic Kitchen case needs:
    // its CTA reasoning mentions both "phone" and "email" while being a
    // description OF a CTA rather than CTA copy.
    assert.equal(
      resolveHeroCtaLabel("Make sure visitors can call or email without hunting for the details"),
      LEGACY_HERO_CTA_LABEL
    );
  });

  test("deterministic — the same input always resolves identically", () => {
    const input = "Call the restaurant (verified phone 845-621-9654) — persistent and unmissable";
    assert.equal(resolveHeroCtaLabel(input), resolveHeroCtaLabel(input));
  });
});

// ===========================================================================
// Real production fixtures — the exact ctaHierarchy.primary strings pulled
// from these six missions' live, persisted DesignMemory during the read-only
// audit. None was altered to make a test pass.
// ===========================================================================
describe("cta-label: resolveHeroCtaLabel — real production fixtures", () => {
  test("(16) Carriage House Mahopac — verified phone reaches the button", () => {
    assert.equal(resolveHeroCtaLabel("Call 845-803-8728"), "Call 845-803-8728");
  });

  test("(17) Countryside Kitchen — verified phone reaches the button", () => {
    assert.equal(resolveHeroCtaLabel("Call 845-803-8420"), "Call 845-803-8420");
  });

  test("(18) Dante's Trattoria — the verified number is extracted out of the surrounding reasoning, and the prose is not rendered", () => {
    const real = "Call the restaurant (verified phone 845-621-9654) — persistent and unmissable, especially on mobile";
    assert.equal(resolveHeroCtaLabel(real), "Call 845-621-9654");
  });

  test("(19) The Freight House Cafe — real call intent but no digits in the CTA field: generic call label, never a number borrowed from elsewhere", () => {
    const real = "Call the café directly (verified phone number, kept visible and unmissable on every screen size)";
    assert.equal(resolveHeroCtaLabel(real), "Call Now");
  });

  test("(20) Video Game Plus — email intent, short label, address never rendered", () => {
    const real =
      "Email the shop (copyright@x.com) — the only verified contact channel, made clearly visible and accessible via keyboard and screen reader.";
    const label = resolveHeroCtaLabel(real);
    assert.equal(label, "Email Us");
    assert.ok(!label.includes("@"), "an email address must never reach the rendered button");
  });

  test("(21) Brooklyn Organic Kitchen — intentionally generic CTA reasoning still renders the legacy generic label", () => {
    const real =
      "A single clear 'Get in touch' action point, phrased generically (e.g. 'Find out more' / 'Get in touch') without asserting any specific unverified phone, email, or address.";
    assert.equal(resolveHeroCtaLabel(real), LEGACY_HERO_CTA_LABEL);
  });

  test("all six real fixtures resolve to genuinely button-sized copy, never Design Memory prose", () => {
    const realCtaFields = [
      "Call 845-803-8728",
      "Call 845-803-8420",
      "Call the restaurant (verified phone 845-621-9654) — persistent and unmissable, especially on mobile",
      "Call the café directly (verified phone number, kept visible and unmissable on every screen size)",
      "Email the shop (copyright@x.com) — the only verified contact channel, made clearly visible and accessible via keyboard and screen reader.",
      "A single clear 'Get in touch' action point, phrased generically (e.g. 'Find out more' / 'Get in touch') without asserting any specific unverified phone, email, or address.",
    ];
    for (const field of realCtaFields) {
      const label = resolveHeroCtaLabel(field);
      assert.ok(label.length <= 40, `"${label}" is too long for a button`);
      assert.ok(label.split(/\s+/).length <= 5, `"${label}" is too many words for a button`);
      // Explanatory prose must never render verbatim. An already-short source
      // (Carriage House's own "Call 845-803-8728" IS correct button copy) is
      // legitimately allowed through unchanged — that's the desired outcome,
      // not a verbatim-prose leak.
      if (field.length > 40) {
        assert.notEqual(label, field, `long Design Memory prose must never render verbatim: "${field}"`);
      }
    }
  });

  test("before Fix #10: every one of the six real missions rendered the identical hardcoded label — proves this was a real, live discard, not a hypothetical", () => {
    // The pre-Fix-#10 renderer passed this literal for every mission,
    // regardless of what ctaHierarchy.primary actually said.
    const PRE_FIX_10_HARDCODED = "Get in Touch";
    const resolvedNow = [
      resolveHeroCtaLabel("Call 845-803-8728"),
      resolveHeroCtaLabel("Call 845-803-8420"),
      resolveHeroCtaLabel("Call the restaurant (verified phone 845-621-9654) — persistent and unmissable, especially on mobile"),
      resolveHeroCtaLabel("Call the café directly (verified phone number, kept visible and unmissable on every screen size)"),
      resolveHeroCtaLabel("Email the shop (copyright@x.com) — the only verified contact channel."),
    ];
    for (const label of resolvedNow) {
      assert.notEqual(label, PRE_FIX_10_HARDCODED, "these five real missions must no longer render the generic literal");
    }
  });
});
