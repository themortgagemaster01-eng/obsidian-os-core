import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveShaderHeroThroughCapabilities } from "@/lib/design-intelligence/capability-hero-execution";
import type { ExperiencePlan } from "@/shared/design-intelligence/types";

const REAL_PALETTE = { primary: "#1a2b3c", secondary: "#4d5e6f", accent: "#ff8800" };

function planFor(mode: ExperiencePlan["mode"], motionBudget: ExperiencePlan["motionBudget"]): ExperiencePlan {
  return { mode, motionBudget, rationale: "test rationale" };
}

describe("capability-hero-execution: resolveShaderHeroThroughCapabilities — no ExperiencePlan (legacy wireframe)", () => {
  test("never consults the capability layer — colors null, capabilityDecisions empty", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: undefined,
      heroHasRealPhoto: false,
      colorPalette: REAL_PALETTE,
    });
    assert.equal(result.colors, null);
    assert.deepEqual(result.capabilityDecisions, []);
  });
});

describe("capability-hero-execution: resolveShaderHeroThroughCapabilities — granted, real execution", () => {
  test("an eligible cinematic-storytelling business with no real hero photo and a real palette gets real shader colors", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("cinematic-storytelling", "cinematic"),
      heroHasRealPhoto: false,
      colorPalette: REAL_PALETTE,
    });
    assert.deepEqual(result.colors, REAL_PALETTE);
    const decision = result.capabilityDecisions.find((d) => d.token === "shader-enhanced-hero")!;
    assert.equal(decision.granted, true);
  });

  test("an eligible high-energy-retail business at enhanced budget also gets real shader colors", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("high-energy-retail", "enhanced"),
      heroHasRealPhoto: false,
      colorPalette: REAL_PALETTE,
    });
    assert.deepEqual(result.colors, REAL_PALETTE);
  });
});

describe("capability-hero-execution: resolveShaderHeroThroughCapabilities — denied cases, all converge on colors: null", () => {
  test("trust-authority is denied", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("trust-authority", "subtle"),
      heroHasRealPhoto: false,
      colorPalette: REAL_PALETTE,
    });
    assert.equal(result.colors, null);
    assert.equal(result.capabilityDecisions.find((d) => d.token === "shader-enhanced-hero")!.granted, false);
  });

  test("editorial-storytelling is denied even at enhanced budget", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("editorial-storytelling", "enhanced"),
      heroHasRealPhoto: false,
      colorPalette: REAL_PALETTE,
    });
    assert.equal(result.colors, null);
  });

  test("warm-local-business is denied even at enhanced budget", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("warm-local-business", "enhanced"),
      heroHasRealPhoto: false,
      colorPalette: REAL_PALETTE,
    });
    assert.equal(result.colors, null);
  });

  test("a zero-motion sparse experience is denied", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("cinematic-storytelling", "none"),
      heroHasRealPhoto: false,
      colorPalette: REAL_PALETTE,
    });
    assert.equal(result.colors, null);
  });
});

describe("capability-hero-execution: resolveShaderHeroThroughCapabilities — fail closed at the execution/requirements layer, distinct from selector denial", () => {
  test("granted by the Selector but the hero already has a real photo: requirementsMet fails, colors null — same observable outcome as a Selector denial, from the renderer's point of view", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("cinematic-storytelling", "cinematic"),
      heroHasRealPhoto: true,
      colorPalette: REAL_PALETTE,
    });
    assert.equal(result.colors, null);
    // The Selector's own decision is still reported as granted — real,
    // honest observability: the Selector's business-only reasoning correctly
    // said yes; it was the execution-layer photo precondition that said no.
    assert.equal(result.capabilityDecisions.find((d) => d.token === "shader-enhanced-hero")!.granted, true);
  });

  test("granted, no real photo, but an incomplete color palette: requirementsMet fails, colors null", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("cinematic-storytelling", "cinematic"),
      heroHasRealPhoto: false,
      colorPalette: { primary: "#111111" },
    });
    assert.equal(result.colors, null);
  });

  test("granted, no colorPalette at all (undefined DesignMemory): colors null, never a crash", () => {
    const result = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("cinematic-storytelling", "cinematic"),
      heroHasRealPhoto: false,
      colorPalette: undefined,
    });
    assert.equal(result.colors, null);
  });
});

describe("capability-hero-execution: resolveShaderHeroThroughCapabilities — reuses the same real Selector, no second eligibility rule", () => {
  test("passes brandPersonality/contentTone straight through to the Selector's own restrained-tone check", () => {
    const restrained = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("high-energy-retail", "cinematic"),
      heroHasRealPhoto: false,
      colorPalette: REAL_PALETTE,
      brandPersonality: ["understated", "quiet"],
    });
    assert.equal(restrained.colors, null);

    const bold = resolveShaderHeroThroughCapabilities({
      experiencePlan: planFor("high-energy-retail", "cinematic"),
      heroHasRealPhoto: false,
      colorPalette: REAL_PALETTE,
      brandPersonality: ["bold", "energetic"],
    });
    assert.deepEqual(bold.colors, REAL_PALETTE);
  });
});
