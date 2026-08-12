import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildDesignIntelligencePrompt,
  parseDesignIntelligenceResponse,
  generateDesignIntelligence,
  critiqueDesignDirection,
  SIGNATURE_ELEMENT_VOCABULARY,
  type DesignIntelligenceInput,
  type DesignIntelligencePass1Result,
} from "@/lib/services/design-intelligence-service";
import type { LlmProvider, LlmMessageRequest } from "@/lib/llm/provider";
import { selectReferenceDirections } from "@/lib/design-references/reference-library";

const SAMPLE_INPUT: DesignIntelligenceInput = {
  businessName: "Katz's Delicatessen",
  industry: "Restaurant",
  industryBucket: "restaurant",
  citedInsights: [
    { category: "performance", insightId: "slow-page-load", statement: "Pages load slowly." },
    { category: "mobile", insightId: "mobile-experience-gap", statement: "Mobile experience is rough." },
  ],
  weakestCategory: { category: "performance", score: 25 },
  candidateReferences: selectReferenceDirections("restaurant"),
  contactEvidence: { phones: ["212-555-0100"], emails: [], address: null, hours: null },
  metaDescription: "Katz's Delicatessen — the original, unchanged-since-1888 New York Jewish deli.",
  services: [{ heading: "Menu", excerpt: "Pastrami on rye, matzo ball soup.", sourceUrl: "https://katzsdelicatessen.com/menu" }],
  testimonials: [{ heading: "Reviews", excerpt: "Best pastrami in NYC.", sourceUrl: "https://katzsdelicatessen.com/reviews" }],
};

function validDesignBriefFields(overrides: Record<string, unknown> = {}) {
  return {
    targetAudience: "Local diners deciding where to eat tonight.",
    positioning: "Lead with imagery and atmosphere.",
    direction: {
      layoutFamily: "imagery-led",
      typographicMood: "warm serif display",
      colorDirection: "warm natural tones",
      motionIntensity: "restrained",
    },
    heroThesis: "The original, unchanged-since-1888 New York Jewish deli — not a recreation of one.",
    signatureElement: { element: "authentic-photography-hero", justification: "Real above-fold photography anchors 137 years of continuous operation, evidence no competitor can claim." },
    contentEmphasis: ["testimonials", "services"],
    ...overrides,
  };
}

function validResponseJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    designBrief: validDesignBriefFields(overrides.designBrief as Record<string, unknown> | undefined),
    designMemory: {
      typography: { headingFamily: "Fraunces", bodyFamily: "Inter", scaleNotes: "generous contrast" },
      colorPalette: { primary: "#3b2a1a", secondary: "#f5ead6", accent: "#c1502e", neutral: "#fafafa", notes: "warm" },
      spacingScale: { baseUnit: "8px", notes: "generous" },
      grid: { columns: 12, notes: "standard" },
      borderRadius: "0.5rem",
      shadows: "soft, low-opacity",
      icons: "line icons, minimal",
      photographyStyle: "warm, natural light food photography",
      motionLevel: "restrained",
      ctaHierarchy: { primary: "Reserve a table", secondary: "View menu" },
      componentVariants: ["ImageLedHero", "MenuList"],
      brandPersonality: ["warm", "inviting"],
      accessibilityTargets: "WCAG AA",
      seoPriorities: ["local search visibility"],
      contentTone: "warm, sensory",
      preferredLayouts: ["imagery-led"],
    },
    reasoning: "This business is a restaurant, so imagery and atmosphere should lead.",
    ...(overrides.top as Record<string, unknown> | undefined),
  });
}

function validCritiqueJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    isGeneric: false,
    violatesContentBoundary: false,
    reasoning: "The direction is traceable to the business's real 1888 heritage and real testimonials.",
    recommendation: null,
    ...overrides,
  });
}

describe("design-intelligence-service: buildDesignIntelligencePrompt", () => {
  const { systemPrompt, userPrompt } = buildDesignIntelligencePrompt(SAMPLE_INPUT);

  test("system prompt embeds real rule constants, not a paraphrase", () => {
    assert.match(systemPrompt, /At most 2 type families/);
    assert.match(systemPrompt, /200-300ms/);
    assert.match(systemPrompt, /editorial, imagery-led, credibility-led, schedule-led, menu-led, listing-led/);
  });

  test("system prompt embeds the Design Brain's ten questions (CTO amendment)", () => {
    assert.match(systemPrompt, /Design Brain/);
    assert.match(systemPrompt, /What is distinctive about this business\?/);
    assert.match(systemPrompt, /What ONE signature element makes this design memorable\?/);
  });

  test("system prompt embeds the Genericity Challenge and known generic-AI-default list", () => {
    assert.match(systemPrompt, /Genericity Challenge/);
    assert.match(systemPrompt, /purple\/blue gradient/);
    assert.match(systemPrompt, /would your direction still make just as much sense if this business's name were swapped/);
  });

  test("system prompt lists the exact signature element vocabulary", () => {
    for (const id of SIGNATURE_ELEMENT_VOCABULARY) {
      assert.match(systemPrompt, new RegExp(id.replace(/[-/]/g, "\\$&")));
    }
  });

  test("system prompt instructs JSON-only output", () => {
    assert.match(systemPrompt, /ONLY a single JSON object/);
    assert.match(systemPrompt, /no markdown code fences/);
  });

  test("user prompt includes the business's real cited facts", () => {
    assert.match(userPrompt, /Katz's Delicatessen/);
    assert.match(userPrompt, /Pages load slowly\./);
    assert.match(userPrompt, /performance at 25\/100/);
  });

  test("user prompt includes real services/testimonials evidence, not just citations", () => {
    assert.match(userPrompt, /Pastrami on rye, matzo ball soup\./);
    assert.match(userPrompt, /Best pastrami in NYC\./);
  });

  test("user prompt honestly states when no certifications/team/faq/reviews evidence was found", () => {
    assert.match(userPrompt, /Certifications\/credentials: none found by the crawler\./);
    assert.match(userPrompt, /Team: none found by the crawler\./);
    assert.match(userPrompt, /FAQ: none found by the crawler\./);
    assert.match(userPrompt, /Reviews: none found by the crawler\./);
  });

  test("user prompt lists candidate references with an explicit 'inspiration only' instruction", () => {
    assert.match(userPrompt, /restaurant-imagery-atmosphere/);
    assert.match(userPrompt, /inspiration for your reasoning only — never copy their structure/);
  });

  test("system prompt states the contact-evidence honesty rule", () => {
    assert.match(systemPrompt, /Contact-evidence honesty rule, non-negotiable/);
    assert.match(systemPrompt, /never claim, imply, or promise that it is present/);
  });

  test("user prompt marks a verified contact field as VERIFIED with its real value", () => {
    assert.match(userPrompt, /Phone: VERIFIED — 212-555-0100/);
  });

  test("user prompt marks unverified contact fields as not verified, never inventing a value", () => {
    assert.match(userPrompt, /Email: not verified — do not claim or imply one exists\./);
    assert.match(userPrompt, /Address: not verified — do not claim or imply one exists\./);
    assert.match(userPrompt, /Hours: not verified — do not claim or imply they exist\./);
  });
});

describe("design-intelligence-service: parseDesignIntelligenceResponse", () => {
  test("parses a clean, valid response", () => {
    const result = parseDesignIntelligenceResponse(validResponseJson());
    assert.equal(result.designBrief.targetAudience, "Local diners deciding where to eat tonight.");
    assert.equal(result.designBrief.direction.layoutFamily, "imagery-led");
    assert.equal(result.designBrief.direction.motionIntensity, "restrained");
    assert.equal(result.designBrief.heroThesis, "The original, unchanged-since-1888 New York Jewish deli — not a recreation of one.");
    assert.equal(result.designBrief.signatureElement.element, "authentic-photography-hero");
    assert.deepEqual(result.designBrief.contentEmphasis, ["testimonials", "services"]);
    assert.equal(result.designMemory.typography.headingFamily, "Fraunces");
    assert.match(result.reasoning, /restaurant/);
  });

  test("parses a response wrapped in a markdown code fence", () => {
    const wrapped = "```json\n" + validResponseJson() + "\n```";
    const result = parseDesignIntelligenceResponse(wrapped);
    assert.equal(result.designBrief.direction.layoutFamily, "imagery-led");
  });

  test("parses a response wrapped in conversational prose", () => {
    const wrapped = "Sure, here's the design brief:\n\n" + validResponseJson() + "\n\nLet me know if you'd like changes!";
    const result = parseDesignIntelligenceResponse(wrapped);
    assert.equal(result.designBrief.direction.layoutFamily, "imagery-led");
  });

  test("rejects a response missing designBrief", () => {
    const raw = JSON.stringify({ designMemory: {}, reasoning: "x" });
    assert.throws(() => parseDesignIntelligenceResponse(raw), /missing a "designBrief" object/);
  });

  test("rejects an invalid layoutFamily value rather than silently accepting it", () => {
    const parsed = JSON.parse(validResponseJson());
    parsed.designBrief.direction.layoutFamily = "some-made-up-layout";
    assert.throws(
      () => parseDesignIntelligenceResponse(JSON.stringify(parsed)),
      /direction\.layoutFamily must be one of/
    );
  });

  test("rejects an invalid motionIntensity value", () => {
    const parsed = JSON.parse(validResponseJson());
    parsed.designBrief.direction.motionIntensity = "wild";
    assert.throws(
      () => parseDesignIntelligenceResponse(JSON.stringify(parsed)),
      /motionIntensity must be "restrained" or "energetic"/
    );
  });

  test("rejects an empty targetAudience string", () => {
    const parsed = JSON.parse(validResponseJson());
    parsed.designBrief.targetAudience = "   ";
    assert.throws(() => parseDesignIntelligenceResponse(JSON.stringify(parsed)), /targetAudience must be a non-empty string/);
  });

  test("rejects a response missing designMemory", () => {
    const parsed = JSON.parse(validResponseJson());
    delete parsed.designMemory;
    assert.throws(() => parseDesignIntelligenceResponse(JSON.stringify(parsed)), /missing a "designMemory" object/);
  });

  test("rejects a response missing reasoning", () => {
    const parsed = JSON.parse(validResponseJson());
    delete parsed.reasoning;
    assert.throws(() => parseDesignIntelligenceResponse(JSON.stringify(parsed)), /"reasoning" must be a non-empty string/);
  });

  test("rejects an empty heroThesis", () => {
    const parsed = JSON.parse(validResponseJson());
    parsed.designBrief.heroThesis = "";
    assert.throws(() => parseDesignIntelligenceResponse(JSON.stringify(parsed)), /heroThesis must be a non-empty string/);
  });

  test("rejects a signatureElement.element outside the fixed vocabulary — never invents a renderer capability", () => {
    const parsed = JSON.parse(validResponseJson());
    parsed.designBrief.signatureElement.element = "confetti-explosion";
    assert.throws(
      () => parseDesignIntelligenceResponse(JSON.stringify(parsed)),
      /signatureElement\.element must be one of/
    );
  });

  test("rejects a missing signatureElement.justification", () => {
    const parsed = JSON.parse(validResponseJson());
    delete parsed.designBrief.signatureElement.justification;
    assert.throws(() => parseDesignIntelligenceResponse(JSON.stringify(parsed)), /signatureElement\.justification must be a non-empty string/);
  });

  test("rejects a non-array contentEmphasis", () => {
    const parsed = JSON.parse(validResponseJson());
    parsed.designBrief.contentEmphasis = "testimonials";
    assert.throws(() => parseDesignIntelligenceResponse(JSON.stringify(parsed)), /contentEmphasis must be an array of non-empty strings/);
  });
});

describe("design-intelligence-service: critiqueDesignDirection", () => {
  const pass1: DesignIntelligencePass1Result = parseDesignIntelligenceResponse(validResponseJson());

  test("calls the provider with expectJson and returns a parsed verdict", async () => {
    const requests: LlmMessageRequest[] = [];
    const fakeProvider: LlmProvider = {
      name: "fake:test-model",
      async complete(request) {
        requests.push(request);
        return validCritiqueJson();
      },
    };

    const result = await critiqueDesignDirection(fakeProvider, SAMPLE_INPUT, pass1);
    assert.equal(result.isGeneric, false);
    assert.equal(result.recommendation, null);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].expectJson, true);
    assert.match(requests[0].userPrompt, /Katz's Delicatessen/);
    assert.match(requests[0].userPrompt, /authentic-photography-hero/);
    assert.match(requests[0].systemPrompt, /Name-Swap Test/);
    assert.match(requests[0].systemPrompt, /Human Designer Test/);
  });

  test("parses a generic verdict with a recommendation", async () => {
    const fakeProvider: LlmProvider = {
      name: "fake:test-model",
      async complete() {
        return validCritiqueJson({ isGeneric: true, recommendation: "Ground heroThesis in the real 1888 founding date." });
      },
    };
    const result = await critiqueDesignDirection(fakeProvider, SAMPLE_INPUT, pass1);
    assert.equal(result.isGeneric, true);
    assert.equal(result.recommendation, "Ground heroThesis in the real 1888 founding date.");
  });

  test("rejects a response missing isGeneric", async () => {
    const fakeProvider: LlmProvider = { name: "fake", async complete() { return JSON.stringify({ reasoning: "x", recommendation: null }); } };
    await assert.rejects(
      () => critiqueDesignDirection(fakeProvider, SAMPLE_INPUT, pass1),
      /"isGeneric" must be a boolean/
    );
  });

  test("rejects a response missing violatesContentBoundary", async () => {
    const fakeProvider: LlmProvider = {
      name: "fake",
      async complete() {
        return JSON.stringify({ isGeneric: false, reasoning: "x", recommendation: null });
      },
    };
    await assert.rejects(
      () => critiqueDesignDirection(fakeProvider, SAMPLE_INPUT, pass1),
      /"violatesContentBoundary" must be a boolean/
    );
  });

  test("parses a content-boundary violation independently of isGeneric — the Veslo/Alltech HVAC/Lakeshore regression case", async () => {
    const fakeProvider: LlmProvider = {
      name: "fake:test-model",
      async complete() {
        return validCritiqueJson({
          isGeneric: false,
          violatesContentBoundary: true,
          recommendation: "Rewrite heroThesis as customer-facing copy, not audit commentary about the old site.",
        });
      },
    };
    const result = await critiqueDesignDirection(fakeProvider, SAMPLE_INPUT, pass1);
    assert.equal(result.isGeneric, false);
    assert.equal(result.violatesContentBoundary, true);
  });
});

describe("design-intelligence-service: generateDesignIntelligence (two-pass)", () => {
  test("when Pass 2 does not flag the direction generic, returns Pass 1's output with selfCritique.wasRevised false, using exactly two LLM calls", async () => {
    const requests: LlmMessageRequest[] = [];
    let callCount = 0;
    const fakeProvider: LlmProvider = {
      name: "fake:test-model",
      async complete(request) {
        requests.push(request);
        callCount += 1;
        return callCount === 1 ? validResponseJson() : validCritiqueJson();
      },
    };

    const result = await generateDesignIntelligence(fakeProvider, SAMPLE_INPUT);

    assert.equal(result.designBrief.direction.layoutFamily, "imagery-led");
    assert.equal(result.selfCritique.initiallyFlaggedGeneric, false);
    assert.equal(result.selfCritique.wasRevised, false);
    assert.equal(requests.length, 2);
  });

  test("when Pass 2 flags the direction generic, makes one bounded revision call and returns the revised output", async () => {
    let callCount = 0;
    const fakeProvider: LlmProvider = {
      name: "fake:test-model",
      async complete() {
        callCount += 1;
        if (callCount === 1) return validResponseJson(); // Pass 1, first attempt
        if (callCount === 2) return validCritiqueJson({ isGeneric: true, recommendation: "Be more specific." }); // Pass 2
        return validResponseJson({ designBrief: { heroThesis: "Revised: grounded in the real 1888 founding date and real testimonials." } }); // revision
      },
    };

    const result = await generateDesignIntelligence(fakeProvider, SAMPLE_INPUT);

    assert.equal(callCount, 3);
    assert.equal(result.selfCritique.initiallyFlaggedGeneric, true);
    assert.equal(result.selfCritique.wasRevised, true);
    assert.equal(result.designBrief.heroThesis, "Revised: grounded in the real 1888 founding date and real testimonials.");
  });

  test("when Pass 2 flags a content-boundary violation (not genericity), still makes one bounded revision call — the Veslo/Alltech HVAC/Lakeshore audit-commentary-as-headline regression case", async () => {
    let callCount = 0;
    const fakeProvider: LlmProvider = {
      name: "fake:test-model",
      async complete(request) {
        callCount += 1;
        if (callCount === 1) return validResponseJson({ designBrief: { heroThesis: "This design's entire hero is built to be the fix for the old site's accessibility failures." } });
        if (callCount === 2) {
          return validCritiqueJson({
            isGeneric: false,
            violatesContentBoundary: true,
            recommendation: "heroThesis describes the redesign itself, not the business — rewrite it as customer-facing copy.",
          });
        }
        return validResponseJson({ designBrief: { heroThesis: "Katz's Delicatessen has served the same pastrami recipe since 1888." } }); // revision
      },
    };

    const result = await generateDesignIntelligence(fakeProvider, SAMPLE_INPUT);

    assert.equal(callCount, 3, "a content-boundary violation alone must trigger the same one-bounded-revision path as genericity");
    assert.equal(result.selfCritique.initiallyFlaggedGeneric, false);
    assert.equal(result.selfCritique.initiallyViolatedContentBoundary, true);
    assert.equal(result.selfCritique.wasRevised, true);
    assert.equal(result.designBrief.heroThesis, "Katz's Delicatessen has served the same pastrami recipe since 1888.");
  });

  test("propagates a parse error when Pass 1 returns garbage", async () => {
    const fakeProvider: LlmProvider = {
      name: "fake:test-model",
      async complete() {
        return "I cannot help with that.";
      },
    };

    await assert.rejects(() => generateDesignIntelligence(fakeProvider, SAMPLE_INPUT));
  });
});
