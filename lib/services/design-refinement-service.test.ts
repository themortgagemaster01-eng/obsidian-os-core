import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  refineTypography,
  refineSpacing,
  refineLayout,
  refineMotion,
  refineMobile,
  refineDesign,
} from "@/lib/services/design-refinement-service";
import { generateWireframe, type Wireframe } from "@/lib/services/design-generation-service";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import { MAX_TYPE_FAMILIES, TYPE_ROLE_ORDER } from "@/lib/design-intelligence/typography-rules";
import { MOTION_DURATION_BAND_MS, BANNED_EASING_KEYWORDS } from "@/lib/design-intelligence/motion-rules";
import { GENERIC_SAAS_TEMPLATE_SECTION_ORDER } from "@/lib/design-intelligence/layout-rules";
import { MIN_TOUCH_TARGET_PX, MOBILE_BODY_FONT_FLOOR_PX } from "@/lib/design-intelligence/mobile-rules";

function briefFor(overrides: Partial<DesignBrief["direction"]> = {}): DesignBrief {
  return {
    missionId: "mission-1",
    businessName: "Acme Co",
    websiteUrl: "https://acme.test",
    industry: null,
    industryBucket: "general",
    citedInsights: [],
    targetAudience: "Test audience",
    positioning: "Test positioning",
    direction: {
      layoutFamily: "editorial",
      typographicMood: "test mood",
      colorDirection: "test color direction",
      motionIntensity: "restrained",
      ...overrides,
    },
    referencesConsidered: [],
  };
}

function wireframeFor(bucket: "general" | "restaurant" | "lawFirm" = "general"): Wireframe {
  return generateWireframe(briefFor(), { hasRealTestimonials: false });
}

const SAMPLE_DESIGN_MEMORY: DesignMemory = {
  typography: { headingFamily: "Playfair Display", bodyFamily: "Inter", scaleNotes: "test notes" },
  colorPalette: { primary: "#111", secondary: "#222", accent: "#333", neutral: "#eee", notes: "" },
  spacingScale: { baseUnit: "8px", notes: "" },
  grid: { columns: 12, notes: "" },
  borderRadius: "4px",
  shadows: "subtle",
  icons: "line icons",
  photographyStyle: "warm",
  motionLevel: "restrained",
  ctaHierarchy: { primary: "Book now", secondary: "Learn more" },
  componentVariants: [],
  brandPersonality: [],
  accessibilityTargets: "WCAG AA",
  seoPriorities: [],
  contentTone: "warm",
  preferredLayouts: [],
};

describe("design-refinement-service: refineTypography", () => {
  test("derives a valid, ordered scale with no violations when Design Memory names two distinct families", () => {
    const result = refineTypography(SAMPLE_DESIGN_MEMORY);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.families, ["Playfair Display", "Inter"]);
    assert.equal(result.scale.length, TYPE_ROLE_ORDER.length);
  });

  test("scale sizes strictly follow TYPE_ROLE_ORDER's descending contrast", () => {
    const result = refineTypography(SAMPLE_DESIGN_MEMORY);
    const byRole = new Map(result.scale.map((s) => [s.role, s.sizePx]));
    for (let i = 0; i < TYPE_ROLE_ORDER.length - 1; i++) {
      const current = byRole.get(TYPE_ROLE_ORDER[i])!;
      const next = byRole.get(TYPE_ROLE_ORDER[i + 1])!;
      assert.ok(current >= next, `${TYPE_ROLE_ORDER[i]} (${current}) should be >= ${TYPE_ROLE_ORDER[i + 1]} (${next})`);
    }
  });

  test("falls back to a safe default family and records a violation when Design Memory is absent", () => {
    const result = refineTypography(undefined);
    assert.equal(result.families.length, 1);
    assert.ok(result.violations.some((v) => /defaulted to a system font stack/.test(v)));
  });

  test("two distinct heading/body families never trip the MAX_TYPE_FAMILIES cap", () => {
    // DesignMemory.typography only ever supplies headingFamily/bodyFamily
    // (at most 2 distinct names), so the cap branch in refineTypography is
    // unreachable through this input today by construction — this test
    // documents that boundary rather than exercising the cap directly.
    // The cap itself stays in as a defensive check against a future
    // DesignMemory schema change (e.g. a third accent family field) rather
    // than dead code removed for lack of a current caller.
    const memory: DesignMemory = {
      ...SAMPLE_DESIGN_MEMORY,
      typography: { headingFamily: "Family A", bodyFamily: "Family B", scaleNotes: "" },
    };
    const result = refineTypography(memory);
    assert.equal(result.families.length, 2);
    assert.ok(result.families.length <= MAX_TYPE_FAMILIES);
    assert.deepEqual(result.violations, []);
  });

  test("dedupes identical heading/body family names into one family", () => {
    const memory: DesignMemory = {
      ...SAMPLE_DESIGN_MEMORY,
      typography: { headingFamily: "Inter", bodyFamily: "Inter", scaleNotes: "" },
    };
    const result = refineTypography(memory);
    assert.deepEqual(result.families, ["Inter"]);
  });

  test("body line length and line height fall within READABILITY's band", () => {
    const result = refineTypography(SAMPLE_DESIGN_MEMORY);
    assert.ok(result.bodyLineLengthChars >= 45 && result.bodyLineLengthChars <= 75);
    assert.ok(result.bodyLineHeight >= 1.4 && result.bodyLineHeight <= 1.6);
  });
});

describe("design-refinement-service: refineSpacing", () => {
  test("produces one spacing value per wireframe section, every value a member of the scale", () => {
    const wireframe = wireframeFor();
    const result = refineSpacing(wireframe);
    assert.deepEqual(result.violations, []);
    assert.equal(result.sectionSpacing.length, wireframe.sections.length);
    for (const s of result.sectionSpacing) {
      assert.ok(result.scale.steps.includes(s.sectionPaddingRem));
      assert.ok(result.scale.steps.includes(s.componentPaddingRem));
    }
  });

  test("hero's spacing is larger than footer's, at both the section and component level", () => {
    const wireframe = wireframeFor();
    const result = refineSpacing(wireframe);
    const hero = result.sectionSpacing.find((s) => s.section === "hero")!;
    const footer = result.sectionSpacing.find((s) => s.section === "footer")!;
    assert.ok(hero.sectionPaddingRem > footer.sectionPaddingRem);
    assert.ok(hero.componentPaddingRem > footer.componentPaddingRem);
  });

  test("every non-hero, non-footer section is classified as content role", () => {
    const wireframe = wireframeFor();
    const result = refineSpacing(wireframe);
    for (const s of result.sectionSpacing) {
      if (s.section !== "hero" && s.section !== "footer") {
        assert.equal(s.role, "content");
      }
    }
  });
});

describe("design-refinement-service: refineLayout", () => {
  test("a real generated wireframe never matches the generic template and always leads with hero", () => {
    const wireframe = wireframeFor();
    const result = refineLayout(wireframe);
    assert.equal(result.matchesGenericTemplate, false);
    assert.equal(result.leadsWithHero, true);
    assert.deepEqual(result.violations, []);
  });

  test("flags a wireframe that matches the banned generic-SaaS pattern", () => {
    const genericWireframe: Wireframe = {
      layoutFamily: "editorial",
      sections: GENERIC_SAAS_TEMPLATE_SECTION_ORDER.map((type) => ({
        type: type as Wireframe["sections"][number]["type"],
        rationale: "test",
      })),
    };
    const result = refineLayout(genericWireframe);
    assert.equal(result.matchesGenericTemplate, true);
    assert.ok(result.violations.some((v) => /banned generic-SaaS/.test(v)));
  });

  test("flags a wireframe that does not lead with a hero", () => {
    const wireframe = wireframeFor();
    const withoutHeroFirst: Wireframe = { ...wireframe, sections: [...wireframe.sections].reverse() };
    const result = refineLayout(withoutHeroFirst);
    assert.equal(result.leadsWithHero, false);
    assert.ok(result.violations.some((v) => /obvious first landing point/.test(v)));
  });
});

describe("design-refinement-service: refineMotion", () => {
  test("every animated section passes validateMotionChoice with no violations at restrained intensity", () => {
    const wireframe = wireframeFor();
    const result = refineMotion(wireframe, "restrained");
    assert.deepEqual(result.violations, []);
    for (const motion of result.motions) {
      assert.ok(motion.durationMs >= MOTION_DURATION_BAND_MS.min && motion.durationMs <= MOTION_DURATION_BAND_MS.max);
      assert.ok(!BANNED_EASING_KEYWORDS.some((k) => motion.easing.includes(k)));
      assert.ok(motion.purpose.trim().length > 0);
    }
  });

  test("footer never receives a motion assignment", () => {
    const wireframe = wireframeFor();
    const result = refineMotion(wireframe, "restrained");
    assert.ok(!result.motions.some((m) => m.section === "footer"));
  });

  test("energetic intensity exceeds the default band but discloses a deliberate deviation, producing no violations", () => {
    const wireframe = wireframeFor();
    const result = refineMotion(wireframe, "energetic");
    assert.ok(result.motions.every((m) => m.durationMs > MOTION_DURATION_BAND_MS.max));
    assert.ok(result.motions.every((m) => m.deliberateDeviation === true));
    assert.deepEqual(result.violations, []);
  });

  test("hero's motion purpose describes a load-time reveal, not a scroll entrance", () => {
    const wireframe = wireframeFor();
    const result = refineMotion(wireframe, "restrained");
    const hero = result.motions.find((m) => m.section === "hero")!;
    assert.match(hero.purpose, /page load/);
  });
});

describe("design-refinement-service: refineMobile", () => {
  test("every touch target meets the minimum size and spacing, with no violations", () => {
    const wireframe = wireframeFor();
    const typography = refineTypography(SAMPLE_DESIGN_MEMORY);
    const result = refineMobile(wireframe, typography);
    assert.deepEqual(result.violations, []);
    for (const target of result.touchTargets) {
      assert.ok(target.widthPx >= MIN_TOUCH_TARGET_PX);
      assert.ok(target.heightPx >= MIN_TOUCH_TARGET_PX);
    }
  });

  test("body font size never falls below the mobile readable floor even if typography's own size were smaller", () => {
    const wireframe = wireframeFor();
    const shrunkTypography = refineTypography(SAMPLE_DESIGN_MEMORY);
    shrunkTypography.scale = shrunkTypography.scale.map((s) => (s.role === "body" ? { ...s, sizePx: 10 } : s));
    const result = refineMobile(wireframe, shrunkTypography);
    assert.ok(result.bodyFontSizePx >= MOBILE_BODY_FONT_FLOOR_PX);
  });

  test("body line length is re-clamped into the mobile-scale band, not naively copied from desktop", () => {
    const wireframe = wireframeFor();
    const typography = refineTypography(SAMPLE_DESIGN_MEMORY);
    assert.ok(typography.bodyLineLengthChars > 60, "sanity check: desktop default exceeds the mobile max");
    const result = refineMobile(wireframe, typography);
    assert.ok(result.bodyLineLengthChars <= 60);
  });

  test("singleColumnVerified is always true, per this data model's structural guarantee", () => {
    const wireframe = wireframeFor();
    const typography = refineTypography(SAMPLE_DESIGN_MEMORY);
    const result = refineMobile(wireframe, typography);
    assert.equal(result.singleColumnVerified, true);
  });
});

describe("design-refinement-service: refineDesign (composition)", () => {
  test("composes all five passes and flattens their violations", () => {
    const wireframe = wireframeFor();
    const structure = { wireframe, components: [] };
    const brief = briefFor();
    const result = refineDesign(structure, brief, SAMPLE_DESIGN_MEMORY);

    assert.deepEqual(result.violations, []);
    assert.ok(result.typography);
    assert.ok(result.spacing);
    assert.ok(result.layout);
    assert.ok(result.motion);
    assert.ok(result.mobile);
  });

  test("works with no Design Memory at all (defensive default, not a throw)", () => {
    const wireframe = wireframeFor();
    const structure = { wireframe, components: [] };
    const brief = briefFor();
    const result = refineDesign(structure, brief, null);
    assert.equal(result.typography.families.length, 1);
  });

  test("motion intensity in the composed result matches the brief's direction", () => {
    const wireframe = wireframeFor();
    const structure = { wireframe, components: [] };
    const brief = briefFor({ motionIntensity: "energetic" });
    const result = refineDesign(structure, brief, SAMPLE_DESIGN_MEMORY);
    assert.equal(result.motion.intensity, "energetic");
  });
});
