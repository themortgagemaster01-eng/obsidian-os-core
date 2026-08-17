import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildBusinessIntelligenceProfile, deriveConversionGoal } from "@/lib/services/business-intelligence-service";
import type { LeadRow } from "@/lib/repositories/lead-repository";
import type { CrawlRawResult, ContactInfo, FormInfo } from "@/lib/adapters/types";

function crawlFor(overrides: Partial<CrawlRawResult> = {}): CrawlRawResult {
  return {
    requestedUrl: "https://acme.test/",
    finalUrl: "https://acme.test/",
    statusCode: 200,
    title: "Acme Co",
    metaDescription: "Acme Co — real business description.",
    headingCounts: { h1: 1, h2: 2, h3: 0, h4: 0, h5: 0, h6: 0 },
    internalLinkCount: 12,
    externalLinkCount: 3,
    pages: [{ url: "https://acme.test/about", statusCode: 200, title: "About" }],
    robotsTxtFound: true,
    sitemapFound: true,
    htmlByteSize: 45_000,
    contact: {
      phones: ["+15550001111"],
      phoneEvidence: [{ phone: "555-000-1111", normalized: "+15550001111", sourceUrl: "https://acme.test/", source: "tel-link" }],
      emails: ["hi@acme.test"],
      address: "1 Main St",
      hours: "9-5",
    },
    socials: { facebook: "https://facebook.com/acme", instagram: null, twitter: null, linkedin: null, youtube: null, tiktok: null, yelp: null },
    certifications: [],
    licenses: [],
    services: [{ heading: "Services", excerpt: "Real services offered.", sourceUrl: "https://acme.test/" }],
    products: [],
    team: [],
    faq: [],
    testimonials: [],
    reviews: { averageRating: 4.5, count: 20, source: "schema.org" },
    gallery: [{ src: "https://acme.test/photo.jpg", alt: "Storefront", sourceUrl: "https://acme.test/" }],
    forms: [],
    maps: [],
    ...overrides,
  };
}

function fakeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  const crawl = crawlFor();
  return {
    id: "lead-1",
    organization_id: "org-1",
    business_name: "Acme Co",
    website_url: "https://acme.test/",
    industry: "restaurant",
    business_category: "amenity=restaurant",
    location: "Kitchener, Ontario",
    latitude: 43.45,
    longitude: -80.49,
    discovery_source: "openstreetmap",
    discovery_external_id: "node/1",
    status: "candidate",
    rejection_reason: null,
    website_score: 50,
    opportunity_score: 60,
    confidence_score: 70,
    main_weaknesses: ["Has a meta description"],
    main_opportunity: "Real upside.",
    recommended_hero_pattern: "editorial-typographic",
    recommended_design_strategy: null,
    recommended_conversion_goal: null,
    makeover_potential: "high",
    makeover_potential_reasons: ["Solid opportunity backed by real, reasonably rich evidence."],
    contact_evidence: crawl.contact as unknown as LeadRow["contact_evidence"],
    social_links: crawl.socials as unknown as LeadRow["social_links"],
    crawl_result: crawl as unknown as LeadRow["crawl_result"],
    company_id: null,
    mission_id: null,
    error_message: null,
    discovered_at: "2026-01-01T00:00:00Z",
    qualified_at: "2026-01-01T00:00:00Z",
    promoted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("business-intelligence-service: buildBusinessIntelligenceProfile", () => {
  test("resolves real phone display + href from the same phoneEvidence the design engine already uses — no duplicated extraction logic", () => {
    const profile = buildBusinessIntelligenceProfile(fakeLead());
    assert.equal(profile.phoneDisplay, "(555) 000-1111");
    assert.equal(profile.phoneHref, "+15550001111");
  });

  test("assembles contact/social/services/gallery fields straight from the lead's own already-captured evidence, no re-crawl", () => {
    const profile = buildBusinessIntelligenceProfile(fakeLead());
    assert.equal(profile.address, "1 Main St");
    assert.equal(profile.email, "hi@acme.test");
    assert.equal(profile.services.length, 1);
    assert.equal(profile.availableImages.length, 1);
    assert.equal(profile.socialLinks?.facebook, "https://facebook.com/acme");
  });

  test("availableVideos is always honestly empty — the crawler has no video-extraction heuristic yet", () => {
    const profile = buildBusinessIntelligenceProfile(fakeLead());
    assert.deepEqual(profile.availableVideos, []);
  });

  test("Phase 3.5: hoursByDay threads through from the crawl's own structured parse, real day names, never empty when the raw hours text had real day boundaries", () => {
    const contactWithHours: ContactInfo = {
      phones: ["+15550001111"],
      emails: ["hi@acme.test"],
      address: "1 Main St",
      hours: "Monday 9am - 5pm; Tuesday 9am - 5pm",
      hoursByDay: [
        { day: "Monday", hours: "9:00 AM – 5:00 PM" },
        { day: "Tuesday", hours: "9:00 AM – 5:00 PM" },
      ],
    };
    const lead = fakeLead({
      contact_evidence: contactWithHours as unknown as LeadRow["contact_evidence"],
      crawl_result: crawlFor({ contact: contactWithHours }) as unknown as LeadRow["crawl_result"],
    });
    const profile = buildBusinessIntelligenceProfile(lead);
    assert.deepEqual(profile.hoursByDay, [
      { day: "Monday", hours: "9:00 AM – 5:00 PM" },
      { day: "Tuesday", hours: "9:00 AM – 5:00 PM" },
    ]);
  });

  test("hoursByDay is honestly empty (not fabricated) when the crawl found no day-name boundary at all", () => {
    const profile = buildBusinessIntelligenceProfile(fakeLead());
    assert.deepEqual(profile.hoursByDay, []);
  });

  test("Design and Mobile weaknesses are honestly marked not-yet-assessed rather than fabricated from a crawl that never measured them", () => {
    const profile = buildBusinessIntelligenceProfile(fakeLead());
    assert.ok(profile.notYetAssessed.includes("design"));
    assert.ok(profile.notYetAssessed.includes("mobile"));
    assert.deepEqual(profile.weaknesses.design, []);
  });

  test("SEO weaknesses reflect real failed structural signals, negated for display rather than reusing the passing-case label verbatim", () => {
    const lead = fakeLead({ crawl_result: crawlFor({ metaDescription: null, sitemapFound: false }) as unknown as LeadRow["crawl_result"] });
    const profile = buildBusinessIntelligenceProfile(lead);
    assert.ok(profile.weaknesses.seo.includes("No meta description found."));
    assert.ok(profile.weaknesses.seo.includes("No sitemap.xml found."));
    assert.ok(!profile.weaknesses.seo.includes("Has a meta description"), "must not reuse the passing-case label verbatim for a failed signal");
    assert.ok(!profile.weaknesses.seo.includes("sitemap.xml present"), "must not reuse the passing-case label verbatim for a failed signal");
  });

  test("Trust weaknesses negate a failed legitimacy signal's pass-phrased label rather than reusing it verbatim (a failed 'Real address captured' signal must never read as a positive claim in the weaknesses list)", () => {
    const lead = fakeLead({ crawl_result: crawlFor({ contact: { phones: ["+15550001111"], emails: [], address: null, hours: null } }) as unknown as LeadRow["crawl_result"] });
    const profile = buildBusinessIntelligenceProfile(lead);
    assert.ok(!profile.weaknesses.trust.includes("Real address captured"), "must not reuse the passing-case label verbatim for a failed signal");
    assert.ok(profile.weaknesses.trust.some((w) => /no real address/i.test(w)));
  });

  test("Conversion weakness flags a site with no reachable contact method at all", () => {
    const lead = fakeLead({
      crawl_result: crawlFor({ contact: { phones: [], emails: [], address: null, hours: null }, forms: [] }) as unknown as LeadRow["crawl_result"],
    });
    const profile = buildBusinessIntelligenceProfile(lead);
    assert.ok(profile.weaknesses.conversion.length > 0);
  });

  test("recommendedVisualStrategy falls back to the hero pattern's documented label when recommended_design_strategy wasn't persisted (older row)", () => {
    const profile = buildBusinessIntelligenceProfile(fakeLead({ recommended_design_strategy: null, recommended_hero_pattern: "oversized-typographic" }));
    assert.match(profile.recommendedVisualStrategy ?? "", /Luxury Minimal/);
  });

  test("whyOpportunity surfaces the reject reason directly when makeover potential is reject", () => {
    const profile = buildBusinessIntelligenceProfile(
      fakeLead({ makeover_potential: "reject", makeover_potential_reasons: ["No real upside left to sell."] })
    );
    assert.equal(profile.whyOpportunity, "No real upside left to sell.");
  });

  test("a lead with no crawl_result (e.g. a rejected, never-qualified lead) still produces a profile, never throws", () => {
    const lead = fakeLead({ crawl_result: null, contact_evidence: null, social_links: null, website_score: null, opportunity_score: null, confidence_score: null, makeover_potential: null });
    assert.doesNotThrow(() => buildBusinessIntelligenceProfile(lead));
  });
});

describe("business-intelligence-service: Phase 3 opportunity intelligence (businessStrengthSignals / websiteOpportunitySignals / opportunityReasons)", () => {
  test("businessStrengthSignals only includes evidence-gated claims — never 'independent business' or anything else this codebase has no real evidence source for", () => {
    const profile = buildBusinessIntelligenceProfile(fakeLead());
    assert.ok(!profile.businessStrengthSignals.some((s) => /independent/i.test(s)), "no franchise/chain-detection heuristic exists — must never claim this");
  });

  test("Strong local reputation only appears when the real average rating clears the threshold, not merely because a rating exists", () => {
    const belowThreshold = buildBusinessIntelligenceProfile(
      fakeLead({ crawl_result: crawlFor({ reviews: { averageRating: 3.2, count: 20, source: "schema.org" } }) as unknown as LeadRow["crawl_result"] })
    );
    assert.ok(!belowThreshold.businessStrengthSignals.some((s) => /strong local reputation/i.test(s)));

    const aboveThreshold = buildBusinessIntelligenceProfile(
      fakeLead({ crawl_result: crawlFor({ reviews: { averageRating: 4.5, count: 20, source: "schema.org" } }) as unknown as LeadRow["crawl_result"] })
    );
    assert.ok(aboveThreshold.businessStrengthSignals.some((s) => /strong local reputation/i.test(s)));
  });

  test("High-quality photography signal is gated on a real minimum image count, not a single photo", () => {
    const oneImage = buildBusinessIntelligenceProfile(
      fakeLead({ crawl_result: crawlFor({ gallery: [{ src: "https://acme.test/1.jpg", alt: null, sourceUrl: "https://acme.test/" }] }) as unknown as LeadRow["crawl_result"] })
    );
    assert.ok(!oneImage.businessStrengthSignals.some((s) => /photography/i.test(s)));

    const threeImages = buildBusinessIntelligenceProfile(
      fakeLead({
        crawl_result: crawlFor({
          gallery: [
            { src: "https://acme.test/1.jpg", alt: null, sourceUrl: "https://acme.test/" },
            { src: "https://acme.test/2.jpg", alt: null, sourceUrl: "https://acme.test/" },
            { src: "https://acme.test/3.jpg", alt: null, sourceUrl: "https://acme.test/" },
          ],
        }) as unknown as LeadRow["crawl_result"],
      })
    );
    assert.ok(threeImages.businessStrengthSignals.some((s) => /photography/i.test(s)));
  });

  test("websiteOpportunitySignals reuses the same weakness evidence as Website Analysis — never a second, divergent computation of the same facts", () => {
    const lead = fakeLead({ crawl_result: crawlFor({ metaDescription: null, sitemapFound: false }) as unknown as LeadRow["crawl_result"] });
    const profile = buildBusinessIntelligenceProfile(lead);
    for (const w of [...profile.weaknesses.seo, ...profile.weaknesses.performance, ...profile.weaknesses.conversion]) {
      assert.ok(profile.websiteOpportunitySignals.includes(w));
    }
  });

  test("'Multiple real pages/services provide redesign opportunity' only appears once real content clears the minimum, matching the CTO mockup's own framing", () => {
    const thin = buildBusinessIntelligenceProfile(fakeLead()); // default fixture: 1 service, 1 extra page = 1 content unit
    assert.ok(!thin.websiteOpportunitySignals.some((s) => /provide real structure for a redesign/i.test(s)));

    const rich = buildBusinessIntelligenceProfile(
      fakeLead({
        crawl_result: crawlFor({
          services: [
            { heading: "Dine-in", excerpt: "x", sourceUrl: "https://acme.test/" },
            { heading: "Catering", excerpt: "x", sourceUrl: "https://acme.test/" },
          ],
        }) as unknown as LeadRow["crawl_result"],
      })
    );
    assert.ok(rich.websiteOpportunitySignals.some((s) => /provide real structure for a redesign/i.test(s)));
  });

  test("opportunityReasons for a REJECT lead matches the CTO's own Subway-shaped example in spirit ('already performs strongly, no meaningful opportunity') — never a generic template line", () => {
    const profile = buildBusinessIntelligenceProfile(
      fakeLead({
        makeover_potential: "reject",
        makeover_potential_reasons: ["The existing website already scores 100/100 on real structural signals — there's no real upside left to sell a redesign on, regardless of business legitimacy."],
      })
    );
    assert.deepEqual(profile.opportunityReasons, ["The existing website already scores 100/100 on real structural signals — there's no real upside left to sell a redesign on, regardless of business legitimacy."]);
  });

  test("opportunityReasons for a non-reject lead is the itemized checklist (business strength + website opportunity), not one prose sentence", () => {
    const profile = buildBusinessIntelligenceProfile(fakeLead({ makeover_potential: "high" }));
    assert.deepEqual(profile.opportunityReasons, [...profile.businessStrengthSignals, ...profile.websiteOpportunitySignals]);
    assert.ok(profile.opportunityReasons.length > 1, "the whole point of Phase 3 is itemized evidence, not a single line");
  });

  test("a lead with no crawl_result produces empty signal lists, never fabricated ones", () => {
    const profile = buildBusinessIntelligenceProfile(fakeLead({ crawl_result: null }));
    assert.deepEqual(profile.businessStrengthSignals, []);
    assert.deepEqual(profile.websiteOpportunitySignals, []);
  });
});

describe("business-intelligence-service: deriveConversionGoal", () => {
  const noContact: ContactInfo = { phones: [], emails: [], address: null, hours: null };
  const noForms: FormInfo[] = [];

  test("prefers a real phone as the primary conversion goal, matching the contact model's own tel:-first priority", () => {
    const goal = deriveConversionGoal({ ...noContact, phones: ["+15550001111"] }, noForms);
    assert.match(goal, /^Phone call/);
  });

  test("falls back to a contact form when no phone was captured but a real form exists", () => {
    const goal = deriveConversionGoal(noContact, [{ action: "/contact", method: "post", fieldCount: 3, hasEmailField: true, hasPhoneField: false }]);
    assert.match(goal, /^Contact form/);
  });

  test("falls back to email when neither phone nor a real form exists", () => {
    const goal = deriveConversionGoal({ ...noContact, emails: ["hi@acme.test"] }, noForms);
    assert.match(goal, /^Email inquiry/);
  });

  test("honestly falls back to a generic goal when no contact evidence was captured at all", () => {
    const goal = deriveConversionGoal(noContact, noForms);
    assert.match(goal, /^Request more information/);
  });
});
