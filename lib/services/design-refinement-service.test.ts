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
    contactEvidence: { phones: [], emails: [], address: null, hours: null },
    targetAudience: "Test audience",
    positioning: "Test positioning",
    direction: {
      layoutFamily: "editorial",
      typographicMood: "test mood",
      colorDirection: "test color direction",
      motionIntensity: "restrained",
      ...overrides,
    },
    heroThesis: "Test hero thesis.",
    signatureElement: { element: "service-list-editorial-treatment", justification: "Test justification." },
    contentEmphasis: [],
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
      signatureElement: { element: "service-list-editorial-treatment", justification: "Test justification." },
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

/**
 * Phase 6.2 fixture builder — mirrors experience-planner.test.ts's own
 * fixture recipes (services/certifications/hasReviews/galleryCount/
 * hasRealTeam, industryBucket, motionIntensity) so refineMotion's real
 * behavior across all four motion-budget tiers can be exercised
 * deterministically, the same way Phase 6.1 proved its own four business
 * profiles. Deliberately a LOCAL helper (not a change to the shared
 * briefFor/wireframeFor above, which several other passing describe blocks
 * in this file already depend on) — zero risk to any test outside this
 * describe block.
 */
function experienceWireframeFor(
  industryBucket: DesignBrief["industryBucket"],
  motionIntensity: "restrained" | "energetic",
  options: {
    hasRealImagery?: boolean;
    hasRealTeam?: boolean;
    compositionEvidence?: { services?: number; certifications?: number; hasReviews?: boolean; galleryCount?: number };
  } = {}
): Wireframe {
  const brief: DesignBrief = { ...briefFor({ motionIntensity }), industryBucket };
  return generateWireframe(brief, {
    hasRealTestimonials: false,
    hasRealTeam: options.hasRealTeam,
    hasRealImagery: options.hasRealImagery,
    compositionEvidence: options.compositionEvidence,
  });
}

describe("design-refinement-service: refineMotion — legacy path (wireframe predates ExperiencePlan)", () => {
  /** Strips experiencePlan off a real generated wireframe — reproduces exactly the shape a `website_designs.wireframe` row persisted before Phase 6.1 would have, without hand-rolling a second wireframe shape. */
  function legacyWireframe(): Wireframe {
    const { experiencePlan: _experiencePlan, ...rest } = wireframeFor();
    return rest;
  }

  test("every animated section passes validateMotionChoice with no violations at restrained intensity", () => {
    const result = refineMotion(legacyWireframe(), "restrained");
    assert.deepEqual(result.violations, []);
    assert.ok(result.motions.length > 0, "the legacy path must still produce real motion entries, unlike the ExperiencePlan-driven path's honest 'none' budget");
    for (const motion of result.motions) {
      assert.ok(motion.durationMs >= MOTION_DURATION_BAND_MS.min && motion.durationMs <= MOTION_DURATION_BAND_MS.max);
      assert.ok(!BANNED_EASING_KEYWORDS.some((k) => motion.easing.includes(k)));
      assert.ok(motion.purpose.trim().length > 0);
      assert.equal(motion.revealStyle, "fade");
      assert.equal(motion.translateYPx, 12);
      assert.equal(motion.delayMs, 0);
    }
  });

  test("footer never receives a motion assignment", () => {
    const result = refineMotion(legacyWireframe(), "restrained");
    assert.ok(!result.motions.some((m) => m.section === "footer"));
  });

  test("energetic intensity exceeds the default band but discloses a deliberate deviation, producing no violations", () => {
    const result = refineMotion(legacyWireframe(), "energetic");
    assert.ok(result.motions.length > 0);
    assert.ok(result.motions.every((m) => m.durationMs > MOTION_DURATION_BAND_MS.max));
    assert.ok(result.motions.every((m) => m.deliberateDeviation === true));
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.hover, []);
  });

  test("hero's motion purpose describes a load-time reveal, not a scroll entrance", () => {
    const result = refineMotion(legacyWireframe(), "restrained");
    const hero = result.motions.find((m) => m.section === "hero")!;
    assert.match(hero.purpose, /page load/);
  });
});

describe("design-refinement-service: refineMotion — Phase 6.2 Experience Runtime (motion budget as hard ceiling)", () => {
  test('motion budget "none" (sparse local business) produces zero motion entries and zero hover entries — not merely "less" motion', () => {
    const wireframe = experienceWireframeFor("general", "restrained");
    assert.equal(wireframe.experiencePlan?.motionBudget, "none");
    const result = refineMotion(wireframe, "restrained");
    assert.deepEqual(result.motions, []);
    assert.deepEqual(result.hover, []);
    assert.deepEqual(result.violations, []);
    assert.equal(result.motionBudget, "none");
  });

  test('motion budget "subtle" (professional services / trust-authority) stays within the default duration band, with zero stagger and zero hover', () => {
    const wireframe = experienceWireframeFor("lawFirm", "restrained", { hasRealTeam: true });
    assert.equal(wireframe.experiencePlan?.mode, "trust-authority");
    assert.equal(wireframe.experiencePlan?.motionBudget, "subtle");
    const result = refineMotion(wireframe, "restrained");
    assert.ok(result.motions.length > 0);
    for (const motion of result.motions) {
      assert.ok(motion.durationMs >= MOTION_DURATION_BAND_MS.min && motion.durationMs <= MOTION_DURATION_BAND_MS.max);
      assert.equal(motion.deliberateDeviation, false);
      assert.equal(motion.delayMs, 0);
      assert.equal(motion.revealStyle, "fade");
    }
    assert.deepEqual(result.hover, []);
    assert.deepEqual(result.violations, []);
  });

  test('trust-authority stays capped at "subtle" render behavior even when this business\'s own evidence is rich enough to justify more — the mode ceiling governs, not evidence richness', () => {
    const wireframe = experienceWireframeFor("lawFirm", "energetic", {
      hasRealTeam: true,
      compositionEvidence: { certifications: 3, hasReviews: true, services: 5 },
    });
    assert.equal(wireframe.experiencePlan?.mode, "trust-authority");
    assert.equal(wireframe.experiencePlan?.motionBudget, "subtle");
    const result = refineMotion(wireframe, "energetic");
    assert.ok(result.motions.every((m) => m.durationMs <= MOTION_DURATION_BAND_MS.max));
    assert.ok(result.motions.every((m) => m.deliberateDeviation === false));
    assert.deepEqual(result.hover, [], "trust-authority never gets hover intensity, regardless of budget");
  });

  test('motion budget "enhanced" (high-energy-retail) exceeds the default band, staggers section entrances, and adds hover intensity to interactive sections only', () => {
    const wireframe = experienceWireframeFor("homeService", "energetic", {
      hasRealImagery: true,
      compositionEvidence: { galleryCount: 6, services: 5 },
    });
    assert.equal(wireframe.experiencePlan?.mode, "high-energy-retail");
    assert.equal(wireframe.experiencePlan?.motionBudget, "enhanced");
    const result = refineMotion(wireframe, "energetic");
    assert.deepEqual(result.violations, []);
    assert.ok(result.motions.every((m) => m.durationMs > MOTION_DURATION_BAND_MS.max));
    assert.ok(result.motions.every((m) => m.deliberateDeviation === true));
    // Stagger: strictly increasing delay in section order, first section at 0.
    const delays = result.motions.map((m) => m.delayMs);
    assert.equal(delays[0], 0);
    for (let i = 1; i < delays.length; i++) assert.ok(delays[i]! > delays[i - 1]!);
    // Hover only for sections that are both interactive AND actually rendered.
    assert.ok(result.hover.length > 0);
    for (const h of result.hover) {
      assert.ok(h.scale > 1);
      assert.ok(h.purpose.trim().length > 0);
    }
    const heroHover = result.hover.find((h) => h.section === "hero");
    assert.ok(heroHover, "hero carries the primary CTA and should get hover intensity under high-energy-retail");
  });

  test('motion budget "cinematic" (photography-rich restaurant) uses the strongest permitted duration/stagger, and reserves "fade-scale" for photography-backed sections only', () => {
    const wireframe = experienceWireframeFor("restaurant", "energetic", {
      hasRealImagery: true,
      compositionEvidence: { galleryCount: 8, services: 4, hasReviews: true },
    });
    assert.equal(wireframe.experiencePlan?.mode, "cinematic-storytelling");
    assert.equal(wireframe.experiencePlan?.motionBudget, "cinematic");
    const result = refineMotion(wireframe, "energetic");
    assert.deepEqual(result.violations, []);

    const hero = result.motions.find((m) => m.section === "hero")!;
    const gallery = result.motions.find((m) => m.section === "gallery")!;
    assert.equal(hero.revealStyle, "fade-scale");
    assert.equal(gallery.revealStyle, "fade-scale");

    // No other real section (menu/credibility/contact) invents a photography-led treatment it has no evidence for.
    for (const m of result.motions) {
      if (m.section !== "hero" && m.section !== "gallery") assert.equal(m.revealStyle, "fade");
    }

    // high-energy-retail-only hover intensity must never leak into a different mode.
    assert.deepEqual(result.hover, []);
  });

  test("cinematic budget produces a strictly longer duration and larger stagger step than enhanced, which is strictly longer/larger than subtle", () => {
    const subtle = refineMotion(experienceWireframeFor("lawFirm", "restrained", { hasRealTeam: true }), "restrained");
    const enhanced = refineMotion(
      experienceWireframeFor("homeService", "energetic", { hasRealImagery: true, compositionEvidence: { galleryCount: 6, services: 5 } }),
      "energetic"
    );
    const cinematic = refineMotion(
      experienceWireframeFor("restaurant", "energetic", { hasRealImagery: true, compositionEvidence: { galleryCount: 8, services: 4, hasReviews: true } }),
      "energetic"
    );
    assert.ok(subtle.motions[0]!.durationMs < enhanced.motions[0]!.durationMs);
    assert.ok(enhanced.motions[0]!.durationMs < cinematic.motions[0]!.durationMs);
    assert.ok(subtle.motions[0]!.translateYPx! < enhanced.motions[0]!.translateYPx!);
    assert.ok(enhanced.motions[0]!.translateYPx! < cinematic.motions[0]!.translateYPx!);
  });

  test("defensively downgrades to subtle, with a real violation, when an inconsistent ExperiencePlan claims an elevated budget without a matching disclosed motionIntensity", () => {
    const wireframe = experienceWireframeFor("restaurant", "energetic", {
      hasRealImagery: true,
      compositionEvidence: { galleryCount: 8, services: 4, hasReviews: true },
    });
    assert.equal(wireframe.experiencePlan?.motionBudget, "cinematic");
    // A real pipeline call always passes the SAME motionIntensity the brief
    // used to build this wireframe's own experiencePlan — this test
    // deliberately passes a different, inconsistent one to prove the
    // defensive downgrade, not a scenario the real pipeline can reach.
    const result = refineMotion(wireframe, "restrained");
    assert.equal(result.motionBudget, "subtle");
    assert.ok(result.motions.every((m) => m.durationMs <= MOTION_DURATION_BAND_MS.max));
    assert.ok(result.violations.some((v) => /downgraded to "subtle"/.test(v)));
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
