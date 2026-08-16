import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  generateWireframe,
  assembleComponents,
  generateWebsiteStructure,
  applyContentEmphasis,
  collectContentWarnings,
  resolveSignatureSection,
  type SectionType,
} from "@/lib/services/design-generation-service";
import { matchesGenericSaasTemplate } from "@/lib/design-intelligence/layout-rules";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { IndustryBucket } from "@/lib/design-references/reference-library";
import type { LayoutFamily } from "@/lib/design-intelligence/layout-rules";
import type { ContactInfo } from "@/lib/adapters/types";

const NO_CONTACT_EVIDENCE: ContactInfo = { phones: [], emails: [], address: null, hours: null };

const ALL_BUCKETS: IndustryBucket[] = [
  "restaurant",
  "lawFirm",
  "dentistMedical",
  "homeService",
  "realEstate",
  "fitness",
  "luxuryServices",
  "general",
];

function briefFor(
  industryBucket: IndustryBucket,
  layoutFamily: LayoutFamily,
  contactEvidence: ContactInfo = NO_CONTACT_EVIDENCE,
  overrides: Partial<DesignBrief> = {}
): DesignBrief {
  return {
    missionId: "mission-1",
    businessName: "Acme Co",
    websiteUrl: "https://acme.test",
    industry: null,
    industryBucket,
    citedInsights: [
      { category: "performance", insightId: "slow-page-load", statement: "Pages load slowly." },
      { category: "mobile", insightId: "mobile-experience-gap", statement: "Mobile experience is rough." },
    ],
    contactEvidence,
    targetAudience: "Test audience",
    positioning: "Test positioning",
    direction: {
      layoutFamily,
      typographicMood: "test mood",
      colorDirection: "test color direction",
      motionIntensity: "restrained",
    },
    heroThesis: "Test hero thesis grounded in real evidence.",
    signatureElement: { element: "service-list-editorial-treatment", justification: "Test justification." },
    contentEmphasis: [],
    referencesConsidered: [{ referenceId: "test-ref", reasoning: "test reasoning — not structurally copied" }],
    ...overrides,
  };
}

describe("design-generation-service: generateWireframe", () => {
  test("every industry bucket produces a wireframe that never matches the banned generic-SaaS pattern", () => {
    for (const bucket of ALL_BUCKETS) {
      const brief = briefFor(bucket, "editorial");
      const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
      const order = wireframe.sections.map((s) => s.type);
      assert.equal(matchesGenericSaasTemplate(order), false, `bucket "${bucket}" produced the banned pattern`);
    }
  });

  test("every section carries a non-empty rationale", () => {
    const wireframe = generateWireframe(briefFor("restaurant", "imagery-led"), { hasRealTestimonials: false });
    for (const section of wireframe.sections) {
      assert.ok(section.rationale.trim().length > 0);
    }
  });

  test("restaurant bucket leads with an imagery/menu structure, not a credibility-first one", () => {
    const wireframe = generateWireframe(briefFor("restaurant", "imagery-led"), { hasRealTestimonials: false });
    const order = wireframe.sections.map((s) => s.type);
    assert.equal(order[0], "hero");
    assert.ok(order.includes("menu"));
  });

  test("lawFirm bucket leads with credibility before services", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
    const order = wireframe.sections.map((s) => s.type);
    assert.ok(order.indexOf("credibility") < order.indexOf("services"));
  });

  test("testimonials section is included only when hasRealTestimonials is true, and placed before contact", () => {
    const withoutTestimonials = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: false });
    assert.ok(!withoutTestimonials.sections.some((s) => s.type === "testimonials"));

    const withTestimonials = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: true });
    const order = withTestimonials.sections.map((s) => s.type);
    assert.ok(order.includes("testimonials"));
    assert.ok(order.indexOf("testimonials") < order.indexOf("contact"));
  });

  test("wireframe's layoutFamily matches the brief's direction", () => {
    const wireframe = generateWireframe(briefFor("realEstate", "listing-led"), { hasRealTestimonials: false });
    assert.equal(wireframe.layoutFamily, "listing-led");
  });

  test("every section order ends with contact then footer", () => {
    for (const bucket of ALL_BUCKETS) {
      const wireframe = generateWireframe(briefFor(bucket, "editorial"), { hasRealTestimonials: false });
      const order = wireframe.sections.map((s) => s.type);
      assert.deepEqual(order.slice(-2), ["contact", "footer"]);
    }
  });
});

describe("design-generation-service: assembleComponents", () => {
  test("hero component kind varies by layout family", () => {
    const imageryWireframe = generateWireframe(briefFor("restaurant", "imagery-led"), { hasRealTestimonials: false });
    const imageryComponents = assembleComponents(imageryWireframe, {
      businessName: "Acme",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
    });
    assert.equal(imageryComponents[0].componentKind, "ImageLedHero");

    const scheduleWireframe = generateWireframe(briefFor("fitness", "schedule-led"), { hasRealTestimonials: false });
    const scheduleComponents = assembleComponents(scheduleWireframe, {
      businessName: "Acme",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
    });
    assert.equal(scheduleComponents[0].componentKind, "EnergeticHero");
  });

  test("hero headline is a true placeholder only when neither metaDescription nor heroThesis exist — never fabricated", () => {
    const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, { businessName: "Acme", citedInsights: [], contactEvidence: NO_CONTACT_EVIDENCE });
    const hero = components.find((c) => c.section === "hero")!;
    const headline = hero.slots.find((s) => s.name === "headline")!;
    assert.equal(headline.source, "placeholder");
    assert.equal(headline.value, null);
  });

  test("hero headline is real, using the business's own published copy verbatim, when the crawl captured a clean metaDescription — the design-richness regression case", () => {
    const wireframe = generateWireframe(briefFor("restaurant", "imagery-led"), { hasRealTestimonials: false });
    const metaDescription = "Veslo Family Restaurant — home-style cooking in a warm, welcoming dining room.";
    const components = assembleComponents(wireframe, {
      businessName: "Veslo Family Restaurant",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      metaDescription,
    });
    const hero = components.find((c) => c.section === "hero")!;
    const headline = hero.slots.find((s) => s.name === "headline")!;
    assert.equal(headline.source, "real");
    assert.equal(headline.value, metaDescription);
  });

  // ===========================================================================
  // CTO Design Intelligence Remediation directive — Issue 2 (empty Veslo /
  // Alltech HVAC heroes: no metaDescription meant no headline at all, even
  // though Design Intelligence always produces a real heroThesis).
  // ===========================================================================
  test("hero headline falls back to the real, evidence-grounded heroThesis when no metaDescription was captured — the Veslo/Alltech HVAC empty-hero regression case", () => {
    const wireframe = generateWireframe(briefFor("homeService", "credibility-led"), { hasRealTestimonials: false });
    const heroThesis = "Alltech HVAC has kept this town's furnaces running through forty Michigan winters.";
    const components = assembleComponents(wireframe, {
      businessName: "Alltech HVAC",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      heroThesis,
    });
    const hero = components.find((c) => c.section === "hero")!;
    const headline = hero.slots.find((s) => s.name === "headline")!;
    assert.equal(headline.source, "real");
    assert.equal(headline.value, heroThesis);
  });

  test("hero headline prefers a clean metaDescription over heroThesis when both exist", () => {
    const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: false });
    const metaDescription = "Acme Co — trusted local service since 1988.";
    const components = assembleComponents(wireframe, {
      businessName: "Acme Co",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      metaDescription,
      heroThesis: "Should not be used since metaDescription is clean.",
    });
    const hero = components.find((c) => c.section === "hero")!;
    const headline = hero.slots.find((s) => s.name === "headline")!;
    assert.equal(headline.value, metaDescription);
  });

  // ===========================================================================
  // CTO Design Intelligence Remediation directive — Issue 5 (Wilcox Lawn &
  // Landscaping splice bug: metaDescription + stray CTA fragment + city/state
  // mashed onto the end of one sentence).
  // ===========================================================================
  test("hero headline strips a trailing CTA fragment and location splice off metaDescription — the Wilcox Lawn & Landscaping regression case", () => {
    const wireframe = generateWireframe(briefFor("homeService", "credibility-led"), { hasRealTestimonials: false });
    const metaDescription = "Enhance your outdoor space with expert lawn care & landscaping. Learn more! Clarklake, MI.";
    const components = assembleComponents(wireframe, {
      businessName: "Wilcox Lawn & Landscaping",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      metaDescription,
      heroThesis: "Should not be needed — the cleaned metaDescription should survive.",
    });
    const hero = components.find((c) => c.section === "hero")!;
    const headline = hero.slots.find((s) => s.name === "headline")!;
    assert.equal(headline.source, "real");
    assert.equal(headline.value, "Enhance your outdoor space with expert lawn care & landscaping.");
  });

  // ===========================================================================
  // CTO Design Intelligence Remediation directive — Issue 4 (Lakeshore
  // Family Dentistry: metaDescription claimed "3 Milwaukee locations" while
  // contactEvidence.address recorded one real Sarasota, FL address).
  // ===========================================================================
  test("hero headline drops a metaDescription that makes a multi-location claim contactEvidence can't corroborate, falling back to heroThesis — the Lakeshore Family Dentistry regression case", () => {
    const wireframe = generateWireframe(briefFor("dentistMedical", "credibility-led"), { hasRealTestimonials: false });
    const metaDescription = "Convenient family dental care at 3 Milwaukee locations, serving the whole family.";
    const heroThesis = "Lakeshore Family Dentistry has served Sarasota families from the same office for two decades.";
    const contactEvidence: ContactInfo = { phones: [], emails: [], address: "123 Bay St, Sarasota, FL 34236", hours: null };
    const components = assembleComponents(wireframe, {
      businessName: "Lakeshore Family Dentistry",
      citedInsights: [],
      contactEvidence,
      metaDescription,
      heroThesis,
    });
    const hero = components.find((c) => c.section === "hero")!;
    const headline = hero.slots.find((s) => s.name === "headline")!;
    assert.equal(headline.source, "real");
    assert.equal(headline.value, heroThesis);
    assert.doesNotMatch(headline.value!, /Milwaukee/);
  });

  test("hero headline drops a metaDescription naming a city that contradicts the real, verified contactEvidence.address", () => {
    const wireframe = generateWireframe(briefFor("dentistMedical", "credibility-led"), { hasRealTestimonials: false });
    const metaDescription = "Visit our Milwaukee, WI dental office for family-friendly care.";
    const heroThesis = "A real, evidence-grounded fallback headline.";
    const contactEvidence: ContactInfo = { phones: [], emails: [], address: "123 Bay St, Sarasota, FL 34236", hours: null };
    const components = assembleComponents(wireframe, {
      businessName: "Lakeshore Family Dentistry",
      citedInsights: [],
      contactEvidence,
      metaDescription,
      heroThesis,
    });
    const hero = components.find((c) => c.section === "hero")!;
    const headline = hero.slots.find((s) => s.name === "headline")!;
    assert.equal(headline.value, heroThesis);
  });

  test("every slot is explicitly marked real or placeholder, and real slots carry a non-null value", () => {
    const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, {
      businessName: "Acme Co",
      citedInsights: briefFor("general", "editorial").citedInsights,
      contactEvidence: NO_CONTACT_EVIDENCE,
    });
    for (const node of components) {
      for (const slot of node.slots) {
        assert.ok(slot.source === "real" || slot.source === "placeholder");
        if (slot.source === "real") assert.ok(slot.value !== null);
        if (slot.source === "placeholder") assert.equal(slot.value, null);
      }
    }
  });

  test("contact and footer sections carry the real business name, never a placeholder", () => {
    const wireframe = generateWireframe(briefFor("homeService", "credibility-led"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, { businessName: "Bob's Plumbing", citedInsights: [], contactEvidence: NO_CONTACT_EVIDENCE });
    const contact = components.find((c) => c.section === "contact")!;
    const footer = components.find((c) => c.section === "footer")!;
    assert.equal(contact.slots.find((s) => s.name === "businessName")?.value, "Bob's Plumbing");
    assert.equal(footer.slots.find((s) => s.name === "businessName")?.value, "Bob's Plumbing");
  });

  test("contact section's phone/address/hours are placeholders when no contact evidence was captured — never fabricated", () => {
    const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, { businessName: "Acme", citedInsights: [], contactEvidence: NO_CONTACT_EVIDENCE });
    const contact = components.find((c) => c.section === "contact")!;
    for (const name of ["phone", "address", "hours"]) {
      const slot = contact.slots.find((s) => s.name === name)!;
      assert.equal(slot.source, "placeholder");
      assert.equal(slot.value, null);
    }
  });

  test("contact section uses real evidence per-field when the crawl captured it, and stays placeholder for fields it didn't — the Veslo Family Restaurant regression case (real phone, no verified address/hours)", () => {
    const evidence: ContactInfo = { phones: ["519-744-9292"], emails: [], address: null, hours: null };
    const wireframe = generateWireframe(briefFor("restaurant", "imagery-led"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, { businessName: "Veslo Family Restaurant", citedInsights: [], contactEvidence: evidence });
    const contact = components.find((c) => c.section === "contact")!;

    const phone = contact.slots.find((s) => s.name === "phone")!;
    assert.equal(phone.source, "real");
    // CTO Benchmark Follow-Up directive §1: phone renders in a normal
    // human-readable format regardless of the source site's own raw style
    // — never the real Veslo regression ("15197449292" verbatim).
    assert.equal(phone.value, "(519) 744-9292");

    for (const name of ["address", "hours"]) {
      const slot = contact.slots.find((s) => s.name === name)!;
      assert.equal(slot.source, "placeholder");
      assert.equal(slot.value, null);
    }
  });

  test("footer carries a real phone slot when the crawl captured one, and a placeholder otherwise — never fabricated", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });

    const withPhone = assembleComponents(wireframe, {
      businessName: "Acme Law",
      citedInsights: [],
      contactEvidence: { phones: ["703-836-9030"], emails: [], address: null, hours: null },
    });
    const footerPhone = withPhone.find((c) => c.section === "footer")!.slots.find((s) => s.name === "phone")!;
    assert.equal(footerPhone.source, "real");
    assert.equal(footerPhone.value, "(703) 836-9030");

    const withoutPhone = assembleComponents(wireframe, { businessName: "Acme Law", citedInsights: [], contactEvidence: NO_CONTACT_EVIDENCE });
    const placeholderFooterPhone = withoutPhone.find((c) => c.section === "footer")!.slots.find((s) => s.name === "phone")!;
    assert.equal(placeholderFooterPhone.source, "placeholder");
    assert.equal(placeholderFooterPhone.value, null);
  });

  test("contact section marks all three fields real when the crawl captured all three", () => {
    const evidence: ContactInfo = {
      phones: ["555-000-1111"],
      emails: ["hello@acme.test"],
      address: "1 Main St, Springfield",
      hours: "Mon-Fri 9am-5pm",
    };
    const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, { businessName: "Acme", citedInsights: [], contactEvidence: evidence });
    const contact = components.find((c) => c.section === "contact")!;

    assert.equal(contact.slots.find((s) => s.name === "phone")?.source, "real");
    assert.equal(contact.slots.find((s) => s.name === "phone")?.value, "(555) 000-1111");
    assert.equal(contact.slots.find((s) => s.name === "address")?.source, "real");
    assert.equal(contact.slots.find((s) => s.name === "address")?.value, "1 Main St, Springfield");
    assert.equal(contact.slots.find((s) => s.name === "hours")?.source, "real");
    assert.equal(contact.slots.find((s) => s.name === "hours")?.value, "Mon-Fri 9am-5pm");
  });

  describe("design-generation-service: phone display formatting (CTO Benchmark Follow-Up directive §1/§2 — generic, not business-specific)", () => {
    test("formats a NANP number for display regardless of the source site's own raw style, and emits a separate phoneHref carrying the real tel:-ready E.164 value — the actual Veslo regression (raw '15197449292' rendered verbatim)", () => {
      const evidence: ContactInfo = {
        phones: ["15197449292"],
        phoneEvidence: [{ phone: "15197449292", normalized: "+15197449292", sourceUrl: "https://veslo.test/", source: "tel-link" }],
        emails: [],
        address: null,
        hours: null,
      };
      const wireframe = generateWireframe(briefFor("restaurant", "imagery-led"), { hasRealTestimonials: false });
      const components = assembleComponents(wireframe, { businessName: "Veslo Family Restaurant", citedInsights: [], contactEvidence: evidence });
      const contact = components.find((c) => c.section === "contact")!;
      assert.equal(contact.slots.find((s) => s.name === "phone")?.value, "(519) 744-9292");
      assert.equal(contact.slots.find((s) => s.name === "phoneHref")?.value, "+15197449292");
      assert.equal(contact.slots.find((s) => s.name === "phoneHref")?.source, "real");
    });

    test("footer gets the same formatted phone + phoneHref pair as contact", () => {
      const evidence: ContactInfo = {
        phones: ["8664822007"],
        phoneEvidence: [{ phone: "8664822007", normalized: "+18664822007", sourceUrl: "https://alltech-hvac.test/", source: "tel-link" }],
        emails: [],
        address: null,
        hours: null,
      };
      const wireframe = generateWireframe(briefFor("homeService", "credibility-led"), { hasRealTestimonials: false });
      const components = assembleComponents(wireframe, { businessName: "Alltech HVAC", citedInsights: [], contactEvidence: evidence });
      const footer = components.find((c) => c.section === "footer")!;
      assert.equal(footer.slots.find((s) => s.name === "phone")?.value, "(866) 482-2007");
      assert.equal(footer.slots.find((s) => s.name === "phoneHref")?.value, "+18664822007");
    });

    test("falls back to best-effort formatting from the raw phones[0] string when no phoneEvidence is present — an older stored row or a hand-built fixture, never a crash", () => {
      const evidence: ContactInfo = { phones: ["(703) 836.9030"], emails: [], address: null, hours: null };
      const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
      const components = assembleComponents(wireframe, { businessName: "Acme Law", citedInsights: [], contactEvidence: evidence });
      const contact = components.find((c) => c.section === "contact")!;
      assert.equal(contact.slots.find((s) => s.name === "phone")?.value, "(703) 836-9030");
      assert.equal(contact.slots.find((s) => s.name === "phoneHref")?.value, "+17038369030");
    });

    test("a non-NANP real number keeps its + prefix rather than being mangled into a wrong-looking domestic shape", () => {
      const evidence: ContactInfo = {
        phones: ["+442071234567"],
        phoneEvidence: [{ phone: "+442071234567", normalized: "+442071234567", sourceUrl: "https://london-firm.test/", source: "tel-link" }],
        emails: [],
        address: null,
        hours: null,
      };
      const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
      const components = assembleComponents(wireframe, { businessName: "London Firm", citedInsights: [], contactEvidence: evidence });
      const contact = components.find((c) => c.section === "contact")!;
      assert.equal(contact.slots.find((s) => s.name === "phone")?.value, "+442071234567");
      assert.equal(contact.slots.find((s) => s.name === "phoneHref")?.value, "+442071234567");
    });
  });

  // ===========================================================================
  // CTO Design Intelligence Remediation directive — Issue 3: the FAQ section
  // used to fall back to reframing citedInsights statements (raw
  // Lighthouse/axe-style audit findings about the business's OLD site) as
  // public-facing "questions" whenever no real FAQ evidence existed — near-
  // identical across businesses and the wrong voice/format for customer-
  // facing copy. That fallback is removed: citedInsights no longer back the
  // public faq section at all (the citation data itself still flows through
  // the brief unchanged, for internal/QA use).
  // ===========================================================================
  test("faq section never surfaces citedInsights as public-facing questions, even with several distinct categories cited", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
    const brief = briefFor("lawFirm", "credibility-led");
    const components = assembleComponents(wireframe, {
      businessName: "Acme Law",
      citedInsights: [
        ...brief.citedInsights,
        { category: "performance", insightId: "dup", statement: "Duplicate category citation." },
      ],
      contactEvidence: NO_CONTACT_EVIDENCE,
    });
    const faq = components.find((c) => c.section === "faq")!;
    for (const slot of faq.slots) {
      assert.equal(slot.source, "placeholder", "faq should stay placeholder-only when no real faqEvidence exists — citedInsights must never fill it");
      assert.equal(slot.value, null);
    }
  });

  test("throws if a testimonials section exists but no real testimonial text was supplied", () => {
    const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: true });
    assert.throws(
      () => assembleComponents(wireframe, { businessName: "Acme", citedInsights: [], contactEvidence: NO_CONTACT_EVIDENCE }),
      /requires real testimonial text/
    );
  });

  test("populates real testimonial slots when real text is supplied", () => {
    const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: true });
    const components = assembleComponents(wireframe, {
      businessName: "Acme",
      citedInsights: [],
      realTestimonials: [
        { quote: "Great service!", attribution: null },
        { quote: "Would recommend.", attribution: null },
      ],
      contactEvidence: NO_CONTACT_EVIDENCE,
    });
    const testimonials = components.find((c) => c.section === "testimonials")!;
    assert.equal(testimonials.slots.length, 2);
    assert.ok(testimonials.slots.every((s) => s.source === "real"));
  });

  test("pairs a real attribution with its quote as a separate testimonial-attribution-N slot; omits it entirely (never placeholder) when no real attribution was captured", () => {
    const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: true });
    const components = assembleComponents(wireframe, {
      businessName: "Acme",
      citedInsights: [],
      realTestimonials: [
        { quote: "She was with me through my entire divorce.", attribution: "Carolyn M. Grimes" },
        { quote: "Would recommend to anyone.", attribution: null },
      ],
      contactEvidence: NO_CONTACT_EVIDENCE,
    });
    const testimonials = components.find((c) => c.section === "testimonials")!;
    assert.equal(testimonials.slots.length, 3);
    const attribution1 = testimonials.slots.find((s) => s.name === "testimonial-attribution-1")!;
    assert.equal(attribution1.source, "real");
    assert.equal(attribution1.value, "Carolyn M. Grimes");
    assert.equal(
      testimonials.slots.some((s) => s.name === "testimonial-attribution-2"),
      false
    );
  });
});

describe("design-generation-service: applyContentEmphasis", () => {
  test("promotes an emphasized section to immediately after hero, ahead of the template's default order", () => {
    const order: SectionType[] = ["hero", "services", "serviceArea", "credibility", "faq", "contact", "footer"];
    const result = applyContentEmphasis(order, ["credibility"]);
    assert.deepEqual(result, ["hero", "credibility", "services", "serviceArea", "faq", "contact", "footer"]);
  });

  test("applies multiple emphasis entries in ranked order", () => {
    const order: SectionType[] = ["hero", "services", "serviceArea", "credibility", "faq", "contact", "footer"];
    const result = applyContentEmphasis(order, ["faq", "credibility"]);
    assert.deepEqual(result.slice(0, 3), ["hero", "faq", "credibility"]);
  });

  test("never moves hero, contact, or footer regardless of emphasis", () => {
    const order: SectionType[] = ["hero", "services", "credibility", "contact", "footer"];
    const result = applyContentEmphasis(order, ["services", "credibility"]);
    assert.equal(result[0], "hero");
    assert.deepEqual(result.slice(-2), ["contact", "footer"]);
  });

  test("ignores emphasis entries that are not in the bucket template's section set — never adds a section", () => {
    const order: SectionType[] = ["hero", "services", "credibility", "contact", "footer"];
    const result = applyContentEmphasis(order, ["menu"]);
    assert.deepEqual(result, order);
  });

  test("returns the original order unchanged when contentEmphasis is empty or undefined", () => {
    const order: SectionType[] = ["hero", "services", "credibility", "contact", "footer"];
    assert.deepEqual(applyContentEmphasis(order, []), order);
    assert.deepEqual(applyContentEmphasis(order, undefined), order);
  });

  test("produces different section orders for two businesses sharing the homeService bucket — the Alltech HVAC / Wilcox Lawn & Landscaping distinctness fix", () => {
    const hvacBrief = briefFor("homeService", "credibility-led", NO_CONTACT_EVIDENCE, {
      businessName: "Alltech HVAC",
      contentEmphasis: ["credibility"],
    });
    const landscapingBrief = briefFor("homeService", "credibility-led", NO_CONTACT_EVIDENCE, {
      businessName: "Wilcox Lawn & Landscaping",
      contentEmphasis: ["serviceArea"],
    });

    const hvacOrder = generateWireframe(hvacBrief, { hasRealTestimonials: false }).sections.map((s) => s.type);
    const landscapingOrder = generateWireframe(landscapingBrief, { hasRealTestimonials: false }).sections.map((s) => s.type);

    assert.notDeepEqual(hvacOrder, landscapingOrder, "two same-bucket businesses with different real evidence should not produce an identical wireframe");
  });
});

describe("design-generation-service: business-specific rationale", () => {
  test("hero rationale uses the brief's real heroThesis instead of the generic constant", () => {
    const brief = briefFor("restaurant", "imagery-led", NO_CONTACT_EVIDENCE, {
      heroThesis: "The original, unchanged-since-1888 New York Jewish deli.",
    });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    const hero = wireframe.sections.find((s) => s.type === "hero")!;
    assert.equal(hero.rationale, "The original, unchanged-since-1888 New York Jewish deli.");
  });

  test("the section signatureElement maps to carries the signature justification in its rationale", () => {
    const brief = briefFor("restaurant", "imagery-led", NO_CONTACT_EVIDENCE, {
      signatureElement: { element: "menu-editorial-presentation", justification: "The menu is the entire pitch for this business." },
    });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    const menu = wireframe.sections.find((s) => s.type === "menu")!;
    assert.match(menu.rationale, /The menu is the entire pitch for this business\./);
  });

  test("generateWireframe passes the brief's signatureElement through onto the Wireframe unchanged", () => {
    const brief = briefFor("restaurant", "imagery-led", NO_CONTACT_EVIDENCE, {
      signatureElement: { element: "menu-editorial-presentation", justification: "The menu is the entire pitch for this business." },
    });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    assert.deepEqual(wireframe.signatureElement, brief.signatureElement);
  });
});

describe("design-generation-service: resolveSignatureSection", () => {
  test("returns the section the signature element maps to when that section is present in the wireframe", () => {
    const brief = briefFor("restaurant", "imagery-led", NO_CONTACT_EVIDENCE, {
      signatureElement: { element: "menu-editorial-presentation", justification: "Test." },
    });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    assert.equal(resolveSignatureSection(wireframe), "menu");
  });

  test("falls back to hero when the signature element's ideal section isn't in this business's wireframe — the real Friedman Grimes case (service-area-location-motif chosen for a lawFirm-bucket wireframe, which has no serviceArea section)", () => {
    const brief = briefFor("lawFirm", "credibility-led", NO_CONTACT_EVIDENCE, {
      signatureElement: { element: "service-area-location-motif", justification: "Test." },
    });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    assert.ok(!wireframe.sections.some((s) => s.type === "serviceArea"));
    assert.equal(resolveSignatureSection(wireframe), "hero");
  });

  test("resolves to the signature element's ideal section (not hero) when that section IS present", () => {
    const brief = briefFor("homeService", "credibility-led", NO_CONTACT_EVIDENCE, {
      signatureElement: { element: "service-area-location-motif", justification: "Test." },
    });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    assert.ok(wireframe.sections.some((s) => s.type === "serviceArea"));
    assert.equal(resolveSignatureSection(wireframe), "serviceArea");
  });

  test("falls back to hero without throwing for a wireframe persisted before signatureElement existed — a real stored-data case (Veslo Family Restaurant's website_designs row predates this field and crashed the renderer before this guard was added)", () => {
    const brief = briefFor("restaurant", "imagery-led", NO_CONTACT_EVIDENCE);
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    const legacyWireframe = { ...wireframe, signatureElement: undefined as unknown as typeof wireframe.signatureElement };
    assert.equal(resolveSignatureSection(legacyWireframe), "hero");
  });
});

describe("design-generation-service: assembleComponents credibility/faq evidence", () => {
  test("credibility reviewCount is real when review evidence exists, placeholder otherwise", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
    const withReviews = assembleComponents(wireframe, {
      businessName: "Acme Law",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      reviews: { averageRating: 4.8, count: 120, source: "schema.org AggregateRating" },
    });
    const reviewCount = withReviews.find((c) => c.section === "credibility")!.slots.find((s) => s.name === "reviewCount")!;
    assert.equal(reviewCount.source, "real");
    assert.match(reviewCount.value!, /120 reviews \(4\.8 average\)/);

    const withoutReviews = assembleComponents(wireframe, { businessName: "Acme Law", citedInsights: [], contactEvidence: NO_CONTACT_EVIDENCE });
    const placeholderReviewCount = withoutReviews.find((c) => c.section === "credibility")!.slots.find((s) => s.name === "reviewCount")!;
    assert.equal(placeholderReviewCount.source, "placeholder");
  });

  test("credibility certifications are real, capped, when the crawler found them", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, {
      businessName: "Acme Law",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      certifications: [
        { heading: "Bar admission", excerpt: "Admitted to the State Bar since 1998.", sourceUrl: "https://acme-law.test/about" },
      ],
    });
    const certSlot = components.find((c) => c.section === "credibility")!.slots.find((s) => s.name === "certification-1")!;
    assert.equal(certSlot.source, "real");
    assert.equal(certSlot.value, "Admitted to the State Bar since 1998.");
  });

  test("yearsInBusiness always stays placeholder — no crawler signal extracts it", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, {
      businessName: "Acme Law",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      certifications: [{ heading: "x", excerpt: "y", sourceUrl: "z" }],
      reviews: { averageRating: 5, count: 10, source: "test" },
    });
    const yearsSlot = components.find((c) => c.section === "credibility")!.slots.find((s) => s.name === "yearsInBusiness")!;
    assert.equal(yearsSlot.source, "placeholder");
  });

  test("faq prefers real crawled FAQ evidence over citedInsights when both exist", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, {
      businessName: "Acme Law",
      citedInsights: [{ category: "performance", insightId: "x", statement: "Should not be used." }],
      contactEvidence: NO_CONTACT_EVIDENCE,
      faqEvidence: [{ heading: "Do you offer free consultations?", excerpt: "Yes, initial consultations are free.", sourceUrl: "https://acme-law.test/faq" }],
    });
    const faq = components.find((c) => c.section === "faq")!;
    assert.equal(faq.slots.length, 1);
    assert.match(faq.slots[0].value!, /Do you offer free consultations\?/);
    assert.match(faq.slots[0].value!, /Yes, initial consultations are free\./);
  });

  test("faq is placeholder-only (never citedInsights-derived) when the crawler found no real FAQ — the audit-copy-in-FAQ regression case", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, {
      businessName: "Acme Law",
      citedInsights: [{ category: "performance", insightId: "x", statement: "Pages load slowly." }],
      contactEvidence: NO_CONTACT_EVIDENCE,
    });
    const faq = components.find((c) => c.section === "faq")!;
    assert.equal(faq.slots.length, 1);
    assert.equal(faq.slots[0].source, "placeholder");
    assert.equal(faq.slots[0].value, null);
  });
});

describe("design-generation-service: services section (Friedman Flagship Final Content Pass — numbered editorial index)", () => {
  test("real category evidence produces an offering-N (category name) slot paired with an offering-detail-N (sub-items) slot", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, {
      businessName: "Acme Law",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      // heading/excerpt shape matches what findServiceMenuStructure
      // (crawl-adapter.ts) actually produces: heading is the real category
      // name, excerpt is the real, comma-joined sub-items under it.
      services: [
        { heading: "Family Law", excerpt: "Divorce, Child Custody, Child Support", sourceUrl: "https://acme-law.test/" },
        { heading: "Local Counsel", excerpt: "", sourceUrl: "https://acme-law.test/" },
      ],
    });
    const services = components.find((c) => c.section === "services")!;
    const category1 = services.slots.find((s) => s.name === "offering-1")!;
    const detail1 = services.slots.find((s) => s.name === "offering-detail-1")!;
    assert.equal(category1.value, "Family Law");
    assert.equal(detail1.value, "Divorce, Child Custody, Child Support");

    const category2 = services.slots.find((s) => s.name === "offering-2")!;
    assert.equal(category2.value, "Local Counsel");
    // A category with no real sub-item evidence gets no detail slot at all
    // — never a placeholder standing in for one, mirroring testimonials'
    // attribution discipline.
    assert.equal(
      services.slots.some((s) => s.name === "offering-detail-2"),
      false
    );
  });
});

describe("design-generation-service: team section (Evidence Depth pass — no longer folded into credibility)", () => {
  test("wireframe includes a dedicated \"team\" section only when hasRealTeam is true, placed before contact", () => {
    const withoutTeam = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false });
    assert.ok(!withoutTeam.sections.some((s) => s.type === "team"));

    const withTeam = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false, hasRealTeam: true });
    const order = withTeam.sections.map((s) => s.type);
    assert.ok(order.includes("team"));
    assert.ok(order.indexOf("team") < order.indexOf("contact"));
  });

  test("real team evidence produces one real, capped team-N slot per person as \"Name — Title\", never on \"credibility\"", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false, hasRealTeam: true });
    const components = assembleComponents(wireframe, {
      businessName: "Acme Law",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      // heading/excerpt shape matches what findTeamMembersByStructure
      // (crawl-adapter.ts) actually produces for a real name+title pair —
      // heading is the real captured name, excerpt is their real title.
      team: [
        { heading: "Carolyn M. Grimes", excerpt: "Partner", sourceUrl: "https://acme-law.test/team" },
        { heading: "Jessica L. Leischner", excerpt: "Partner", sourceUrl: "https://acme-law.test/team" },
      ],
    });
    const team = components.find((c) => c.section === "team")!;
    assert.equal(team.slots.length, 2);
    assert.equal(team.slots[0].name, "team-1");
    assert.equal(team.slots[0].source, "real");
    assert.equal(team.slots[0].value, "Carolyn M. Grimes — Partner");
    assert.equal(team.slots[1].value, "Jessica L. Leischner — Partner");

    const credibility = components.find((c) => c.section === "credibility")!;
    assert.ok(!credibility.slots.some((s) => s.name.startsWith("team-")), "team slots must not leak into credibility — this produced the customer-facing \"TEAM-1\" label leak regression");
  });

  test("team section falls back to a single placeholder when no real team evidence exists", () => {
    const wireframe = generateWireframe(briefFor("lawFirm", "credibility-led"), { hasRealTestimonials: false, hasRealTeam: true });
    const components = assembleComponents(wireframe, { businessName: "Acme Law", citedInsights: [], contactEvidence: NO_CONTACT_EVIDENCE });
    const team = components.find((c) => c.section === "team")!;
    assert.equal(team.slots.length, 1);
    assert.equal(team.slots[0].source, "placeholder");
    assert.equal(team.slots[0].value, null);
  });
});

describe("design-generation-service: generateWebsiteStructure", () => {
  test("composes generation and deterministic refinement into one structure with matching section counts", () => {
    const brief = briefFor("dentistMedical", "credibility-led");
    const { wireframe, components, refinedDesign } = generateWebsiteStructure(brief, { hasRealTestimonials: false });
    assert.equal(wireframe.sections.length, components.length);
    assert.deepEqual(
      wireframe.sections.map((s) => s.type),
      components.map((c) => c.section)
    );
    assert.ok(refinedDesign.typography);
    assert.ok(refinedDesign.spacing);
    assert.ok(refinedDesign.layout);
    assert.ok(refinedDesign.motion);
    assert.ok(refinedDesign.mobile);
  });
});

// ===========================================================================
// CTO Design Intelligence Remediation + Design Brain directive — hero
// composition (Structured Design Contract's hero.headline/supportingText
// independence) and evidence-conflict preservation. The real regression this
// guards: Veslo's full, analytically-written heroThesis rendered as 30+
// lines of oversized display text at 375px, visually colliding with the
// hero photo — "Hero Failure" in the directive's own language.
// ===========================================================================
describe("design-generation-service: hero composition (headline/supportingText split)", () => {
  test("a short headline candidate is never split — no supportingText is fabricated where none is needed", () => {
    const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, {
      businessName: "Acme Co",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      heroThesis: "Acme Co has served this neighborhood since 1988.",
    });
    const hero = components.find((c) => c.section === "hero")!;
    const headline = hero.slots.find((s) => s.name === "headline")!;
    const supportingText = hero.slots.find((s) => s.name === "supportingText")!;
    assert.equal(headline.value, "Acme Co has served this neighborhood since 1988.");
    assert.equal(supportingText.source, "placeholder");
    assert.equal(supportingText.value, null);
  });

  test("a long, em-dash-structured, business-voiced heroThesis splits into a short headline and a real supportingText sentence", () => {
    const wireframe = generateWireframe(briefFor("restaurant", "imagery-led"), { hasRealTestimonials: false });
    const heroThesis =
      "Veslo Family Restaurant has served the same home-style recipes from the same kitchen since 1962, with a dining room regulars still call their second home — every dish comes from a family recipe book, not a corporate menu, and the phone rings straight through to the kitchen, not a call center.";
    const components = assembleComponents(wireframe, {
      businessName: "Veslo Family Restaurant",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      heroThesis,
    });
    const hero = components.find((c) => c.section === "hero")!;
    const headline = hero.slots.find((s) => s.name === "headline")!;
    const supportingText = hero.slots.find((s) => s.name === "supportingText")!;

    assert.equal(headline.source, "real");
    assert.ok(headline.value!.length < heroThesis.length, "the split headline must be meaningfully shorter than the full source sentence");
    assert.ok(headline.value!.length < 200, `headline should read as a real headline, not a paragraph — got ${headline.value!.length} chars`);
    assert.equal(supportingText.source, "real");
    // Every word of the original real sentence must survive somewhere across the two fields — this is a reformatting of real content, never a truncation that drops evidence.
    const recombined = `${headline.value} ${supportingText.value}`.toLowerCase();
    for (const word of ["1962", "kitchen", "recipe", "phone", "corporate"]) {
      assert.ok(recombined.includes(word), `expected "${word}" to survive the split somewhere in headline+supportingText`);
    }
  });

  // ===========================================================================
  // Real content-boundary regression: three of the five benchmark businesses'
  // actual heroThesis output described the design/redesign process or an
  // audit of the OLD site — internal design rationale, not customer-facing
  // copy — and was rendered verbatim as the new site's hero headline. Fixed
  // at two layers: Pass 2's critique (violatesContentBoundary,
  // design-intelligence-service.ts) is the primary defense at generation
  // time; containsInternalRationaleLanguage here is the deterministic
  // render-side backstop that holds even if a contaminated heroThesis
  // reaches this function directly, exactly as it did for these three real
  // businesses' already-persisted Design Briefs.
  // ===========================================================================
  test("a heroThesis reading as internal design rationale/audit commentary is rejected, not rendered — the real Veslo/Alltech HVAC/Lakeshore contamination", () => {
    const realContaminatedHeroTheses = [
      // Veslo Family Restaurant's actual generated heroThesis
      "Veslo's own site analysis found severe accessibility failures capable of stopping a visitor from completing a task like finding a phone number, plus text too small to read on mobile — so this design's entire hero is built to be the fix, making the verified phone line the largest, first-read, easiest-to-tap element on the page rather than decoration nobody asked for.",
      // Alltech HVAC Inc's actual generated heroThesis
      "Where this business's current site loads slowly, breaks on phones, and is largely unusable for screen-reader and keyboard visitors, the rebuilt site is the one HVAC option in its market that a visitor on any device can actually read, navigate, and act on in seconds.",
      // Lakeshore Family Dentistry's actual generated heroThesis
      "With no published services, reviews, or credentials to build a differentiated story from, and a verified accessibility failure severe enough to stop someone from finding a phone number, this site's defining job is to make Lakeshore Family Dentistry's real phone number and address unmistakably legible and locatable on any device.",
    ];

    for (const heroThesis of realContaminatedHeroTheses) {
      const wireframe = generateWireframe(briefFor("general", "editorial"), { hasRealTestimonials: false });
      const components = assembleComponents(wireframe, {
        businessName: "Test Business",
        citedInsights: [],
        contactEvidence: NO_CONTACT_EVIDENCE,
        heroThesis,
      });
      const hero = components.find((c) => c.section === "hero")!;
      const headline = hero.slots.find((s) => s.name === "headline")!;
      assert.notEqual(headline.value, heroThesis, `contaminated heroThesis must never reach the rendered headline verbatim: "${heroThesis.slice(0, 60)}..."`);
      if (headline.source === "real") {
        assert.doesNotMatch(
          headline.value!,
          /accessibility failures?|screen-reader|this design|current site|rebuilt site|site analysis found/i,
          "no fragment of the internal-rationale language should leak into a real headline either"
        );
      }
    }
  });

  test("collectContentWarnings records a warning when heroThesis reads as internal rationale, so the rejection is visible for review, not silently dropped", () => {
    const heroThesis =
      "Where this business's current site loads slowly, breaks on phones, and is largely unusable for screen-reader and keyboard visitors, the rebuilt site is the one HVAC option in its market that a visitor on any device can actually read, navigate, and act on in seconds.";
    const warnings = collectContentWarnings({
      businessName: "Alltech HVAC Inc",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      heroThesis,
    });
    assert.ok(warnings.some((w) => w.field === "headline" && w.rejectedValue === heroThesis && /internal design rationale/.test(w.reason)));
  });

  test("headline and supportingText never contain the hardcoded CTA label — content-role separation holds structurally, not just by convention", () => {
    const wireframe = generateWireframe(briefFor("homeService", "credibility-led"), { hasRealTestimonials: false });
    const components = assembleComponents(wireframe, {
      businessName: "Wilcox Lawn & Landscaping",
      citedInsights: [],
      contactEvidence: { phones: [], emails: [], address: "3027 Blue Ridge Road, Clarklake, MI, 49234, US", hours: null },
      metaDescription: "Enhance your outdoor space with expert lawn care & landscaping. Learn more! Clarklake, MI.",
    });
    const hero = components.find((c) => c.section === "hero")!;
    for (const slot of hero.slots) {
      if (slot.source === "real") {
        assert.doesNotMatch(slot.value!, /Get in Touch/i, `${slot.name} must never contain the renderer's own CTA label`);
      }
    }
  });
});

describe("design-generation-service: collectContentWarnings (evidence conflict preservation)", () => {
  test("records a content warning when metaDescription's location claim conflicts with contactEvidence — the Lakeshore regression case", () => {
    const context = {
      businessName: "Lakeshore Family Dentistry",
      citedInsights: [],
      contactEvidence: { phones: [], emails: [], address: "123 Bay St, Sarasota, FL 34236", hours: null } as ContactInfo,
      metaDescription: "Convenient family dental care at 3 Milwaukee locations, serving the whole family.",
      heroThesis: "A real, evidence-grounded fallback headline.",
    };
    const warnings = collectContentWarnings(context);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].section, "hero");
    assert.equal(warnings[0].field, "headline");
    assert.match(warnings[0].rejectedValue, /Milwaukee/);
    assert.match(warnings[0].reason, /conflicts with contactEvidence/);
  });

  test("records no content warning when metaDescription and contactEvidence agree, or when there is nothing to reconcile", () => {
    const clean = collectContentWarnings({
      businessName: "Acme Co",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
      metaDescription: "Acme Co — trusted local service since 1988.",
    });
    assert.equal(clean.length, 0);

    const nothingToCheck = collectContentWarnings({
      businessName: "Acme Co",
      citedInsights: [],
      contactEvidence: NO_CONTACT_EVIDENCE,
    });
    assert.equal(nothingToCheck.length, 0);
  });

  test("generateWebsiteStructure exposes contentWarnings on its result, empty for clean data", () => {
    const brief = briefFor("dentistMedical", "credibility-led");
    const { contentWarnings } = generateWebsiteStructure(brief, { hasRealTestimonials: false });
    assert.deepEqual(contentWarnings, []);
  });
});
