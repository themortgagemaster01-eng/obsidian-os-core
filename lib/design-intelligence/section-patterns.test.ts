import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveHeroPattern, HERO_PATTERN_VOCABULARY, SECTION_PATTERN_REGISTRY } from "@/lib/design-intelligence/section-patterns";
import type { IndustryBucket } from "@/lib/design-references/reference-library";

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

describe("section-patterns: resolveHeroPattern (business-type -> visual strategy)", () => {
  test("follows the CTO's own suggested table when real photography exists: restaurant -> Editorial (editorial-typographic) is the top-ranked preference", () => {
    assert.equal(resolveHeroPattern("restaurant", true), "editorial-typographic");
  });

  test("lawFirm prefers Editorial, both with and without real photography — a law firm's top preference never depends on photo evidence", () => {
    assert.equal(resolveHeroPattern("lawFirm", true), "editorial-typographic");
    assert.equal(resolveHeroPattern("lawFirm", false), "editorial-typographic");
  });

  test("homeService (HVAC/contractor) prefers Service/Product (image-full-bleed) only when real photography exists, falling back to Bold Commerce (offset-overlap) otherwise — never Editorial, which isn't in its preference list", () => {
    assert.equal(resolveHeroPattern("homeService", true), "image-full-bleed");
    assert.equal(resolveHeroPattern("homeService", false), "offset-overlap");
  });

  test("luxuryServices prefers Luxury Minimal (oversized-typographic), matching the CTO's 'Professional Services -> Luxury Minimal/Editorial' guidance", () => {
    assert.equal(resolveHeroPattern("luxuryServices", true), "oversized-typographic");
    assert.equal(resolveHeroPattern("luxuryServices", false), "oversized-typographic");
  });

  test("never selects a photo-dependent pattern without real photography, for any industry", () => {
    for (const bucket of ALL_BUCKETS) {
      const pattern = resolveHeroPattern(bucket, false);
      assert.ok(
        !["centered-cinematic", "split-media-text", "image-full-bleed"].includes(pattern),
        `${bucket} selected a photo-dependent pattern (${pattern}) with hasRealImagery: false`
      );
    }
  });

  test("real photography can change the selected pattern for a business whose preference list ranks a photo pattern above a non-photo one", () => {
    const withoutPhoto = resolveHeroPattern("realEstate", false);
    const withPhoto = resolveHeroPattern("realEstate", true);
    assert.notEqual(withoutPhoto, withPhoto);
  });

  test("falls back to the general preference list for an unrecognized bucket rather than throwing", () => {
    // @ts-expect-error deliberately passing a value outside the IndustryBucket union to prove the runtime fallback, not just the type
    assert.equal(resolveHeroPattern("not-a-real-bucket", false), "editorial-typographic");
  });

  test("declares exactly six unique, selectable hero patterns, and every industry/evidence combination resolves to one of them", () => {
    assert.equal(HERO_PATTERN_VOCABULARY.length, 6);
    assert.equal(new Set(HERO_PATTERN_VOCABULARY).size, 6);
    for (const bucket of ALL_BUCKETS) {
      for (const hasRealImagery of [true, false]) {
        assert.ok(HERO_PATTERN_VOCABULARY.includes(resolveHeroPattern(bucket, hasRealImagery)));
      }
    }
  });

  test("every industry's preference list is satisfiable without photography — the function never has to fall through to an undocumented default", () => {
    for (const bucket of ALL_BUCKETS) {
      const pattern = resolveHeroPattern(bucket, false);
      assert.ok(HERO_PATTERN_VOCABULARY.includes(pattern));
    }
  });

  // -------------------------------------------------------------------
  // Phase 5.4 — real regression: three real, different Phase 5.3
  // businesses (a restaurant with a real 20-photo gallery, two
  // "general"-bucket retailers, also with real 20-photo galleries) all
  // converged on the identical hero pattern (editorial-typographic),
  // because the old function only ever excluded a photo-dependent pattern
  // for LACKING photography — it never actively preferred one for HAVING
  // abundant real photography, even for a business whose own top
  // preference (editorial-typographic, non-photo) ranks above a photo
  // pattern it has real evidence for.
  // -------------------------------------------------------------------

  test("omitting galleryCount (2-arg call) is byte-identical to the pre-Phase-5.4 behavior — no regression for any existing caller", () => {
    assert.equal(resolveHeroPattern("restaurant", true), "editorial-typographic");
    assert.equal(resolveHeroPattern("general", true), "editorial-typographic");
  });

  test("a thin gallery (1-2 real photos) is not enough to override the top-ranked non-photo preference — still requires a real photo LIBRARY, not one incidental photo", () => {
    assert.equal(resolveHeroPattern("restaurant", true, 1), "editorial-typographic");
    assert.equal(resolveHeroPattern("restaurant", true, 2), "editorial-typographic");
  });

  test("a real photo library (>=3 real images) promotes this business's own highest-ranked photo-dependent pattern, even when a non-photo pattern is ranked above it", () => {
    // restaurant: ["editorial-typographic", "split-media-text", "centered-cinematic"]
    // — editorial-typographic is non-photo and ranked first, but with a real
    // photo library, split-media-text (its first PHOTO-dependent entry) wins.
    assert.equal(resolveHeroPattern("restaurant", true, 20), "split-media-text");
  });

  test("a restaurant with a real photo library and a general-bucket retailer with a real photo library now select DIFFERENT hero patterns — the actual Phase 5.3 differentiation gap", () => {
    const restaurantPattern = resolveHeroPattern("restaurant", true, 20);
    const generalPattern = resolveHeroPattern("general", true, 20);
    assert.notEqual(restaurantPattern, generalPattern);
    assert.equal(generalPattern, "image-full-bleed");
  });

  test("galleryCount never promotes a photo pattern when hasRealImagery is false — the two signals stay consistent, a caller can't claim a photo library with no real photos", () => {
    assert.equal(resolveHeroPattern("restaurant", false, 20), "editorial-typographic");
  });

  test("galleryCount preference selection remains deterministic — identical inputs always produce identical output, called repeatedly", () => {
    const results = new Set(Array.from({ length: 20 }, () => resolveHeroPattern("restaurant", true, 20)));
    assert.equal(results.size, 1, "must never vary run to run — no randomization");
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
