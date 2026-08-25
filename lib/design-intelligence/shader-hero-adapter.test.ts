import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { shaderHeroAdapter, type ShaderHeroAdapterInput } from "@/lib/design-intelligence/shader-hero-adapter";

const REAL_PALETTE = { primary: "#1a2b3c", secondary: "#4d5e6f", accent: "#ff8800" };

function inputFor(overrides: Partial<ShaderHeroAdapterInput> = {}): ShaderHeroAdapterInput {
  return { heroHasRealPhoto: false, colorPalette: { ...REAL_PALETTE }, ...overrides };
}

describe("shader-hero-adapter: requirementsMet", () => {
  test("true when the hero has no real photo and a real, complete color palette", () => {
    assert.equal(shaderHeroAdapter.requirementsMet(inputFor()), true);
  });

  test("false when the hero already has a real photograph driving its background — real evidence always wins over decoration", () => {
    assert.equal(shaderHeroAdapter.requirementsMet(inputFor({ heroHasRealPhoto: true })), false);
  });

  test("false when any of the three color roles is missing or empty", () => {
    assert.equal(shaderHeroAdapter.requirementsMet(inputFor({ colorPalette: { secondary: "#000", accent: "#111" } })), false);
    assert.equal(shaderHeroAdapter.requirementsMet(inputFor({ colorPalette: { primary: "", secondary: "#000", accent: "#111" } })), false);
    assert.equal(shaderHeroAdapter.requirementsMet(inputFor({ colorPalette: { primary: "   ", secondary: "#000", accent: "#111" } })), false);
  });
});

describe("shader-hero-adapter: execute", () => {
  test("produces real, sanitized colors matching the real input palette", () => {
    const result = shaderHeroAdapter.execute(inputFor());
    assert.equal(result.status, "active");
    assert.equal(result.token, "shader-enhanced-hero");
    assert.deepEqual(result.payload.colors, REAL_PALETTE);
  });

  test("sanitizes a garbage color value to a safe fallback rather than passing it straight through (toSafeCssColor reuse)", () => {
    const result = shaderHeroAdapter.execute(inputFor({ colorPalette: { primary: "not-a-color", secondary: "#4d5e6f", accent: "#ff8800" } }));
    assert.notEqual(result.payload.colors!.primary, "not-a-color");
    assert.ok(result.payload.colors!.primary.length > 0);
  });
});

describe("shader-hero-adapter: fallback — fail closed", () => {
  test("produces a null-colors payload, correctly classified — the caller treats this identically to 'not granted'", () => {
    const result = shaderHeroAdapter.fallback(inputFor(), "requirements-not-met");
    assert.equal(result.status, "fallback-active");
    assert.equal(result.failureReason, "requirements-not-met");
    assert.equal(result.payload.colors, null);
  });
});

describe("shader-hero-adapter: reducedMotionStrategy and failure classification", () => {
  test("declares gate-initialization — the real enforcement lives in shader-hero-runtime.tsx, which this adapter never touches", () => {
    assert.equal(shaderHeroAdapter.reducedMotionStrategy, "gate-initialization");
  });

  test("possibleFailureReasons is a real, non-empty subset of the closed failure vocabulary", () => {
    assert.ok(shaderHeroAdapter.possibleFailureReasons.length > 0);
    for (const reason of shaderHeroAdapter.possibleFailureReasons) {
      assert.ok(["adapter-not-registered", "requirements-not-met", "runtime-error"].includes(reason));
    }
  });
});

describe("shader-hero-adapter: qaContract — never reports active when a fallback is actually showing", () => {
  test("active execution reports expected === actual === shader-enhanced-hero, status active", () => {
    const result = shaderHeroAdapter.execute(inputFor());
    const qa = shaderHeroAdapter.qaContract(result);
    assert.deepEqual(qa, { expected: "shader-enhanced-hero", actual: "shader-enhanced-hero", status: "active" });
  });

  test("fallback execution reports actual as static-fallback, never the token name, status degraded-but-valid", () => {
    const result = shaderHeroAdapter.fallback(inputFor({ heroHasRealPhoto: true }), "requirements-not-met");
    const qa = shaderHeroAdapter.qaContract(result);
    assert.deepEqual(qa, { expected: "shader-enhanced-hero", actual: "static-fallback", status: "degraded-but-valid" });
  });
});
