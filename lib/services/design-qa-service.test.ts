import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  qaTypography,
  qaSpacing,
  qaLayout,
  qaMotion,
  qaMobileStructured,
  qaTrust,
  qaConversion,
  qaBrandFitStructured,
  qaGenericTemplate,
  qaNarrativeConsistency,
  resolveQaDesignInputs,
  classifyShaderHeroCapabilityOutcome,
  classifyShaderHeroRenderHealth,
  runStructuredDeterministicChecks,
  assembleDesignQaReport,
  type QaStructuredInput,
  type DeterministicCategoryResult,
  type AiDerivedAssessment,
} from "@/lib/services/design-qa-service";
import {
  generateWireframe,
  assembleComponents,
  type ComponentSlot,
  type ComponentNode,
  type Wireframe,
} from "@/lib/services/design-generation-service";
import { refineDesign, type SectionMotionValue } from "@/lib/services/design-refinement-service";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import { GENERIC_SAAS_TEMPLATE_SECTION_ORDER } from "@/lib/design-intelligence/layout-rules";
import type { ExperienceMode, MotionBudget } from "@/shared/design-intelligence/types";
import type { CapabilityDecision } from "@/lib/design-intelligence/capability-selector";
import type { CapabilityExecutionResult, CapabilityQaContract } from "@/lib/design-intelligence/capability-adapter";
import type { ShaderHeroPayload } from "@/lib/design-intelligence/shader-hero-adapter";
import type { HeroPatternId } from "@/lib/design-intelligence/section-patterns";
import type { ViewportRenderResult } from "@/lib/adapters/rendered-preview-adapter";

function briefFor(overrides: Partial<DesignBrief["direction"]> = {}, briefOverrides: Partial<DesignBrief> = {}): DesignBrief {
  return {
    missionId: "mission-1",
    businessName: "Acme Restaurant",
    websiteUrl: "https://acme.test",
    industry: "restaurant",
    industryBucket: "restaurant",
    citedInsights: [
      { category: "performance", statement: "The homepage loads slowly on mobile connections." },
      { category: "seo", statement: "The homepage is missing a meta description." },
    ],
    contactEvidence: { phones: [], emails: [], address: null, hours: null },
    targetAudience: "Local diners",
    positioning: "A warm, family-run Italian restaurant",
    direction: {
      layoutFamily: "imagery-led",
      typographicMood: "a warm serif paired with a clean sans",
      colorDirection: "warm natural tones",
      motionIntensity: "restrained",
      ...overrides,
    },
    heroThesis: "A warm, family-run Italian restaurant with a real, decades-old recipe book.",
    signatureElement: { element: "authentic-photography-hero", justification: "Real dining-room photography is this business's strongest evidence." },
    contentEmphasis: [],
    referencesConsidered: [],
    ...briefOverrides,
  };
}

const SAMPLE_DESIGN_MEMORY: DesignMemory = {
  typography: { headingFamily: "Playfair Display", bodyFamily: "Inter", scaleNotes: "" },
  colorPalette: { primary: "#111", secondary: "#222", accent: "#333", neutral: "#eee", notes: "" },
  spacingScale: { baseUnit: "8px", notes: "" },
  grid: { columns: 12, notes: "" },
  borderRadius: "4px",
  shadows: "subtle",
  icons: "line icons",
  photographyStyle: "warm",
  motionLevel: "restrained",
  ctaHierarchy: { primary: "Book a table", secondary: "View menu" },
  componentVariants: [],
  brandPersonality: ["warm", "family-run"],
  accessibilityTargets: "WCAG AA",
  seoPriorities: [],
  contentTone: "warm",
  preferredLayouts: [],
};

/** Builds a real, fully-valid QaStructuredInput by running the actual Generation + Refinement pipeline — the same precedent design-refinement-service.test.ts already sets (real pipeline output as fixtures, not a hand-rolled mock of the shape). */
function buildValidInput(overrides: Partial<QaStructuredInput> = {}): QaStructuredInput {
  const brief = briefFor();
  const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
  const components = assembleComponents(wireframe, {
    businessName: brief.businessName,
    citedInsights: brief.citedInsights,
    contactEvidence: brief.contactEvidence,
  });
  const refinedDesign = refineDesign({ wireframe }, brief, SAMPLE_DESIGN_MEMORY);

  const input: QaStructuredInput = {
    missionId: "mission-1",
    websiteDesignId: "design-1",
    businessName: brief.businessName,
    industryBucket: brief.industryBucket,
    wireframe,
    components,
    refinedDesign,
    designBrief: brief,
    designMemory: SAMPLE_DESIGN_MEMORY,
    crawl: null,
    batch: {
      sectionStructures: [{ missionId: "mission-1", sectionOrder: wireframe.sections.map((s) => s.type) }],
      otherTypographyFamilies: [],
      designSignatures: [{ missionId: "mission-1", heroThesis: brief.heroThesis, signatureElement: brief.signatureElement.element }],
    },
    baselineLighthouse: null,
  };
  return { ...input, ...overrides };
}

/**
 * Builds a QaStructuredInput hand-constructed to land on the "sensory"
 * narrative arc (cinematic-storytelling mode) with a real, rendered gallery
 * section assigned the "demonstrate" stage — narrative-arc-planner.ts's
 * ONLY stage override, and therefore the one case qaNarrativeConsistency
 * can mechanically check. evidenceSignals is deliberately 2 (gallery +
 * certifications) to clear NARRATIVE_ARC_EVIDENCE_SIGNAL_FLOOR so the rich
 * "sensory" arc is actually granted rather than downgraded. Starts from
 * buildValidInput()'s own real pipeline output so every OTHER field
 * (typography, spacing, mobile touch targets, etc.) stays realistic, and
 * only wireframe/components/refinedDesign/designBrief are overridden to
 * construct this specific narrative/motion scenario.
 */
function buildSensoryGalleryInput(galleryRevealStyle: SectionMotionValue["revealStyle"]): QaStructuredInput {
  const base = buildValidInput();

  const wireframe: Wireframe = {
    ...base.wireframe,
    sections: [
      { type: "hero", rationale: "hero" },
      { type: "gallery", rationale: "gallery" },
      { type: "contact", rationale: "contact" },
      { type: "footer", rationale: "footer" },
    ],
    experiencePlan: { mode: "cinematic-storytelling", motionBudget: "enhanced", rationale: "test fixture: forced sensory arc" },
  };

  const components: ComponentNode[] = [
    ...base.components.filter((c) => c.section === "hero" || c.section === "contact" || c.section === "footer"),
    { section: "gallery", componentKind: "gallery-grid", slots: [{ name: "photo-1", source: "real", value: "https://acme.test/photo1.jpg" }] },
  ];

  const motions: SectionMotionValue[] = [
    { section: "hero", durationMs: 400, easing: "ease-out", purpose: "entrance", revealStyle: "fade-scale" },
    { section: "gallery", durationMs: 400, easing: "ease-out", purpose: "entrance", revealStyle: galleryRevealStyle },
  ];

  return {
    ...base,
    wireframe,
    components,
    refinedDesign: {
      ...base.refinedDesign,
      motion: { ...base.refinedDesign.motion, motionBudget: "enhanced", motions },
    },
    designBrief: { ...base.designBrief, gallery: [{ src: "a", alt: null, sourceUrl: "a" }, { src: "b", alt: null, sourceUrl: "b" }, { src: "c", alt: null, sourceUrl: "c" }], certifications: [{ heading: "Certified", excerpt: "x", sourceUrl: "x" }] },
  };
}

describe("design-qa-service: qaTypography", () => {
  test("PASS for a real generated design with no violations", () => {
    const result = qaTypography(buildValidInput());
    assert.equal(result.verdict, "PASS");
    assert.equal(result.evidenceSource, "structured");
    assert.equal(result.confidence, "High");
  });

  test("WARNs when the batch shows an identical type pairing already in use", () => {
    const input = buildValidInput();
    const result = qaTypography({
      ...input,
      batch: { ...input.batch, otherTypographyFamilies: [[...input.refinedDesign.typography.families]] },
    });
    assert.equal(result.verdict, "WARN");
    assert.ok(result.findings.some((f) => /quietly becoming a default/.test(f)));
  });
});

describe("design-qa-service: qaSpacing", () => {
  test("PASS for a real generated design", () => {
    const result = qaSpacing(buildValidInput());
    assert.equal(result.verdict, "PASS");
  });

  test("FAILs when a section's spacing is inconsistent with its role", () => {
    const input = buildValidInput();
    const tampered: QaStructuredInput = {
      ...input,
      refinedDesign: {
        ...input.refinedDesign,
        spacing: {
          ...input.refinedDesign.spacing,
          sectionSpacing: input.refinedDesign.spacing.sectionSpacing.map((s, i) =>
            i === 0 ? { ...s, sectionPaddingRem: 999 } : s
          ),
        },
      },
    };
    const result = qaSpacing(tampered);
    assert.equal(result.verdict, "FAIL");
  });

  test("PASS for a wireframe carrying a real compositionVariant.paddingBiasSteps — a real regression found while verifying the Jane Bond mission's regenerated design: this independent re-check must apply the same bias refineSpacing did, not compare against the unbiased default", () => {
    const brief = briefFor(undefined, { industryBucket: "luxuryServices" });
    const wireframe = generateWireframe(brief, {
      hasRealTestimonials: false,
      brandPersonality: ["unpretentious", "quiet"],
    });
    assert.notEqual(wireframe.compositionVariant?.paddingBiasSteps, 0, "fixture should actually exercise a non-zero bias");
    const refinedDesign = refineDesign({ wireframe }, brief, SAMPLE_DESIGN_MEMORY);
    const input = buildValidInput({ wireframe, refinedDesign });
    const result = qaSpacing(input);
    assert.equal(result.verdict, "PASS");
  });
});

describe("design-qa-service: qaLayout", () => {
  test("PASS for a real generated design", () => {
    const result = qaLayout(buildValidInput());
    assert.equal(result.verdict, "PASS");
  });

  test("FAILs a wireframe matching the exact banned generic-SaaS pattern", () => {
    const input = buildValidInput();
    const generic: QaStructuredInput = {
      ...input,
      wireframe: {
        ...input.wireframe,
        sections: GENERIC_SAAS_TEMPLATE_SECTION_ORDER.map((type) => ({
          type: type as QaStructuredInput["wireframe"]["sections"][number]["type"],
          rationale: "test",
        })),
      },
    };
    const result = qaLayout(generic);
    assert.equal(result.verdict, "FAIL");
  });

  test("WARNs (not FAILs) when the section structure duplicates another mission in the batch", () => {
    const input = buildValidInput();
    const withDuplicate: QaStructuredInput = {
      ...input,
      batch: {
        ...input.batch,
        sectionStructures: [
          ...input.batch.sectionStructures,
          { missionId: "mission-2", sectionOrder: input.wireframe.sections.map((s) => s.type) },
        ],
      },
    };
    const result = qaLayout(withDuplicate);
    assert.equal(result.verdict, "WARN");
    assert.ok(result.findings.some((f) => /duplicates another mission/.test(f)));
  });

  test("discloses the §5 reference-structure-match gap honestly rather than fabricating a check", () => {
    const result = qaLayout(buildValidInput());
    assert.ok(result.evidence.some((e) => e.source === "§5 reference-structure-match" && /not mechanically checkable/i.test(e.detail)));
  });
});

describe("design-qa-service: qaMotion", () => {
  test("PASS for a real generated design at restrained intensity", () => {
    const result = qaMotion(buildValidInput());
    assert.equal(result.verdict, "PASS");
  });

  test("PASS for a real generated design at energetic intensity (deviation is disclosed and traceable)", () => {
    const brief = briefFor({ motionIntensity: "energetic" });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    const refinedDesign = refineDesign({ wireframe }, brief, SAMPLE_DESIGN_MEMORY);
    const input = buildValidInput({ wireframe, refinedDesign, designBrief: brief });
    const result = qaMotion(input);
    assert.equal(result.verdict, "PASS");
  });

  test("PASS for a real, rich-evidence cinematic-storytelling restaurant (Phase 6.2: elevated motion budget passes cleanly)", () => {
    const brief = briefFor({ motionIntensity: "energetic" });
    const wireframe = generateWireframe(brief, {
      hasRealTestimonials: false,
      hasRealImagery: true,
      compositionEvidence: { galleryCount: 8, services: 4, hasReviews: true },
    });
    assert.equal(wireframe.experiencePlan?.mode, "cinematic-storytelling");
    assert.equal(wireframe.experiencePlan?.motionBudget, "cinematic");
    const refinedDesign = refineDesign({ wireframe }, brief, SAMPLE_DESIGN_MEMORY);
    const input = buildValidInput({ wireframe, refinedDesign, designBrief: brief });
    const result = qaMotion(input);
    assert.equal(result.verdict, "PASS");
  });

  test('Phase 6.2: PASS for the default sparse fixture, whose motion budget resolves to "none" — re-verifies the inverted zero-motion coverage check, not just the pre-6.2 always-present-motion check', () => {
    const input = buildValidInput();
    assert.equal(input.refinedDesign.motion.motionBudget, "none");
    assert.deepEqual(input.refinedDesign.motion.motions, []);
    const result = qaMotion(input);
    assert.equal(result.verdict, "PASS");
    assert.ok(result.evidence.some((e) => /motion budget is "none"/.test(e.detail)));
  });

  test('Phase 6.2: FAILs when a motion entry is present but this mission\'s Experience Plan motion budget is "none"', () => {
    const input = buildValidInput();
    assert.equal(input.refinedDesign.motion.motionBudget, "none");
    const contaminated: QaStructuredInput = {
      ...input,
      refinedDesign: {
        ...input.refinedDesign,
        motion: {
          ...input.refinedDesign.motion,
          motions: [
            {
              section: "hero",
              durationMs: 250,
              easing: "ease-out",
              purpose: "test",
              revealStyle: "fade",
              translateYPx: 8,
              delayMs: 0,
            },
          ],
        },
      },
    };
    const result = qaMotion(contaminated);
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.findings.some((f) => /motion budget is "none"/.test(f)));
  });

  test("Phase 6.2: FAILs when hover-intensity entries exist for a mode that isn't high-energy-retail", () => {
    const input = buildValidInput();
    const contaminated: QaStructuredInput = {
      ...input,
      refinedDesign: {
        ...input.refinedDesign,
        motion: {
          ...input.refinedDesign.motion,
          experienceMode: "trust-authority",
          motionBudget: "subtle",
          hover: [{ section: "hero", scale: 1.05, purpose: "test" }],
        },
      },
    };
    const result = qaMotion(contaminated);
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.findings.some((f) => /reserved for that mode/.test(f)));
  });

  test("Phase 6.2: PASS for a real high-energy-retail generated design carrying real hover-intensity entries", () => {
    const brief = briefFor({ motionIntensity: "energetic" }, { industryBucket: "homeService" });
    const wireframe = generateWireframe(brief, {
      hasRealTestimonials: false,
      hasRealImagery: true,
      compositionEvidence: { galleryCount: 6, services: 5 },
    });
    assert.equal(wireframe.experiencePlan?.mode, "high-energy-retail");
    const components = assembleComponents(wireframe, {
      businessName: brief.businessName,
      citedInsights: brief.citedInsights,
      contactEvidence: brief.contactEvidence,
    });
    const refinedDesign = refineDesign({ wireframe }, brief, SAMPLE_DESIGN_MEMORY);
    assert.ok(refinedDesign.motion.hover.length > 0);
    const input = buildValidInput({ wireframe, components, refinedDesign, designBrief: brief });
    const result = qaMotion(input);
    assert.equal(result.verdict, "PASS");
  });
});

/**
 * Builds a QaStructuredInput with full control over the exact inputs
 * `qaShaderHeroCapability` (design-qa-service.ts, Phase 6.9) reads: the
 * resolved ExperiencePlan (mode/motionBudget), the resolved hero pattern,
 * whether a real gallery photo exists, and DesignMemory's color palette/
 * brandPersonality/contentTone. Starts from buildValidInput()'s own real
 * pipeline output so every other field stays realistic.
 */
function buildShaderHeroInput(opts: {
  mode: ExperienceMode;
  motionBudget: MotionBudget;
  heroPattern: HeroPatternId;
  galleryPhoto: boolean;
  colorPalette?: { primary?: string; secondary?: string; accent?: string };
  brandPersonality?: string[];
  contentTone?: string;
}): QaStructuredInput {
  const base = buildValidInput();
  const wireframe: Wireframe = {
    ...base.wireframe,
    experiencePlan: { mode: opts.mode, motionBudget: opts.motionBudget, rationale: "test fixture" },
    compositionVariant: base.wireframe.compositionVariant
      ? { ...base.wireframe.compositionVariant, heroPattern: opts.heroPattern }
      : base.wireframe.compositionVariant,
  };
  return {
    ...base,
    wireframe,
    designBrief: {
      ...base.designBrief,
      gallery: opts.galleryPhoto ? [{ src: "https://acme.test/photo.jpg", alt: null, sourceUrl: "https://acme.test" }] : [],
    },
    designMemory: {
      ...SAMPLE_DESIGN_MEMORY,
      colorPalette: {
        primary: opts.colorPalette?.primary ?? "#111",
        secondary: opts.colorPalette?.secondary ?? "#222",
        accent: opts.colorPalette?.accent ?? "#333",
        neutral: "#eee",
        notes: "",
      },
      brandPersonality: opts.brandPersonality ?? [],
      contentTone: opts.contentTone ?? "",
    },
  };
}

const CAPABILITY_EVIDENCE_SOURCE = "shader-enhanced-hero capability contract (Selector -> Adapter, qaContract())";

function capabilityEvidence(result: DeterministicCategoryResult): string {
  const entry = result.evidence.find((e) => e.source === CAPABILITY_EVIDENCE_SOURCE);
  assert.ok(entry, "expected a shader-enhanced-hero capability evidence entry");
  return entry!.detail;
}

describe("design-qa-service: qaMotion — shader-enhanced-hero capability contract (Phase 6.9)", () => {
  test("1. denied by eligibility (wrong mode) never produces a warning", () => {
    const input = buildShaderHeroInput({ mode: "trust-authority", motionBudget: "subtle", heroPattern: "editorial-typographic", galleryPhoto: false });
    const result = qaMotion(input);
    assert.equal(result.verdict, "PASS");
    assert.ok(/^Denied by the Selector/.test(capabilityEvidence(result)));
  });

  test("2. granted and realized (rich, eligible mode/budget, no competing photo, complete palette)", () => {
    const input = buildShaderHeroInput({
      mode: "cinematic-storytelling",
      motionBudget: "cinematic",
      heroPattern: "editorial-typographic",
      galleryPhoto: false,
    });
    const result = qaMotion(input);
    assert.equal(result.verdict, "PASS");
    assert.ok(/^Granted and realized/.test(capabilityEvidence(result)));
  });

  test("3. granted but the Adapter correctly declines — a real photo already occupies the hero background", () => {
    const input = buildShaderHeroInput({
      mode: "cinematic-storytelling",
      motionBudget: "cinematic",
      heroPattern: "image-full-bleed",
      galleryPhoto: true,
    });
    const result = qaMotion(input);
    // Non-failure/non-warning outcome — a legitimate Adapter fallback is never treated as a defect.
    assert.equal(result.verdict, "PASS");
    const detail = capabilityEvidence(result);
    assert.ok(/correctly declined by the Adapter/.test(detail));
    assert.ok(/real photograph already occupies/.test(detail));
  });

  test("4. granted but the Adapter correctly declines — DesignMemory's color palette is incomplete", () => {
    const input = buildShaderHeroInput({
      mode: "cinematic-storytelling",
      motionBudget: "cinematic",
      heroPattern: "editorial-typographic",
      galleryPhoto: false,
      colorPalette: { secondary: "" },
    });
    const result = qaMotion(input);
    assert.equal(result.verdict, "PASS");
    const detail = capabilityEvidence(result);
    assert.ok(/correctly declined by the Adapter/.test(detail));
    assert.ok(/color palette is incomplete/.test(detail));
  });

  test("5. a genuine Adapter execution failure is classified as a WARN, distinct from a legitimate decline", () => {
    // The real shaderHeroAdapter.execute() (via toSafeCssColor) is deliberately
    // defensive and never throws for any real input — a genuine "runtime-error"
    // cannot be produced by driving the real adapter through realistic fixtures.
    // classifyShaderHeroCapabilityOutcome (the pure classification step) is
    // tested directly here with the exact shape requestCapabilityExecution's
    // own catch-block would produce for a future adapter that could throw.
    const decision: CapabilityDecision = {
      token: "shader-enhanced-hero",
      granted: true,
      supportLevel: "High",
      confidenceScore: 1,
      reason: "Granted: test fixture.",
    };
    const executionResult: CapabilityExecutionResult<ShaderHeroPayload> = {
      token: "shader-enhanced-hero",
      status: "fallback-active",
      failureReason: "runtime-error",
      payload: { colors: null },
    };
    const contract: CapabilityQaContract = { expected: "shader-enhanced-hero", actual: "static-fallback", status: "degraded-but-valid" };

    const outcome = classifyShaderHeroCapabilityOutcome(decision, executionResult, contract, false);
    assert.equal(outcome.warn, true);
    assert.ok(outcome.findings.some((f) => /execution failed unexpectedly/.test(f)));
    assert.ok(!/correctly declined/.test(outcome.findings.join(" ")));
  });

  test("classifyShaderHeroCapabilityOutcome: an active contract never warns, regardless of decision/heroHasRealPhoto", () => {
    const executionResult: CapabilityExecutionResult<ShaderHeroPayload> = {
      token: "shader-enhanced-hero",
      status: "active",
      payload: { colors: { primary: "#111", secondary: "#222", accent: "#333" } },
    };
    const contract: CapabilityQaContract = { expected: "shader-enhanced-hero", actual: "shader-enhanced-hero", status: "active" };
    const outcome = classifyShaderHeroCapabilityOutcome(undefined, executionResult, contract, false);
    assert.equal(outcome.warn, false);
    assert.equal(outcome.findings.length, 0);
  });

  test("6. reduced-motion cannot create a false rendered-capability failure — the check reads only structured data prefers-reduced-motion never touches", () => {
    // No field on QaStructuredInput represents reduced-motion state (it is a
    // client-runtime-only concern, enforced in shader-hero-runtime.tsx before
    // any getContext() call — see capability-adapter.ts's reducedMotionStrategy:
    // "gate-initialization"). The same real "granted and realized" fixture used
    // in test 2 above is re-verified here to still PASS identically.
    const input = buildShaderHeroInput({
      mode: "cinematic-storytelling",
      motionBudget: "cinematic",
      heroPattern: "editorial-typographic",
      galleryPhoto: false,
    });
    const result = qaMotion(input);
    assert.equal(result.verdict, "PASS");
  });

  test("7. founder refinement: the capability contract is evaluated against the REFINED plan, not the stale original", () => {
    const brief = briefFor();
    const originalWireframe: Wireframe = {
      ...generateWireframe(brief, { hasRealTestimonials: false }),
      experiencePlan: { mode: "cinematic-storytelling", motionBudget: "subtle", rationale: "original: below the enhanced floor" },
    };
    const originalRefinedDesign = refineDesign({ wireframe: originalWireframe }, brief, SAMPLE_DESIGN_MEMORY);

    const refinedPlan = { mode: "cinematic-storytelling" as const, motionBudget: "cinematic" as const, rationale: "founder refinement raised the budget" };
    const { wireframe: refinedWireframe, refinedDesign: refinedRefinedDesign } = resolveQaDesignInputs(
      originalWireframe,
      originalRefinedDesign,
      { resolved_plan: refinedPlan as unknown as import("@/lib/supabase/database.types").Json },
      brief,
      SAMPLE_DESIGN_MEMORY
    );

    const originalInput = buildValidInput({ wireframe: originalWireframe, refinedDesign: originalRefinedDesign, designBrief: brief });
    const refinedInput = buildValidInput({ wireframe: refinedWireframe, refinedDesign: refinedRefinedDesign, designBrief: brief });

    const originalDetail = capabilityEvidence(qaMotion(originalInput));
    const refinedDetail = capabilityEvidence(qaMotion(refinedInput));

    assert.ok(/^Denied by the Selector/.test(originalDetail), `expected the stale plan (subtle) to deny; got: ${originalDetail}`);
    assert.notEqual(refinedDetail, originalDetail);
    assert.ok(!/^Denied by the Selector/.test(refinedDetail), `expected the refined plan (cinematic) to no longer be denied; got: ${refinedDetail}`);
  });

  test("8. existing qaMotion behavior (entrance-motion coverage, hover gating) is unchanged by the capability check", () => {
    // Re-verifies the exact pre-existing sparse fixture case from the qaMotion
    // describe block above still behaves identically now that qaMotion also
    // runs the capability cross-check.
    const input = buildValidInput();
    assert.equal(input.refinedDesign.motion.motionBudget, "none");
    const result = qaMotion(input);
    assert.equal(result.verdict, "PASS");
    assert.ok(result.evidence.some((e) => /motion budget is "none"/.test(e.detail)));
  });

  test("9. no false warning is produced merely because a capability was denied by eligibility", () => {
    const input = buildShaderHeroInput({ mode: "premium-minimal", motionBudget: "subtle", heroPattern: "oversized-typographic", galleryPhoto: false });
    const result = qaMotion(input);
    assert.notEqual(result.verdict, "WARN");
    assert.notEqual(result.verdict, "FAIL");
  });
});

/** A minimal, real-shaped ViewportRenderResult — only the fields classifyShaderHeroRenderHealth reads are given real values; the rest are irrelevant filler for this pure function's own tests. */
function buildViewportResult(shaderHero: ViewportRenderResult["shaderHero"]): ViewportRenderResult {
  return { widthPx: 1280, heightPx: 800, horizontalOverflow: false, touchTargets: [], screenshotByteSize: 1000, shaderHero };
}

describe("design-qa-service: classifyShaderHeroRenderHealth (Phase 7 — browser render verification)", () => {
  test("A. shader not expected anywhere (no [data-op-shader-hero] marker) — nothing to verify, never fails (covers outcomes B and C, which are indistinguishable at the DOM level and are not this check's job to tell apart)", () => {
    const outcome = classifyShaderHeroRenderHealth(buildViewportResult(null), buildViewportResult(null), [], []);
    assert.equal(outcome.fail, false);
    assert.equal(outcome.findings.length, 0);
  });

  test("A. shader expected and healthy at both desktop and mobile — PASS, no finding", () => {
    const healthy = { canvasPresent: true, contextLost: false };
    const outcome = classifyShaderHeroRenderHealth(buildViewportResult(healthy), buildViewportResult(healthy), [], []);
    assert.equal(outcome.fail, false);
    assert.equal(outcome.findings.length, 0);
  });

  test("E. shader expected but the canvas never mounted — deterministic FAIL", () => {
    const outcome = classifyShaderHeroRenderHealth(
      buildViewportResult({ canvasPresent: false, contextLost: null }),
      buildViewportResult({ canvasPresent: true, contextLost: false }),
      [],
      []
    );
    assert.equal(outcome.fail, true);
    assert.ok(outcome.findings.some((f) => /genuine client-side initialization failure/.test(f)));
  });

  test("G. canvas present but the WebGL context is lost — deterministic FAIL, distinct wording from a missing canvas", () => {
    const outcome = classifyShaderHeroRenderHealth(
      buildViewportResult({ canvasPresent: true, contextLost: true }),
      buildViewportResult({ canvasPresent: true, contextLost: false }),
      [],
      []
    );
    assert.equal(outcome.fail, true);
    assert.ok(outcome.findings.some((f) => /context is lost/.test(f)));
    assert.ok(!outcome.findings.some((f) => /never mounted/.test(f)));
  });

  test("F. a captured console error while shader-hero was expected — deterministic FAIL under the presence-based attribution rule", () => {
    const healthy = { canvasPresent: true, contextLost: false };
    const outcome = classifyShaderHeroRenderHealth(buildViewportResult(healthy), buildViewportResult(healthy), ["WebGL: INVALID_OPERATION"], []);
    assert.equal(outcome.fail, true);
    assert.ok(outcome.findings.some((f) => /browser console error/.test(f)));
    assert.ok(outcome.findings.some((f) => /presence-based rule/.test(f)));
  });

  test("F. a captured unhandled page error while shader-hero was expected — deterministic FAIL", () => {
    const healthy = { canvasPresent: true, contextLost: false };
    const outcome = classifyShaderHeroRenderHealth(buildViewportResult(healthy), buildViewportResult(healthy), [], ["TypeError: x is not a function"]);
    assert.equal(outcome.fail, true);
    assert.ok(outcome.findings.some((f) => /unhandled page error/.test(f)));
  });

  test("console/page errors captured while shader-hero was NOT expected are never attributed to this check — presence-based scoping, not content-based", () => {
    const outcome = classifyShaderHeroRenderHealth(buildViewportResult(null), buildViewportResult(null), ["some unrelated error"], ["some unrelated page error"]);
    assert.equal(outcome.fail, false);
    assert.equal(outcome.findings.length, 0);
  });

  test("D (documented via reduced-motion's own real shape): a marker present with the canvas absent at every viewport is reported as outcome E by this function — the reduced-motion PASS distinction is established by the one-time real-browser validation suite (page.emulateMediaFeatures), not by this per-mission function, per Robert's own Phase 7 scoping decision", () => {
    const outcome = classifyShaderHeroRenderHealth(
      buildViewportResult({ canvasPresent: false, contextLost: null }),
      buildViewportResult({ canvasPresent: false, contextLost: null }),
      [],
      []
    );
    // Documents the real, current behavior of this function in isolation —
    // a genuinely reduced-motion-emulated session is never fed through this
    // per-mission path, so this shape (marker present, canvas absent, no
    // reduced-motion context) is correctly treated as outcome E here.
    assert.equal(outcome.fail, true);
  });
});

describe("design-qa-service: qaMobileStructured", () => {
  test("PASS for a real generated design, and discloses singleColumnVerified's real basis", () => {
    const result = qaMobileStructured(buildValidInput());
    assert.equal(result.verdict, "PASS");
    assert.ok(result.evidence.some((e) => /data-model construction/.test(e.detail)));
  });
});

describe("design-qa-service: qaTrust", () => {
  test("PASS for a real generated design — no placeholder is ever fabricated by construction", () => {
    const result = qaTrust(buildValidInput());
    assert.equal(result.verdict, "PASS");
    assert.equal(result.confidence, "High");
  });

  test("FAILs (zero tolerance) when a placeholder slot carries a fabricated value", () => {
    const input = buildValidInput();
    const tampered: QaStructuredInput = {
      ...input,
      components: input.components.map((c) =>
        c.section === "hero"
          ? {
              ...c,
              slots: c.slots.map((s): ComponentSlot => (s.name === "headline" ? { ...s, value: "A fabricated headline" } : s)),
            }
          : c
      ),
    };
    const result = qaTrust(tampered);
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.findings.some((f) => /CRITICAL/.test(f) && /fabricated content/.test(f)));
  });

  test("FAILs when a 'real' businessName slot doesn't match the mission's actual business name", () => {
    const input = buildValidInput();
    const tampered: QaStructuredInput = {
      ...input,
      components: input.components.map((c) => ({
        ...c,
        slots: c.slots.map((s): ComponentSlot => (s.name === "businessName" ? { ...s, value: "A Different Business" } : s)),
      })),
    };
    const result = qaTrust(tampered);
    assert.equal(result.verdict, "FAIL");
  });

  test("PASSes for a real 'question-N' slot sourced from crawled FAQ evidence (Evidence Depth investigation regression) — design-generation-service.ts's faq case sources question-N slots exclusively from real crawled FAQ, not citedInsights, so Trust QA must recognize that source too", () => {
    // restaurant (briefFor's default bucket) has no "faq" section in its
    // template — lawFirm's does (design-generation-service.ts's
    // WIREFRAME_TEMPLATE_BY_BUCKET), matching this investigation's real
    // Friedman Grimes case.
    const brief = briefFor({}, { industryBucket: "lawFirm", industry: "law firm" });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    const faqEvidence = [
      {
        heading: "What are the grounds for divorce in Virginia?",
        excerpt: "Virginia recognizes both no-fault and fault-based grounds for divorce.",
        sourceUrl: "https://acme.test/family-law/divorce/",
      },
    ];
    const components = assembleComponents(wireframe, {
      businessName: brief.businessName,
      citedInsights: brief.citedInsights,
      contactEvidence: brief.contactEvidence,
      faqEvidence,
    });
    const refinedDesign = refineDesign({ wireframe }, brief, SAMPLE_DESIGN_MEMORY);
    const input: QaStructuredInput = {
      ...buildValidInput(),
      wireframe,
      components,
      refinedDesign,
      crawl: { certifications: [], testimonials: [], faq: faqEvidence },
    };

    const questionSlot = components.flatMap((c) => c.slots).find((s) => s.name === "question-1");
    assert.ok(questionSlot, "fixture must actually produce a question-1 slot");
    assert.match(questionSlot!.value ?? "", /grounds for divorce/);

    const result = qaTrust(input);
    assert.equal(result.verdict, "PASS");
    assert.ok(!result.findings.some((f) => /question-1/.test(f)));
  });

  test("still FAILs when a 'real' question-N slot traces to neither crawled FAQ content nor a cited Insight — the fix recognizes a new legitimate source, it doesn't turn off the check", () => {
    const brief = briefFor({}, { industryBucket: "lawFirm", industry: "law firm" });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
    const faqEvidence = [
      { heading: "Real question", excerpt: "A real, verbatim crawled answer.", sourceUrl: "https://acme.test/faq/" },
    ];
    const components = assembleComponents(wireframe, {
      businessName: brief.businessName,
      citedInsights: brief.citedInsights,
      contactEvidence: brief.contactEvidence,
      faqEvidence,
    });
    const tamperedComponents = components.map((c) => ({
      ...c,
      slots: c.slots.map((s): ComponentSlot =>
        s.name === "question-1" ? { ...s, value: "A completely fabricated question and answer." } : s
      ),
    }));
    const refinedDesign = refineDesign({ wireframe }, brief, SAMPLE_DESIGN_MEMORY);
    const input: QaStructuredInput = {
      ...buildValidInput(),
      wireframe,
      components: tamperedComponents,
      refinedDesign,
      crawl: { certifications: [], testimonials: [], faq: faqEvidence },
    };

    const result = qaTrust(input);
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.findings.some((f) => /question-1/.test(f) && /does not trace/.test(f)));
  });

  test("PASSes for a real 'testimonial-attribution-N' slot sourced from a crawled testimonial's real heading (Evidence Depth pass) — attribution must trace against crawled headings, not quote excerpts", () => {
    const brief = briefFor({}, { industryBucket: "lawFirm", industry: "law firm" });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: true });
    const components = assembleComponents(wireframe, {
      businessName: brief.businessName,
      citedInsights: brief.citedInsights,
      contactEvidence: brief.contactEvidence,
      realTestimonials: [{ quote: "She was with me through my entire divorce.", attribution: "Carolyn M. Grimes" }],
    });
    const refinedDesign = refineDesign({ wireframe }, brief, SAMPLE_DESIGN_MEMORY);
    const input: QaStructuredInput = {
      ...buildValidInput(),
      wireframe,
      components,
      refinedDesign,
      crawl: {
        certifications: [],
        testimonials: [
          { heading: "Carolyn M. Grimes", excerpt: "She was with me through my entire divorce.", sourceUrl: "https://acme.test/testimonials/" },
        ],
        faq: [],
      },
    };

    const attributionSlot = components.flatMap((c) => c.slots).find((s) => s.name === "testimonial-attribution-1");
    assert.ok(attributionSlot, "fixture must actually produce a testimonial-attribution-1 slot");

    const result = qaTrust(input);
    assert.equal(result.verdict, "PASS");
    assert.ok(!result.findings.some((f) => /testimonial-attribution-1/.test(f)));
  });

  test("FAILs when a 'real' testimonial-attribution-N slot traces to no crawled testimonial heading — a fabricated name is still zero-tolerance", () => {
    const brief = briefFor({}, { industryBucket: "lawFirm", industry: "law firm" });
    const wireframe = generateWireframe(brief, { hasRealTestimonials: true });
    const components = assembleComponents(wireframe, {
      businessName: brief.businessName,
      citedInsights: brief.citedInsights,
      contactEvidence: brief.contactEvidence,
      realTestimonials: [{ quote: "She was with me through my entire divorce.", attribution: "Carolyn M. Grimes" }],
    });
    const tamperedComponents = components.map((c) => ({
      ...c,
      slots: c.slots.map((s): ComponentSlot =>
        s.name === "testimonial-attribution-1" ? { ...s, value: "A Completely Fabricated Name" } : s
      ),
    }));
    const refinedDesign = refineDesign({ wireframe }, brief, SAMPLE_DESIGN_MEMORY);
    const input: QaStructuredInput = {
      ...buildValidInput(),
      wireframe,
      components: tamperedComponents,
      refinedDesign,
      crawl: {
        certifications: [],
        testimonials: [
          { heading: "Carolyn M. Grimes", excerpt: "She was with me through my entire divorce.", sourceUrl: "https://acme.test/testimonials/" },
        ],
        faq: [],
      },
    };

    const result = qaTrust(input);
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.findings.some((f) => /testimonial-attribution-1/.test(f) && /does not trace/.test(f)));
  });
});

describe("design-qa-service: qaConversion", () => {
  test("PASS for a real generated design with hero CTA and contact section", () => {
    const result = qaConversion(buildValidInput());
    assert.equal(result.verdict, "PASS");
  });

  test("FAILs when there is no contact section", () => {
    const input = buildValidInput();
    const withoutContact: QaStructuredInput = {
      ...input,
      wireframe: { ...input.wireframe, sections: input.wireframe.sections.filter((s) => s.type !== "contact") },
      refinedDesign: {
        ...input.refinedDesign,
        mobile: {
          ...input.refinedDesign.mobile,
          touchTargets: input.refinedDesign.mobile.touchTargets.filter((t) => t.name !== "contact-primary-action"),
        },
      },
    };
    const result = qaConversion(withoutContact);
    assert.equal(result.verdict, "FAIL");
  });

  test("still detects duplicate touch-target names — the pre-existing check, unchanged by the Phase 6.8 narrative-aware extension", () => {
    const input = buildValidInput();
    const withDuplicateName: QaStructuredInput = {
      ...input,
      refinedDesign: {
        ...input.refinedDesign,
        mobile: {
          ...input.refinedDesign.mobile,
          touchTargets: [...input.refinedDesign.mobile.touchTargets, { name: "hero-primary-cta", widthPx: 48, heightPx: 48, spacingPx: 12 }],
        },
      },
    };
    const result = qaConversion(withDuplicateName);
    assert.equal(result.verdict, "WARN");
    assert.ok(result.findings.some((f) => /Duplicate touch-target names/.test(f)));
  });

  test("Phase 6.8: narrative-aware extension catches competing conversion pressure a duplicate-name check alone would miss (different names, same pressure)", () => {
    const input = buildValidInput();
    const wireframe: Wireframe = {
      ...input.wireframe,
      sections: [
        { type: "hero", rationale: "hero" },
        { type: "schedule", rationale: "schedule" },
        { type: "contact", rationale: "contact" },
        { type: "footer", rationale: "footer" },
      ],
    };
    const components: ComponentNode[] = [
      ...input.components.filter((c) => c.section === "hero" || c.section === "contact" || c.section === "footer"),
      { section: "schedule", componentKind: "schedule-cta", slots: [{ name: "book-now", source: "real", value: "Book now" }] },
    ];
    const withCompetingCta: QaStructuredInput = {
      ...input,
      wireframe,
      components,
      refinedDesign: {
        ...input.refinedDesign,
        mobile: {
          ...input.refinedDesign.mobile,
          touchTargets: [...input.refinedDesign.mobile.touchTargets, { name: "schedule-book-button", widthPx: 48, heightPx: 48, spacingPx: 12 }],
        },
      },
    };
    const result = qaConversion(withCompetingCta);
    assert.equal(result.verdict, "WARN");
    assert.ok(result.findings.some((f) => /Competing conversion pressure: sections hero, schedule/.test(f)));
  });

  test("no false-positive competing-conversion-pressure finding for a normal hero+contact experience", () => {
    const result = qaConversion(buildValidInput());
    const narrativeEv = result.evidence.find((e) => e.source === "narrative-aware CTA competition (resolveNarrativeArc convert stage)");
    assert.ok(narrativeEv);
    assert.ok(/No competing conversion pressure detected/.test(narrativeEv!.detail));
  });
});

describe("design-qa-service: qaNarrativeConsistency", () => {
  test("PASS for a valid narrative/motion combination (sensory arc, gallery correctly fade-scale for its demonstrate stage)", () => {
    const result = qaNarrativeConsistency(buildSensoryGalleryInput("fade-scale"));
    assert.equal(result.verdict, "PASS");
    assert.equal(result.findings.length, 0);
  });

  test("detects a deliberately inconsistent narrative/motion combination (gallery assigned demonstrate stage but resolved motion is plain fade)", () => {
    const result = qaNarrativeConsistency(buildSensoryGalleryInput("fade"));
    assert.equal(result.verdict, "WARN");
    assert.ok(result.findings.some((f) => /"gallery" is assigned the "demonstrate" narrative stage/.test(f)));
    assert.ok(result.findings.some((f) => /Diagnostic only/.test(f)));
  });

  test("a motion budget of \"none\" cannot be incorrectly treated as a narrative-motion failure", () => {
    const input = buildValidInput();
    assert.equal(input.wireframe.experiencePlan?.motionBudget, "none");
    const result = qaNarrativeConsistency(input);
    assert.equal(result.verdict, "PASS");
    assert.ok(result.findings.some((f) => /motion budget is "none"/i.test(f)));
  });

  test("reduced-motion cannot create a false failure — this check reads only structured RefinedDesign.motion data, which never encodes prefers-reduced-motion (a client-runtime-only concern)", () => {
    // No field on QaStructuredInput represents reduced-motion state at all;
    // the same real design used for the PASS case above still PASSes
    // regardless, since nothing here is sensitive to it.
    const result = qaNarrativeConsistency(buildSensoryGalleryInput("fade-scale"));
    assert.equal(result.verdict, "PASS");
  });

  test("sparse/trust-authority cases remain safely valid — no \"demonstrate\" stage is ever assigned outside the sensory arc's gallery override", () => {
    const result = qaNarrativeConsistency(buildValidInput());
    assert.notEqual(result.verdict, "FAIL");
    assert.ok(result.verdict === "PASS" || result.verdict === "UNAVAILABLE");
  });

  test("UNAVAILABLE for a legacy wireframe predating Phase 6.1's ExperiencePlan", () => {
    const input = buildValidInput();
    const legacyWireframe = { ...input.wireframe, experiencePlan: undefined };
    const result = qaNarrativeConsistency({ ...input, wireframe: legacyWireframe });
    assert.equal(result.verdict, "UNAVAILABLE");
  });
});

describe("design-qa-service: resolveQaDesignInputs (founder-refinement awareness)", () => {
  test("returns the original wireframe/refinedDesign unchanged when no refinement exists", () => {
    const input = buildValidInput();
    const result = resolveQaDesignInputs(input.wireframe, input.refinedDesign, null, briefFor(), SAMPLE_DESIGN_MEMORY);
    assert.equal(result.wireframe, input.wireframe);
    assert.equal(result.refinedDesign, input.refinedDesign);
  });

  test("evaluates the founder's refined result, not the stale original, when a refinement exists", () => {
    const brief = briefFor();
    const originalWireframe = generateWireframe(brief, { hasRealTestimonials: false });
    const originalRefinedDesign = refineDesign({ wireframe: originalWireframe }, brief, SAMPLE_DESIGN_MEMORY);
    assert.equal(originalWireframe.experiencePlan?.mode, "warm-local-business");

    // Simulates a founder's resolved Experience Refinement landing on a
    // genuinely different mode — resolveQaDesignInputs must re-derive
    // refinedDesign from THIS plan, not keep the stale original.
    const refinedPlan = { mode: "cinematic-storytelling" as const, motionBudget: "enhanced" as const, rationale: "founder refinement" };
    const result = resolveQaDesignInputs(
      originalWireframe,
      originalRefinedDesign,
      { resolved_plan: refinedPlan as unknown as import("@/lib/supabase/database.types").Json },
      brief,
      SAMPLE_DESIGN_MEMORY
    );

    assert.equal(result.wireframe.experiencePlan?.mode, "cinematic-storytelling");
    assert.notEqual(result.refinedDesign, originalRefinedDesign);
    assert.equal(result.refinedDesign.motion.experienceMode, "cinematic-storytelling");
  });
});

describe("design-qa-service: qaBrandFitStructured", () => {
  test("confirms brandPersonality is genuinely structural load-bearing when the wireframe carries a real compositionVariant", () => {
    // buildValidInput()'s generateWireframe call always resolves a real
    // compositionVariant (lib/design-intelligence/composition-variants.ts) —
    // re-verified here via the same personalityPaddingBias function
    // Generation itself used, not by scanning for brandPersonality's own
    // adjectives inside real body copy (never the right bar — rendering
    // "warm"/"family-run" verbatim as page copy is exactly the hollow,
    // could-paste-onto-any-business phrasing findGenericPhrases exists to
    // keep off the page).
    const result = qaBrandFitStructured(buildValidInput());
    assert.ok(result.findings.some((f) => /structural inputs to this mission's compositionVariant/.test(f)));
    assert.equal(result.confidence, "Medium");
  });

  test("discloses brandPersonality is not (yet) load-bearing for a wireframe predating compositionVariant", () => {
    const input = buildValidInput();
    const legacyWireframe = { ...input.wireframe, compositionVariant: undefined };
    const result = qaBrandFitStructured({ ...input, wireframe: legacyWireframe });
    assert.ok(result.findings.some((f) => /not \(yet\) load-bearing/.test(f)));
    assert.equal(result.verdict, "WARN");
  });
});

describe("design-qa-service: qaGenericTemplate", () => {
  test("PASS for a real generated design", () => {
    const result = qaGenericTemplate(buildValidInput());
    assert.equal(result.verdict, "PASS");
  });

  test("flags an emoji found in real slot content", () => {
    const input = buildValidInput();
    const withEmoji: QaStructuredInput = {
      ...input,
      components: input.components.map((c) => ({
        ...c,
        slots: c.slots.map((s): ComponentSlot => (s.name === "businessName" ? { ...s, value: `${s.value} 🎉` } : s)),
      })),
    };
    const result = qaGenericTemplate(withEmoji);
    assert.equal(result.verdict, "WARN");
    assert.ok(result.findings.some((f) => /emoji-as-icon/.test(f)));
  });

  // Phase 5.4: a real Canadian Tire regression — real, legitimately-used
  // copy "Get 20% BACK in CT Money®*" tripped this check as if it contained
  // an emoji, because \p{Extended_Pictographic} alone also matches ®/™/©.
  test("does NOT flag ® as an emoji — real trademark typography in real business copy", () => {
    const input = buildValidInput();
    const withRegisteredMark: QaStructuredInput = {
      ...input,
      components: input.components.map((c) => ({
        ...c,
        slots: c.slots.map((s): ComponentSlot =>
          s.name === "businessName" ? { ...s, value: "Get 20% BACK in CT Money®*" } : s
        ),
      })),
    };
    const result = qaGenericTemplate(withRegisteredMark);
    assert.equal(result.verdict, "PASS");
    assert.ok(!result.findings.some((f) => /emoji-as-icon/.test(f)));
  });

  test("does NOT flag ™ or © as emoji either, but still flags a real emoji sitting right next to them", () => {
    const input = buildValidInput();
    const withMixedSymbols: QaStructuredInput = {
      ...input,
      components: input.components.map((c) => ({
        ...c,
        slots: c.slots.map((s): ComponentSlot =>
          s.name === "businessName" ? { ...s, value: `${s.value}™ © 2026 🎉` } : s
        ),
      })),
    };
    const result = qaGenericTemplate(withMixedSymbols);
    assert.equal(result.verdict, "WARN", "the real 🎉 emoji alongside ™/© must still be caught");
    assert.ok(result.findings.some((f) => /emoji-as-icon/.test(f)));
  });

  test("FAILs when positioning/heroThesis/signatureElement contains a banned generic marketing phrase", () => {
    const input = buildValidInput();
    const withGenericCopy: QaStructuredInput = {
      ...input,
      designBrief: { ...input.designBrief, positioning: "We are committed to quality and customer satisfaction." },
    };
    const result = qaGenericTemplate(withGenericCopy);
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.findings.some((f) => /Hollow marketing filler/.test(f)));
  });

  test("FAILs when this mission's heroThesis is identical to another mission's in the batch", () => {
    const input = buildValidInput();
    const withDuplicateThesis: QaStructuredInput = {
      ...input,
      batch: {
        ...input.batch,
        designSignatures: [
          ...input.batch.designSignatures,
          { missionId: "mission-2", heroThesis: input.designBrief.heroThesis, signatureElement: "gallery-atmosphere-treatment" },
        ],
      },
    };
    const result = qaGenericTemplate(withDuplicateThesis);
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.findings.some((f) => /heroThesis is identical/.test(f)));
  });

  test("FAILs when this mission's signatureElement is identical to another mission's in the batch", () => {
    const input = buildValidInput();
    const withDuplicateSignature: QaStructuredInput = {
      ...input,
      batch: {
        ...input.batch,
        designSignatures: [
          ...input.batch.designSignatures,
          { missionId: "mission-2", heroThesis: "A completely different thesis.", signatureElement: input.designBrief.signatureElement.element },
        ],
      },
    };
    const result = qaGenericTemplate(withDuplicateSignature);
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.findings.some((f) => /signatureElement is identical/.test(f)));
  });

  test("PASS when positioning/heroThesis are evidence-grounded and unique in the batch", () => {
    const result = qaGenericTemplate(buildValidInput());
    assert.equal(result.verdict, "PASS");
  });

  test("WARNs (not FAILs) when this mission's real hero pattern is shared with another mission in a genuinely DIFFERENT industry — the Friedman Flagship Final Content Pass's anti-template convergence check", () => {
    const input = buildValidInput();
    const thisHeroPattern = input.components.find((c) => c.section === "hero")?.pattern;
    assert.ok(thisHeroPattern, "fixture must actually produce a hero pattern for this test to exercise the real check");
    const withCrossIndustryConvergence: QaStructuredInput = {
      ...input,
      industryBucket: "restaurant",
      batch: {
        ...input.batch,
        designSignatures: [
          ...input.batch.designSignatures.map((s) => ({ ...s, industryBucket: "restaurant", heroPattern: thisHeroPattern })),
          {
            missionId: "mission-2",
            heroThesis: "A completely different thesis for a completely different business.",
            signatureElement: "credibility-certification-display",
            industryBucket: "lawFirm",
            heroPattern: thisHeroPattern,
          },
        ],
      },
    };
    const result = qaGenericTemplate(withCrossIndustryConvergence);
    assert.equal(result.verdict, "WARN");
    assert.ok(result.findings.some((f) => /hero pattern is shared/.test(f) && /genuinely different industries/.test(f)));
  });

  test("does NOT warn when the shared hero pattern occurs only within the SAME industry bucket", () => {
    const input = buildValidInput();
    const thisHeroPattern = input.components.find((c) => c.section === "hero")?.pattern;
    const withSameIndustryConvergence: QaStructuredInput = {
      ...input,
      industryBucket: "restaurant",
      batch: {
        ...input.batch,
        designSignatures: [
          ...input.batch.designSignatures.map((s) => ({ ...s, industryBucket: "restaurant", heroPattern: thisHeroPattern })),
          {
            missionId: "mission-2",
            heroThesis: "A completely different thesis for a different restaurant.",
            signatureElement: "gallery-atmosphere-treatment",
            industryBucket: "restaurant",
            heroPattern: thisHeroPattern,
          },
        ],
      },
    };
    const result = qaGenericTemplate(withSameIndustryConvergence);
    assert.ok(!result.findings.some((f) => /hero pattern is shared/.test(f)));
  });
});

describe("design-qa-service: runStructuredDeterministicChecks", () => {
  test("returns a result for every QA category, never silently omitting one", () => {
    const results = runStructuredDeterministicChecks(buildValidInput());
    const categories = Object.keys(results);
    assert.deepEqual(
      categories.sort(),
      ["accessibility", "brandFit", "conversion", "genericTemplate", "layout", "mobile", "motion", "narrativeConsistency", "performance", "spacing", "trust", "typography"].sort()
    );
    for (const category of categories) {
      assert.ok(["PASS", "WARN", "FAIL", "UNAVAILABLE"].includes(results[category as keyof typeof results].verdict));
    }
  });

  test("Performance reads UNAVAILABLE with no structured-only check (§4.7 has no qualitative residue to fall back on)", () => {
    const results = runStructuredDeterministicChecks(buildValidInput());
    assert.equal(results.performance.verdict, "UNAVAILABLE");
    assert.equal(results.performance.confidence, "Unavailable");
  });
});

describe("design-qa-service: assembleDesignQaReport", () => {
  const baseDeterministic: DeterministicCategoryResult = {
    verdict: "PASS",
    confidence: "High",
    evidenceSource: "structured",
    findings: ["clean"],
    evidence: [{ source: "test", detail: "clean" }],
  };

  function allPass(): Record<string, DeterministicCategoryResult> {
    const categories = [
      "typography",
      "spacing",
      "layout",
      "motion",
      "mobile",
      "accessibility",
      "performance",
      "trust",
      "conversion",
      "brandFit",
      "genericTemplate",
      "narrativeConsistency",
    ];
    return Object.fromEntries(categories.map((c) => [c, baseDeterministic]));
  }

  test("overallVerdict is PASS when nothing fails or is unavailable", () => {
    const report = assembleDesignQaReport(
      { missionId: "m1", websiteDesignId: "d1", businessName: "Acme" },
      allPass() as never,
      {},
      { available: true }
    );
    assert.equal(report.overallVerdict, "PASS");
  });

  test("overallVerdict is FAIL when any deterministic category FAILs, regardless of the rest", () => {
    const categories = { ...allPass(), trust: { ...baseDeterministic, verdict: "FAIL" as const } };
    const report = assembleDesignQaReport({ missionId: "m1", websiteDesignId: "d1", businessName: "Acme" }, categories as never, {}, { available: true });
    assert.equal(report.overallVerdict, "FAIL");
  });

  test("overallVerdict is FAIL when an AI-derived assessment grades CRITICAL, even with all deterministic checks passing", () => {
    const aiDerived: AiDerivedAssessment = {
      type: "AI-derived assessment",
      grade: "CRITICAL",
      reasoning: "test",
      citedEvidence: ["test"],
      confidence: "Medium",
      recommendation: "test",
    };
    const report = assembleDesignQaReport(
      { missionId: "m1", websiteDesignId: "d1", businessName: "Acme" },
      allPass() as never,
      { brandFit: aiDerived },
      { available: true }
    );
    assert.equal(report.overallVerdict, "FAIL");
  });

  test("overallVerdict is INCOMPLETE, not PASS, when most of the suite is UNAVAILABLE", () => {
    const categories = allPass();
    const unavailableResult: DeterministicCategoryResult = { ...baseDeterministic, verdict: "UNAVAILABLE", confidence: "Unavailable" };
    for (const key of ["accessibility", "performance", "mobile", "typography", "spacing", "layout", "motion"]) {
      categories[key] = unavailableResult;
    }
    const report = assembleDesignQaReport(
      { missionId: "m1", websiteDesignId: "d1", businessName: "Acme" },
      categories as never,
      {},
      { available: false, reason: "test" }
    );
    assert.equal(report.overallVerdict, "INCOMPLETE");
  });

  test("every category is present in the report, never silently omitted", () => {
    const report = assembleDesignQaReport({ missionId: "m1", websiteDesignId: "d1", businessName: "Acme" }, allPass() as never, {}, { available: true });
    assert.equal(Object.keys(report.categories).length, 12);
  });
});
