import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assembleEmailDraft } from "@/lib/services/email-draft-service";
import type { ProposalContent } from "@/lib/services/proposal-service";

function buildContent(overrides: Partial<ProposalContent> = {}): ProposalContent {
  return {
    businessName: "Acme Restaurant",
    websiteUrl: "https://acme-restaurant.test",
    demoUrl: "/missions/mission-1/preview",
    generatedAt: new Date().toISOString(),
    currentWebsiteObservations: ["The current site loads slowly on mobile."],
    whyQualified: [],
    keyOpportunities: [
      { title: "Improve mobile load time", detail: "Compress images and defer non-critical scripts.", severity: "high" },
      { title: "Add missing alt text", detail: "Several real images have no alt text today.", severity: "medium" },
      { title: "Modernize the visual design", detail: "The current layout reads as dated.", severity: "low" },
    ],
    valueProposition: "This business has real, evidenced room for a modernized, faster website.",
    proposedNextStep: "Review the attached demo and QA results, then reply to schedule a short call to discuss next steps.",
    qaSummary: { overallVerdict: "PASS", passedCategories: 12, totalCategories: 12 },
    ...overrides,
  };
}

describe("email-draft-service: assembleEmailDraft", () => {
  test("subject includes the real business name, never a generic placeholder", () => {
    const draft = assembleEmailDraft(buildContent());
    assert.equal(draft.subject, "A quick redesign concept for Acme Restaurant");
  });

  test("body includes the real business name, real website URL, and the real demo URL", () => {
    const draft = assembleEmailDraft(buildContent());
    assert.ok(draft.body.includes("Acme Restaurant"));
    assert.ok(draft.body.includes("https://acme-restaurant.test"));
    assert.ok(draft.body.includes("/missions/mission-1/preview"));
  });

  test("body includes only the top two key opportunities, not all of them", () => {
    const draft = assembleEmailDraft(buildContent());
    assert.ok(draft.body.includes("Improve mobile load time"));
    assert.ok(draft.body.includes("Add missing alt text"));
    assert.ok(!draft.body.includes("Modernize the visual design"));
  });

  test("body includes the real proposedNextStep text verbatim", () => {
    const draft = assembleEmailDraft(buildContent());
    assert.ok(draft.body.includes("Review the attached demo and QA results"));
  });

  test("falls back to a real, honest generic line (not a fabricated opportunity) when there are zero key opportunities", () => {
    const draft = assembleEmailDraft(buildContent({ keyOpportunities: [] }));
    assert.ok(draft.body.includes("A few concrete opportunities to improve the current site's performance and presentation."));
  });

  test("is deterministic — the same content always produces the identical draft", () => {
    const content = buildContent();
    const first = assembleEmailDraft(content);
    const second = assembleEmailDraft(content);
    assert.deepEqual(first, second);
  });
});

describe("email-draft-service: assembleEmailDraft — no-website framing (Robert's locked spec, §9)", () => {
  function buildNoWebsiteContent(overrides: Partial<ProposalContent> = {}): ProposalContent {
    return buildContent({
      businessName: "Skyline Towing And Auto Repair",
      websiteUrl: null,
      currentWebsiteObservations: ["This business does not currently have a website — there is nothing to redesign, so this proposal presents a concept for its first website instead."],
      keyOpportunities: [],
      valueProposition: "This business has no online presence today. A polished, professional first website is a strong opportunity.",
      ...overrides,
    });
  }

  test("subject frames this as a first-website concept, not a redesign", () => {
    const draft = assembleEmailDraft(buildNoWebsiteContent());
    assert.equal(draft.subject, "A first website concept for Skyline Towing And Auto Repair");
  });

  test("body never says 'current website' — the exact language a no-website prospect must never see", () => {
    const draft = assembleEmailDraft(buildNoWebsiteContent());
    assert.ok(!draft.body.toLowerCase().includes("current website"), `body must not mention a "current website": ${draft.body}`);
    assert.ok(!draft.body.includes("I took a look at"), "must not use the existing-website intro line");
  });

  test("body honestly notices the business has no website yet, and still includes the real demo link and next step", () => {
    const draft = assembleEmailDraft(buildNoWebsiteContent());
    assert.ok(draft.body.includes("doesn't have a website yet"));
    assert.ok(draft.body.includes("/missions/mission-1/preview"));
    assert.ok(draft.body.includes("Review the attached demo and QA results"));
  });

  test("falls back to an honest new-build-appropriate line (not 'the current site') when there are zero key opportunities", () => {
    const draft = assembleEmailDraft(buildNoWebsiteContent({ keyOpportunities: [] }));
    assert.ok(!draft.body.includes("improve the current site's performance"));
    assert.ok(draft.body.includes("first website built around this business's own real, verified information"));
  });

  test("existing-website regression: websiteUrl !== null still produces the original redesign framing, byte-for-byte", () => {
    const draft = assembleEmailDraft(buildContent());
    assert.equal(draft.subject, "A quick redesign concept for Acme Restaurant");
    assert.ok(draft.body.includes("I took a look at Acme Restaurant's current website (https://acme-restaurant.test)"));
  });
});
