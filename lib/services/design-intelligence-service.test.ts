import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildDesignIntelligencePrompt,
  parseDesignIntelligenceResponse,
  generateDesignIntelligence,
  type DesignIntelligenceInput,
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
};

function validResponseJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    designBrief: {
      targetAudience: "Local diners deciding where to eat tonight.",
      positioning: "Lead with imagery and atmosphere.",
      direction: {
        layoutFamily: "imagery-led",
        typographicMood: "warm serif display",
        colorDirection: "warm natural tones",
        motionIntensity: "restrained",
      },
    },
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

  test("system prompt instructs JSON-only output", () => {
    assert.match(systemPrompt, /ONLY a single JSON object/);
    assert.match(systemPrompt, /no markdown code fences/);
  });

  test("user prompt includes the business's real cited facts", () => {
    assert.match(userPrompt, /Katz's Delicatessen/);
    assert.match(userPrompt, /Pages load slowly\./);
    assert.match(userPrompt, /performance at 25\/100/);
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
    const raw = validResponseJson();
    const parsed = JSON.parse(raw);
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
});

describe("design-intelligence-service: generateDesignIntelligence", () => {
  test("calls the injected provider with expectJson and returns the parsed result", async () => {
    const requests: LlmMessageRequest[] = [];
    const fakeProvider: LlmProvider = {
      name: "fake:test-model",
      async complete(request) {
        requests.push(request);
        return validResponseJson();
      },
    };

    const result = await generateDesignIntelligence(fakeProvider, SAMPLE_INPUT);

    assert.equal(result.designBrief.direction.layoutFamily, "imagery-led");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].expectJson, true);
    assert.match(requests[0].userPrompt, /Katz's Delicatessen/);
  });

  test("propagates a parse error when the provider returns garbage", async () => {
    const fakeProvider: LlmProvider = {
      name: "fake:test-model",
      async complete() {
        return "I cannot help with that.";
      },
    };

    await assert.rejects(() => generateDesignIntelligence(fakeProvider, SAMPLE_INPUT));
  });
});
