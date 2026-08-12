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
  runStructuredDeterministicChecks,
  assembleDesignQaReport,
  type QaStructuredInput,
  type DeterministicCategoryResult,
  type AiDerivedAssessment,
} from "@/lib/services/design-qa-service";
import { generateWireframe, assembleComponents, type ComponentSlot } from "@/lib/services/design-generation-service";
import { refineDesign } from "@/lib/services/design-refinement-service";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import { GENERIC_SAAS_TEMPLATE_SECTION_ORDER } from "@/lib/design-intelligence/layout-rules";

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
});

describe("design-qa-service: qaBrandFitStructured", () => {
  test("discloses that brandPersonality is not currently load-bearing in assembled copy (a real, honest gap)", () => {
    const result = qaBrandFitStructured(buildValidInput());
    assert.ok(result.findings.some((f) => /not \(yet\) load-bearing/.test(f)));
    assert.equal(result.confidence, "Medium");
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
});

describe("design-qa-service: runStructuredDeterministicChecks", () => {
  test("returns a result for every QA category, never silently omitting one", () => {
    const results = runStructuredDeterministicChecks(buildValidInput());
    const categories = Object.keys(results);
    assert.deepEqual(
      categories.sort(),
      ["accessibility", "brandFit", "conversion", "genericTemplate", "layout", "mobile", "motion", "performance", "spacing", "trust", "typography"].sort()
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
    assert.equal(Object.keys(report.categories).length, 11);
  });
});
