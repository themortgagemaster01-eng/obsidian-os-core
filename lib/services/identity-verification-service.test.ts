import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { verifyBusinessIdentity, type VerifyBusinessIdentityInput } from "@/lib/services/identity-verification-service";

const EMPTY_CONTACT = { phones: [], emails: [], address: null, hours: null };

function baseInput(overrides: Partial<VerifyBusinessIdentityInput> = {}): VerifyBusinessIdentityInput {
  return {
    businessName: "Acme Diner",
    expectedLocation: null,
    osmPhone: null,
    osmAddress: null,
    crawl: {
      requestedUrl: "https://acmediner.test/",
      finalUrl: "https://acmediner.test/",
      title: "Acme Diner | Home",
      metaDescription: "Acme Diner, a real local restaurant.",
      jsonLdName: null,
      jsonLdType: null,
      contact: EMPTY_CONTACT,
    },
    ...overrides,
  };
}

/**
 * lib/services/identity-verification-service.test.ts — Phase 14
 * (docs/PHASE_14_IMPLEMENTATION_PLAN.md). All 10 scenario tests from the
 * approved plan's §12, plus focused unit tests on the corroboration rule
 * itself (§3) — the central "not brittle" requirement: a single mismatched
 * signal must never resolve IDENTITY_FAILED on its own.
 */

describe("identity-verification-service: the 10 approved scenario test cases", () => {
  test("1. Freight House Cafe (regression fixture, mirrors the real stored data) — IDENTITY_FAILED", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        businessName: "The Freight House Cafe",
        expectedLocation: { raw: "Mahopac, NY", countryHint: "US" },
        osmPhone: null,
        osmAddress: null,
        crawl: {
          requestedUrl: "https://thefreighthousecafe.com/",
          finalUrl: "https://retrolog.io/",
          title: "Xoilac TV | Xem Trực Tiếp Bóng Đá HD - Link Trực Tuyến Miễn Phí",
          metaDescription: "Xoilac TV trực tiếp bóng đá HD miễn phí, xem bóng đá ở tất cả giải đấu.",
          jsonLdName: null,
          jsonLdType: null,
          contact: {
            phones: ["+849078965432"],
            emails: ["support@xoilac1.site"],
            address: "23 Đ. Trung Mỹ Tây 12, Trung Mỹ Tây, Quận 12, Thành phố Hồ Chí Minh, Việt Nam",
            hours: null,
          },
        },
      })
    );
    assert.equal(result.verdict, "failed");
    const structuralMismatches = result.signals.filter(
      (s) => s.verdict === "mismatch" && ["redirect", "redirect_destination", "content_category", "json_ld"].includes(s.signal)
    );
    assert.ok(structuralMismatches.length >= 1, "at least one structural mismatch must corroborate");
    assert.ok(result.signals.filter((s) => s.verdict === "mismatch").length >= 2, "must have at least 2 corroborating mismatches");
  });

  test("2. Legitimate rebrand — domain changed, new domain's own content names the business — IDENTITY_CONFIRMED", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        businessName: "Acme Diner",
        crawl: {
          requestedUrl: "https://acmediner-old.test/",
          finalUrl: "https://acmerestaurantgroup.test/",
          title: "Acme Diner — now part of Acme Restaurant Group",
          metaDescription: "Acme Diner has a new home.",
          jsonLdName: "Acme Diner",
          jsonLdType: "Restaurant",
          contact: EMPTY_CONTACT,
        },
      })
    );
    assert.equal(result.verdict, "confirmed");
    const redirectSignal = result.signals.find((s) => s.signal === "redirect");
    assert.equal(redirectSignal?.verdict, "match");
  });

  test("3. An otherwise-clean site with one surprising, uncorroborated mismatch — IDENTITY_UNCERTAIN, not FAILED", () => {
    // Same domain, business name matches everywhere — but the one crawled
    // phone number's country doesn't match the expected one. A single soft
    // mismatch must never fail the mission alone.
    const result = verifyBusinessIdentity(
      baseInput({
        expectedLocation: { raw: "Springfield, IL", countryHint: "US" },
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://acmediner.test/",
          title: "Acme Diner | Home",
          metaDescription: "Acme Diner, a real local restaurant.",
          jsonLdName: null,
          jsonLdType: null,
          contact: { phones: ["+442071234567"], emails: [], address: null, hours: null },
        },
      })
    );
    assert.equal(result.verdict, "uncertain");
    assert.ok(result.suppressedEvidenceCategories.includes("contactEvidence"));
    assert.notEqual(result.verdict, "failed");
  });

  test("3b. Legitimate address change (business moved) — one uncorroborated mismatch — IDENTITY_UNCERTAIN", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        expectedLocation: { raw: "Springfield, IL", countryHint: "US" },
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://acmediner.test/",
          title: "Acme Diner | Home",
          metaDescription: "Acme Diner, a real local restaurant.",
          jsonLdName: null,
          jsonLdType: null,
          contact: { phones: [], emails: [], address: "412 Oak Street, Shelbyville, IL", hours: null },
        },
      })
    );
    assert.equal(result.verdict, "uncertain");
    assert.ok(result.suppressedEvidenceCategories.includes("contactEvidence"));
  });

  test("4. Parked domain, no real content at all — IDENTITY_FAILED", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://unrelated-parked-domain.test/",
          title: "unrelated-parked-domain.test is for sale | HugeDomains-style registrar",
          metaDescription: "This domain may be for sale. Buy this domain today.",
          jsonLdName: null,
          jsonLdType: null,
          contact: EMPTY_CONTACT,
        },
      })
    );
    assert.equal(result.verdict, "failed");
    const destinationSignal = result.signals.find((s) => s.signal === "redirect_destination");
    assert.equal(destinationSignal?.verdict, "mismatch");
  });

  test("5. Third-party ordering/hosting platform (legitimate) — page content names the business — IDENTITY_CONFIRMED", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://www.facebook.com/AcmeDinerOfficial/",
          title: "Acme Diner",
          metaDescription: "Acme Diner's official Facebook page.",
          jsonLdName: null,
          jsonLdType: null,
          contact: EMPTY_CONTACT,
        },
      })
    );
    assert.equal(result.verdict, "confirmed");
    const redirectSignal = result.signals.find((s) => s.signal === "redirect");
    assert.equal(redirectSignal?.verdict, "inconclusive");
  });

  test("6. Third-party platform, but the specific page has nothing to do with the business — IDENTITY_UNCERTAIN, not FAILED", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://www.facebook.com/SomeUnrelatedPage/",
          title: "Unrelated Page — Community Group",
          metaDescription: "A general community discussion group.",
          jsonLdName: null,
          jsonLdType: null,
          contact: EMPTY_CONTACT,
        },
      })
    );
    assert.equal(result.verdict, "uncertain");
  });

  test("7. Genuinely correct match, ordinary case — no redirect, name matches, thin-but-real content — IDENTITY_CONFIRMED", () => {
    const result = verifyBusinessIdentity(baseInput());
    assert.equal(result.verdict, "confirmed");
    assert.equal(result.suppressedEvidenceCategories.length, 0);
  });

  test("8. Ambiguous/thin evidence — redirected, but nothing corroborates or contradicts beyond the bare redirect — IDENTITY_UNCERTAIN", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://acmediner-relaunch.test/",
          title: null,
          metaDescription: null,
          jsonLdName: null,
          jsonLdType: null,
          contact: EMPTY_CONTACT,
        },
      })
    );
    assert.equal(result.verdict, "uncertain");
  });

  test("9. No lead/no OSM data at all (manually-created mission) — absent signals are inconclusive, never treated as mismatches", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        expectedLocation: null,
        osmPhone: null,
        osmAddress: null,
      })
    );
    assert.equal(result.verdict, "confirmed");
    const addressSignal = result.signals.find((s) => s.signal === "address");
    const phoneSignal = result.signals.find((s) => s.signal === "phone");
    assert.equal(addressSignal?.verdict, "inconclusive");
    assert.equal(phoneSignal?.verdict, "inconclusive");
  });

  test("10. Cross-mission domain reuse — each call is independent, no cached/shared verdict across calls for the same domain", () => {
    const goodInput = baseInput();
    const badInput = baseInput({
      crawl: {
        requestedUrl: "https://acmediner.test/",
        finalUrl: "https://unrelated-parked-domain.test/",
        title: "unrelated-parked-domain.test is for sale | Buy this domain",
        metaDescription: "This domain may be for sale.",
        jsonLdName: null,
        jsonLdType: null,
        contact: EMPTY_CONTACT,
      },
    });
    const firstResult = verifyBusinessIdentity(goodInput);
    const secondResult = verifyBusinessIdentity(badInput);
    const thirdResult = verifyBusinessIdentity(goodInput);
    assert.equal(firstResult.verdict, "confirmed");
    assert.equal(secondResult.verdict, "failed");
    assert.equal(thirdResult.verdict, "confirmed", "a prior FAILED verdict for a different crawl must never leak into a later, independent call");
  });
});

describe("identity-verification-service: the corroboration rule itself (not brittle, by construction)", () => {
  test("a single structural mismatch alone never resolves FAILED", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://acmediner-relaunch.test/",
          title: "Acme Diner",
          metaDescription: "Acme Diner's new site.",
          jsonLdName: "Acme Diner",
          jsonLdType: "Restaurant",
          contact: EMPTY_CONTACT,
        },
      })
    );
    // Business name and JSON-LD corroborate the rebrand, so redirect itself
    // resolves match here — this test's point is made more directly by
    // scenario 8 above (one uncorroborated structural mismatch -> uncertain,
    // never failed) and scenario 3/3b (one soft mismatch -> uncertain).
    assert.notEqual(result.verdict, "failed");
  });

  test("two soft (non-structural) mismatches without any structural one still never resolves FAILED", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        expectedLocation: { raw: "Springfield, IL", countryHint: "US" },
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://acmediner.test/",
          title: "Acme Diner | Home",
          metaDescription: "Acme Diner, a real local restaurant.",
          jsonLdName: null,
          jsonLdType: null,
          contact: { phones: ["+442071234567"], emails: [], address: "10 Downing Street, London, UK", hours: null },
        },
      })
    );
    const mismatches = result.signals.filter((s) => s.verdict === "mismatch");
    assert.ok(mismatches.every((s) => !["redirect", "redirect_destination", "content_category", "json_ld"].includes(s.signal)));
    assert.notEqual(result.verdict, "failed");
    assert.equal(result.verdict, "uncertain");
  });

  test("every verdict carries real, non-empty reasoning for every signal — never a bare label", () => {
    const result = verifyBusinessIdentity(baseInput());
    // 9, not 8, since the identity-verification suppression gap fix
    // (2026-09-12) added a 9th signal, content_ownership.
    assert.equal(result.signals.length, 9);
    for (const signal of result.signals) {
      assert.ok(signal.detail.length > 0, `${signal.signal} must carry real reasoning`);
    }
  });

  test("IDENTITY_CONFIRMED and IDENTITY_FAILED both suppress nothing — suppression is exclusive to IDENTITY_UNCERTAIN", () => {
    const confirmed = verifyBusinessIdentity(baseInput());
    assert.equal(confirmed.verdict, "confirmed");
    assert.deepEqual(confirmed.suppressedEvidenceCategories, []);

    const failed = verifyBusinessIdentity(
      baseInput({
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://unrelated-parked-domain.test/",
          title: "unrelated-parked-domain.test is for sale | Buy this domain",
          metaDescription: "This domain may be for sale.",
          jsonLdName: null,
          jsonLdType: null,
          contact: EMPTY_CONTACT,
        },
      })
    );
    assert.equal(failed.verdict, "failed");
    assert.deepEqual(failed.suppressedEvidenceCategories, []);
  });
});

// ===========================================================================
// Identity-verification suppression gap fix (2026-09-12) — real audit
// finding: services/team/certifications could never be suppressed by any
// signal, so X.com's own Terms of Service/Privacy Policy boilerplate
// (reached via twitter.com/mahopacgaming's own footer links) flowed all
// the way into Video Game Plus's real generated website as its "services"
// and "team" sections. Design QA caught it after the fact (CRITICAL:
// "the actual assembled content leaks unrelated third-party legal text");
// this signal closes the gap earlier, in Design Brief construction,
// before that content is ever cited or generated from at all.
// ===========================================================================
describe("identity-verification-service: content_ownership signal (services/team/certifications suppression)", () => {
  /** Verbatim real data: Video Game Plus's actual persisted crawl_result, mission 17cbe02c-d95d-484f-ba15-88aaec0ee9b1. */
  function vgpInput(): VerifyBusinessIdentityInput {
    return baseInput({
      businessName: "Video Game Plus",
      crawl: {
        requestedUrl: "https://www.twitter.com/mahopacgaming",
        finalUrl: "https://x.com/mahopacgaming",
        title: "Video Game Plus (@MahopacGaming) / X",
        metaDescription:
          "Video Game Plus buys, sells, and trades both new and retro video games. We also perform video game console, computer, cellphone, and electronic repairs",
        jsonLdName: null,
        jsonLdType: null,
        contact: EMPTY_CONTACT,
        services: [
          {
            heading: "X Terms of Service",
            excerpt:
              "Terms of Service We have made some updates to our Terms of Service. This version of the Terms of Service will go into effect on October 9, 2026.",
            sourceUrl: "https://x.com/tos",
          },
        ],
        team: [
          { heading: "X Corp.", excerpt: "Attn: Privacy Policy Inquiry", sourceUrl: "https://x.com/privacy" },
          { heading: "X Internet Unlimited Company", excerpt: "Attn: Data Protection Officer", sourceUrl: "https://x.com/privacy" },
        ],
        certifications: [],
      },
    });
  }

  test("regression: Video Game Plus's real contaminated data now gets services/team suppressed, and the verdict stays uncertain (not flipped to failed)", () => {
    const result = verifyBusinessIdentity(vgpInput());
    assert.equal(result.verdict, "uncertain", "a plain domain_brand mismatch plus this compound signal must still never resolve FAILED on its own");
    assert.deepEqual(
      [...result.suppressedEvidenceCategories].sort(),
      ["certifications", "services", "team"],
      "certifications is included even though empty here — suppression is category-level, not conditional on that category actually having content this time"
    );
    const ownership = result.signals.find((s) => s.signal === "content_ownership");
    assert.equal(ownership?.verdict, "mismatch");
    assert.match(ownership?.detail ?? "", /terms of service/i);
  });

  test("a plain domain mismatch with NO platform-boilerplate content never suppresses services/team/certifications (the deliberately-preserved exclusion)", () => {
    // Same domain_brand mismatch shape as the legitimate-rebrand scenario
    // (test 2 above) — but here the new domain's services/team content is
    // real, on-topic business content, not legal boilerplate.
    const result = verifyBusinessIdentity(
      baseInput({
        businessName: "Acme Diner",
        crawl: {
          requestedUrl: "https://acmediner-old.test/",
          finalUrl: "https://acmerestaurantgroup.test/",
          title: "Acme Diner — now part of Acme Restaurant Group",
          metaDescription: "Acme Diner has a new home.",
          jsonLdName: "Acme Diner",
          jsonLdType: "Restaurant",
          contact: EMPTY_CONTACT,
          services: [{ heading: "Catering", excerpt: "Full-service catering for events of any size.", sourceUrl: "https://acmerestaurantgroup.test/catering" }],
          team: [{ heading: "Head Chef", excerpt: "Twenty years of experience in Italian cuisine.", sourceUrl: "https://acmerestaurantgroup.test/team" }],
        },
      })
    );
    const ownership = result.signals.find((s) => s.signal === "content_ownership");
    assert.equal(ownership?.verdict, "inconclusive");
    assert.equal(result.suppressedEvidenceCategories.includes("services"), false);
    assert.equal(result.suppressedEvidenceCategories.includes("team"), false);
  });

  test("platform-boilerplate-shaped text alone, with NO domain mismatch, never suppresses anything (the compound gate really is compound)", () => {
    const result = verifyBusinessIdentity(
      baseInput({
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://acmediner.test/",
          title: "Acme Diner | Home",
          metaDescription: "Acme Diner, a real local restaurant.",
          jsonLdName: null,
          jsonLdType: null,
          contact: EMPTY_CONTACT,
          // Contrived: a real business's own site legitimately links its
          // own Privacy Policy from a services/team-classified page. This
          // must never suppress anything when the domain itself is fine.
          services: [{ heading: "Our Privacy Policy", excerpt: "See our full privacy policy and terms of service here.", sourceUrl: "https://acmediner.test/legal" }],
        },
      })
    );
    const ownership = result.signals.find((s) => s.signal === "content_ownership");
    assert.equal(ownership?.verdict, "inconclusive");
    assert.deepEqual(result.suppressedEvidenceCategories, []);
    assert.equal(result.verdict, "confirmed");
  });

  test("absent services/team/certifications fields (every pre-existing caller) resolve exactly like today — inconclusive, no suppression", () => {
    // No services/team/certifications passed at all — mirrors every
    // caller/fixture that existed before this fix.
    const result = verifyBusinessIdentity(
      baseInput({
        crawl: {
          requestedUrl: "https://acmediner.test/",
          finalUrl: "https://totally-unrelated-domain.test/",
          title: "Totally Unrelated Domain",
          metaDescription: "Nothing about Acme Diner here.",
          jsonLdName: null,
          jsonLdType: null,
          contact: EMPTY_CONTACT,
        },
      })
    );
    const ownership = result.signals.find((s) => s.signal === "content_ownership");
    assert.equal(ownership?.verdict, "inconclusive");
    assert.equal(result.suppressedEvidenceCategories.includes("services"), false);
  });
});
