import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  generateWireframe,
  assembleComponents,
  generateWebsiteStructure,
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

function briefFor(industryBucket: IndustryBucket, layoutFamily: LayoutFamily, contactEvidence: ContactInfo = NO_CONTACT_EVIDENCE): DesignBrief {
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
    referencesConsidered: [{ referenceId: "test-ref", reasoning: "test reasoning — not structurally copied" }],
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
    assert.equal(phone.value, "519-744-9292");

    for (const name of ["address", "hours"]) {
      const slot = contact.slots.find((s) => s.name === name)!;
      assert.equal(slot.source, "placeholder");
      assert.equal(slot.value, null);
    }
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
    assert.equal(contact.slots.find((s) => s.name === "phone")?.value, "555-000-1111");
    assert.equal(contact.slots.find((s) => s.name === "address")?.source, "real");
    assert.equal(contact.slots.find((s) => s.name === "address")?.value, "1 Main St, Springfield");
    assert.equal(contact.slots.find((s) => s.name === "hours")?.source, "real");
    assert.equal(contact.slots.find((s) => s.name === "hours")?.value, "Mon-Fri 9am-5pm");
  });

  test("faq section slots are real, grounded in cited insights, capped and deduplicated by category", () => {
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
    const categories = faq.slots.map((s) => s.name);
    assert.equal(new Set(categories).size, categories.length, "faq slots should be deduplicated by category");
    for (const slot of faq.slots) {
      assert.equal(slot.source, "real");
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
      realTestimonials: ["Great service!", "Would recommend."],
      contactEvidence: NO_CONTACT_EVIDENCE,
    });
    const testimonials = components.find((c) => c.section === "testimonials")!;
    assert.equal(testimonials.slots.length, 2);
    assert.ok(testimonials.slots.every((s) => s.source === "real"));
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
