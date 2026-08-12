import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveHeroPattern, HERO_PATTERN_VOCABULARY, SECTION_PATTERN_REGISTRY } from "@/lib/design-intelligence/section-patterns";

describe("section-patterns: resolveHeroPattern", () => {
  test("picks image-full-bleed only when layoutFamily is imagery-led/listing-led AND real photography evidence exists", () => {
    assert.equal(resolveHeroPattern("imagery-led", true), "image-full-bleed");
    assert.equal(resolveHeroPattern("listing-led", true), "image-full-bleed");
  });

  test("falls back to editorial-typographic when layoutFamily supports imagery but no real photography evidence exists — never fabricates an image hero", () => {
    assert.equal(resolveHeroPattern("imagery-led", false), "editorial-typographic");
    assert.equal(resolveHeroPattern("listing-led", false), "editorial-typographic");
  });

  test("falls back to editorial-typographic for a non-imagery layoutFamily even when real photography exists — imagery-led is a real reason to prefer an image hero, not just 'any photo exists'", () => {
    assert.equal(resolveHeroPattern("credibility-led", true), "editorial-typographic");
    assert.equal(resolveHeroPattern("editorial", true), "editorial-typographic");
    assert.equal(resolveHeroPattern("schedule-led", true), "editorial-typographic");
    assert.equal(resolveHeroPattern("menu-led", true), "editorial-typographic");
  });

  test("every resolved pattern is a member of the declared vocabulary", () => {
    for (const layoutFamily of ["editorial", "imagery-led", "credibility-led", "schedule-led", "menu-led", "listing-led"] as const) {
      for (const hasRealImagery of [true, false]) {
        assert.ok(HERO_PATTERN_VOCABULARY.includes(resolveHeroPattern(layoutFamily, hasRealImagery)));
      }
    }
  });
});

describe("section-patterns: SECTION_PATTERN_REGISTRY", () => {
  test("every registered category's implemented patterns are a subset of its own declared vocabulary", () => {
    for (const [, entry] of Object.entries(SECTION_PATTERN_REGISTRY)) {
      for (const implementedId of entry.implemented) {
        assert.ok((entry.vocabulary as readonly string[]).includes(implementedId));
      }
    }
  });
});
