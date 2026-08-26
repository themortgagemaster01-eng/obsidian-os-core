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
