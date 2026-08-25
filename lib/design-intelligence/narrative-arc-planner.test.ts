import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolveNarrativeArc,
  NARRATIVE_ARC_TOKEN_VOCABULARY,
  NARRATIVE_STAGE_TOKEN_VOCABULARY,
  type NarrativeArcToken,
} from "@/lib/design-intelligence/narrative-arc-planner";
import { resolveExperiencePlan, type ExperiencePlanEvidenceDensity } from "@/lib/design-intelligence/experience-planner";
import type { ExperienceMode, ExperiencePlan } from "@/shared/design-intelligence/types";
import type { SectionType } from "@/lib/services/design-generation-service";

const NO_EVIDENCE: ExperiencePlanEvidenceDensity = {
  services: 0,
  certifications: 0,
  hasReviews: false,
  galleryCount: 0,
  hasRealTeam: false,
};

const RICH_EVIDENCE: ExperiencePlanEvidenceDensity = {
  services: 5,
  certifications: 2,
  hasReviews: true,
  galleryCount: 6,
  hasRealTeam: true,
};

function planFor(mode: ExperienceMode): ExperiencePlan {
  return { mode, motionBudget: "cinematic", rationale: "test rationale" };
}

const FULL_SECTIONS: SectionType[] = ["hero", "services", "credibility", "gallery", "testimonials", "faq", "contact", "footer"];

describe("narrative-arc-planner: mode -> candidate arc mapping (rich evidence, never downgraded)", () => {
  const expected: Record<ExperienceMode, NarrativeArcToken> = {
    "trust-authority": "authority",
    "premium-minimal": "minimal-direct",
    "cinematic-storytelling": "sensory",
    "editorial-storytelling": "editorial",
    "warm-local-business": "editorial",
    "product-showcase": "discovery",
    "interactive-showcase": "discovery",
    "high-energy-retail": "conversion",
  };

  for (const [mode, arcToken] of Object.entries(expected) as [ExperienceMode, NarrativeArcToken][]) {
    test(`"${mode}" resolves to "${arcToken}" when real evidence is rich`, () => {
      const plan = resolveNarrativeArc({ experiencePlan: planFor(mode), sections: FULL_SECTIONS, evidence: RICH_EVIDENCE });
      assert.equal(plan.arcToken, arcToken);
    });
  }

  test("every returned arcToken is a real member of the closed vocabulary", () => {
    for (const mode of Object.keys(expected) as ExperienceMode[]) {
      const plan = resolveNarrativeArc({ experiencePlan: planFor(mode), sections: FULL_SECTIONS, evidence: RICH_EVIDENCE });
      assert.ok(NARRATIVE_ARC_TOKEN_VOCABULARY.includes(plan.arcToken));
    }
  });
});

describe("narrative-arc-planner: evidence-first guardrail — rich arcs degrade honestly under sparse evidence", () => {
  test("cinematic-storytelling with zero evidence signals degrades to minimal-direct, never a fabricated sensory arc", () => {
    const plan = resolveNarrativeArc({ experiencePlan: planFor("cinematic-storytelling"), sections: ["hero", "contact", "footer"], evidence: NO_EVIDENCE });
    assert.equal(plan.arcToken, "minimal-direct");
  });

  test("high-energy-retail with exactly one evidence signal degrades to editorial, not all the way to minimal-direct", () => {
    const oneSignal: ExperiencePlanEvidenceDensity = { ...NO_EVIDENCE, hasReviews: true };
    const plan = resolveNarrativeArc({ experiencePlan: planFor("high-energy-retail"), sections: FULL_SECTIONS, evidence: oneSignal });
    assert.equal(plan.arcToken, "editorial");
  });

  test("discovery (product-showcase) is granted once evidence clears the floor (2 signals), never requiring rich evidence beyond that", () => {
    const twoSignals: ExperiencePlanEvidenceDensity = { ...NO_EVIDENCE, hasReviews: true, hasRealTeam: true };
    const plan = resolveNarrativeArc({ experiencePlan: planFor("product-showcase"), sections: FULL_SECTIONS, evidence: twoSignals });
    assert.equal(plan.arcToken, "discovery");
  });

  test("authority, minimal-direct, and editorial are never gated by this evidence floor — they reach their own mode's arc regardless of evidence richness", () => {
    assert.equal(resolveNarrativeArc({ experiencePlan: planFor("trust-authority"), sections: FULL_SECTIONS, evidence: NO_EVIDENCE }).arcToken, "authority");
    assert.equal(resolveNarrativeArc({ experiencePlan: planFor("premium-minimal"), sections: FULL_SECTIONS, evidence: NO_EVIDENCE }).arcToken, "minimal-direct");
    assert.equal(resolveNarrativeArc({ experiencePlan: planFor("editorial-storytelling"), sections: FULL_SECTIONS, evidence: NO_EVIDENCE }).arcToken, "editorial");
    assert.equal(resolveNarrativeArc({ experiencePlan: planFor("warm-local-business"), sections: FULL_SECTIONS, evidence: NO_EVIDENCE }).arcToken, "editorial");
  });

  test("a sparse business with only hero/contact/footer (no middle sections at all) still resolves cleanly to minimal-direct with an empty middle stageBySection", () => {
    const plan = resolveNarrativeArc({ experiencePlan: planFor("high-energy-retail"), sections: ["hero", "contact", "footer"], evidence: NO_EVIDENCE });
    assert.equal(plan.arcToken, "minimal-direct");
    assert.deepEqual(
      plan.stageBySection.map((s) => s.stage),
      ["establish", "convert", "convert"]
    );
  });
});

describe("narrative-arc-planner: stage assignment — universal anchors and per-section-type defaults", () => {
  test("hero always establishes, contact and footer always convert, regardless of arc", () => {
    for (const mode of ["trust-authority", "high-energy-retail", "cinematic-storytelling"] as ExperienceMode[]) {
      const plan = resolveNarrativeArc({ experiencePlan: planFor(mode), sections: FULL_SECTIONS, evidence: RICH_EVIDENCE });
      const bySection = new Map(plan.stageBySection.map((s) => [s.section, s.stage]));
      assert.equal(bySection.get("hero"), "establish");
      assert.equal(bySection.get("contact"), "convert");
      assert.equal(bySection.get("footer"), "convert");
    }
  });

  test("services/menu/listings/schedule/serviceArea reveal; credibility/team/testimonials validate; faq deepens", () => {
    const sections: SectionType[] = ["hero", "services", "menu", "listings", "schedule", "serviceArea", "credibility", "team", "testimonials", "faq", "contact", "footer"];
    const plan = resolveNarrativeArc({ experiencePlan: planFor("editorial-storytelling"), sections, evidence: RICH_EVIDENCE });
    const bySection = new Map(plan.stageBySection.map((s) => [s.section, s.stage]));
    for (const revealSection of ["services", "menu", "listings", "schedule", "serviceArea"] as SectionType[]) {
      assert.equal(bySection.get(revealSection), "reveal", `expected ${revealSection} to reveal`);
    }
    for (const validateSection of ["credibility", "team", "testimonials"] as SectionType[]) {
      assert.equal(bySection.get(validateSection), "validate", `expected ${validateSection} to validate`);
    }
    assert.equal(bySection.get("faq"), "deepen");
  });

  test("gallery demonstrates specifically under the sensory arc, but only reveals under every other arc", () => {
    const sensoryPlan = resolveNarrativeArc({ experiencePlan: planFor("cinematic-storytelling"), sections: FULL_SECTIONS, evidence: RICH_EVIDENCE });
    assert.equal(sensoryPlan.arcToken, "sensory");
    assert.equal(sensoryPlan.stageBySection.find((s) => s.section === "gallery")?.stage, "demonstrate");

    const editorialPlan = resolveNarrativeArc({ experiencePlan: planFor("editorial-storytelling"), sections: FULL_SECTIONS, evidence: RICH_EVIDENCE });
    assert.equal(editorialPlan.stageBySection.find((s) => s.section === "gallery")?.stage, "reveal");
  });

  test("stageBySection contains exactly one entry per input section, in the SAME order — never reordered, never padded, never duplicated", () => {
    const sections: SectionType[] = ["hero", "credibility", "services", "faq", "contact", "footer"];
    const plan = resolveNarrativeArc({ experiencePlan: planFor("trust-authority"), sections, evidence: RICH_EVIDENCE });
    assert.deepEqual(
      plan.stageBySection.map((s) => s.section),
      sections
    );
  });

  test("a section not present in the input list gets no stage entry at all — never invented", () => {
    const plan = resolveNarrativeArc({ experiencePlan: planFor("trust-authority"), sections: ["hero", "contact", "footer"], evidence: RICH_EVIDENCE });
    assert.equal(plan.stageBySection.some((s) => s.section === "testimonials"), false);
    assert.equal(plan.stageBySection.length, 3);
  });

  test("every stage in every plan is a real member of the closed stage vocabulary", () => {
    const plan = resolveNarrativeArc({ experiencePlan: planFor("high-energy-retail"), sections: FULL_SECTIONS, evidence: RICH_EVIDENCE });
    for (const { stage } of plan.stageBySection) {
      assert.ok(NARRATIVE_STAGE_TOKEN_VOCABULARY.includes(stage));
    }
  });
});

describe("narrative-arc-planner: confidence — explanatory only, mirrors CapabilityDecision's own discipline", () => {
  test("minimal-direct is always High confidence — correctly identifying the honest floor is itself the confident read", () => {
    const plan = resolveNarrativeArc({ experiencePlan: planFor("premium-minimal"), sections: FULL_SECTIONS, evidence: NO_EVIDENCE });
    assert.equal(plan.confidence, "High");
  });

  test("a granted rich arc at exactly the evidence floor (2 signals) reads Medium, not High", () => {
    const twoSignals: ExperiencePlanEvidenceDensity = { ...NO_EVIDENCE, hasReviews: true, hasRealTeam: true };
    const plan = resolveNarrativeArc({ experiencePlan: planFor("high-energy-retail"), sections: FULL_SECTIONS, evidence: twoSignals });
    assert.equal(plan.arcToken, "conversion");
    assert.equal(plan.confidence, "Medium");
  });

  test("a granted rich arc with 3+ real evidence signals reads High", () => {
    const plan = resolveNarrativeArc({ experiencePlan: planFor("high-energy-retail"), sections: FULL_SECTIONS, evidence: RICH_EVIDENCE });
    assert.equal(plan.confidence, "High");
  });

  test("confidence is deterministic — the same input always produces the same tier", () => {
    const input = { experiencePlan: planFor("cinematic-storytelling"), sections: FULL_SECTIONS, evidence: RICH_EVIDENCE };
    assert.equal(resolveNarrativeArc(input).confidence, resolveNarrativeArc(input).confidence);
  });
});

describe("narrative-arc-planner: rationale — honest, cites real conditions", () => {
  test("names the real mode and arc when not downgraded", () => {
    const plan = resolveNarrativeArc({ experiencePlan: planFor("trust-authority"), sections: FULL_SECTIONS, evidence: RICH_EVIDENCE });
    assert.match(plan.rationale, /"trust-authority"/);
    assert.match(plan.rationale, /"authority"/);
    assert.doesNotMatch(plan.rationale, /downgraded/);
  });

  test("honestly names the downgrade, the mode's own natural register, and the real signal count when evidence forces one", () => {
    const plan = resolveNarrativeArc({ experiencePlan: planFor("cinematic-storytelling"), sections: FULL_SECTIONS, evidence: NO_EVIDENCE });
    assert.match(plan.rationale, /downgraded from "sensory"/);
    assert.match(plan.rationale, /0 of 5 real evidence signals/);
    assert.match(plan.rationale, /not a failed version/);
  });
});

describe("narrative-arc-planner: defensive fallback for an out-of-union mode", () => {
  test("an unrecognized mode falls back to minimal-direct rather than throwing", () => {
    // @ts-expect-error deliberately passing a value outside the ExperienceMode union to prove the runtime fallback, not just the type system.
    const plan = resolveNarrativeArc({ experiencePlan: { mode: "not-a-real-mode", motionBudget: "cinematic", rationale: "test" }, sections: FULL_SECTIONS, evidence: RICH_EVIDENCE });
    assert.equal(plan.arcToken, "minimal-direct");
  });
});

describe("narrative-arc-planner: real, pipeline-resolved plan drives the same real gate — never re-derived independently", () => {
  test("a real trust-authority ExperiencePlan (from resolveExperiencePlan) resolves to the authority arc", () => {
    const evidence: ExperiencePlanEvidenceDensity = { services: 0, certifications: 2, hasReviews: true, galleryCount: 0, hasRealTeam: true };
    const plan = resolveExperiencePlan({
      industryBucket: "lawFirm",
      heroPattern: "editorial-typographic",
      evidence,
      motionIntensity: "restrained",
    });
    assert.equal(plan.mode, "trust-authority");
    const arcPlan = resolveNarrativeArc({ experiencePlan: plan, sections: FULL_SECTIONS, evidence });
    assert.equal(arcPlan.arcToken, "authority");
  });

  test("a real sparse general-bucket ExperiencePlan resolves to minimal-direct via the honest evidence-agnostic editorial fallback mode", () => {
    const plan = resolveExperiencePlan({
      industryBucket: "general",
      heroPattern: "editorial-typographic",
      evidence: NO_EVIDENCE,
      motionIntensity: "restrained",
    });
    assert.equal(plan.mode, "editorial-storytelling");
    const arcPlan = resolveNarrativeArc({ experiencePlan: plan, sections: ["hero", "services", "credibility", "contact", "footer"], evidence: NO_EVIDENCE });
    assert.equal(arcPlan.arcToken, "editorial");
  });
});
