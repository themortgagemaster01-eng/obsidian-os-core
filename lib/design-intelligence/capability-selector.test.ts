import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolveExperienceCapabilities,
  CAPABILITY_TOKEN_VOCABULARY,
  CAPABILITY_SUPPORT_LEVEL_VOCABULARY,
} from "@/lib/design-intelligence/capability-selector";
import { resolveExperiencePlan, type ExperiencePlanEvidenceDensity } from "@/lib/design-intelligence/experience-planner";
import type { ExperiencePlan } from "@/shared/design-intelligence/types";

const NO_EVIDENCE: ExperiencePlanEvidenceDensity = {
  services: 0,
  certifications: 0,
  hasReviews: false,
  galleryCount: 0,
  hasRealTeam: false,
};

function planFor(motionBudget: ExperiencePlan["motionBudget"]): ExperiencePlan {
  return { mode: "editorial-storytelling", motionBudget, rationale: "test rationale" };
}

describe("capability-selector: resolveExperienceCapabilities — basic-motion gate", () => {
  test("granted whenever the resolved plan's motion budget is anything other than none", () => {
    for (const motionBudget of ["subtle", "enhanced", "cinematic"] as const) {
      const decisions = resolveExperienceCapabilities({
        experiencePlan: planFor(motionBudget),
        evidence: NO_EVIDENCE,
        industryBucket: "general",
        heroPattern: "editorial-typographic",
      });
      const basicMotion = decisions.find((d) => d.token === "basic-motion")!;
      assert.equal(basicMotion.granted, true, `expected basic-motion granted for motionBudget "${motionBudget}"`);
    }
  });

  test("NOT granted when the resolved plan's motion budget is none — a sparse/trust-authority business stays genuinely motion-free", () => {
    const decisions = resolveExperienceCapabilities({
      experiencePlan: planFor("none"),
      evidence: NO_EVIDENCE,
      industryBucket: "lawFirm",
      heroPattern: "editorial-typographic",
    });
    const basicMotion = decisions.find((d) => d.token === "basic-motion")!;
    assert.equal(basicMotion.granted, false);
  });

  test("a real, pipeline-resolved plan for an evidence-sparse trust-authority business (motion budget capped at subtle/none) drives the same real gate — never re-derived independently", () => {
    const plan = resolveExperiencePlan({
      industryBucket: "lawFirm",
      heroPattern: "editorial-typographic",
      evidence: NO_EVIDENCE,
      motionIntensity: "restrained",
    });
    const decisions = resolveExperienceCapabilities({
      experiencePlan: plan,
      evidence: NO_EVIDENCE,
      industryBucket: "lawFirm",
      heroPattern: "editorial-typographic",
    });
    const basicMotion = decisions.find((d) => d.token === "basic-motion")!;
    assert.equal(basicMotion.granted, plan.motionBudget !== "none");
  });

  test("always returns exactly one decision per entry in the closed token vocabulary — never partial, never undefined", () => {
    const decisions = resolveExperienceCapabilities({
      experiencePlan: planFor("cinematic"),
      evidence: NO_EVIDENCE,
      industryBucket: "general",
      heroPattern: "editorial-typographic",
    });
    assert.equal(decisions.length, CAPABILITY_TOKEN_VOCABULARY.length);
    assert.deepEqual(
      decisions.map((d) => d.token),
      [...CAPABILITY_TOKEN_VOCABULARY]
    );
  });
});

describe("capability-selector: resolveExperienceCapabilities — supportLevel/confidenceScore/reason (computed AFTER granted, never feed back into it)", () => {
  test("supportLevel is High whenever granted — basic-motion's existing CSS/IntersectionObserver system already fully implements every non-none tier", () => {
    for (const motionBudget of ["subtle", "enhanced", "cinematic"] as const) {
      const decisions = resolveExperienceCapabilities({
        experiencePlan: planFor(motionBudget),
        evidence: NO_EVIDENCE,
        industryBucket: "general",
        heroPattern: "editorial-typographic",
      });
      assert.equal(decisions[0].supportLevel, "High");
      assert.ok(CAPABILITY_SUPPORT_LEVEL_VOCABULARY.includes(decisions[0].supportLevel));
    }
  });

  test("supportLevel is Low when not granted", () => {
    const decisions = resolveExperienceCapabilities({
      experiencePlan: planFor("none"),
      evidence: NO_EVIDENCE,
      industryBucket: "general",
      heroPattern: "editorial-typographic",
    });
    assert.equal(decisions[0].supportLevel, "Low");
  });

  test("confidenceScore is a deterministic function of the resolved motion budget's own rank, in [0, 1] and strictly increasing with budget tier", () => {
    const scores = (["none", "subtle", "enhanced", "cinematic"] as const).map((motionBudget) => {
      const decisions = resolveExperienceCapabilities({
        experiencePlan: planFor(motionBudget),
        evidence: NO_EVIDENCE,
        industryBucket: "general",
        heroPattern: "editorial-typographic",
      });
      return decisions[0].confidenceScore;
    });
    assert.deepEqual(scores, [0, 0.33, 0.67, 1]);
    for (const score of scores) {
      assert.ok(score >= 0 && score <= 1);
    }
  });

  test("confidenceScore is the SAME real value for the same input every time — no randomness, no LLM call", () => {
    const input = {
      experiencePlan: planFor("enhanced"),
      evidence: NO_EVIDENCE,
      industryBucket: "general" as const,
      heroPattern: "editorial-typographic" as const,
    };
    const first = resolveExperienceCapabilities(input)[0].confidenceScore;
    const second = resolveExperienceCapabilities(input)[0].confidenceScore;
    assert.equal(first, second);
  });

  test("reason names the actual resolved mode and motion budget when granted, and explains the zero-motion outcome honestly when not", () => {
    const granted = resolveExperienceCapabilities({
      experiencePlan: { mode: "trust-authority", motionBudget: "subtle", rationale: "test" },
      evidence: NO_EVIDENCE,
      industryBucket: "lawFirm",
      heroPattern: "editorial-typographic",
    })[0];
    assert.match(granted.reason, /"subtle"/);
    assert.match(granted.reason, /"trust-authority"/);
    assert.match(granted.reason, /Granted/);

    const notGranted = resolveExperienceCapabilities({
      experiencePlan: { mode: "trust-authority", motionBudget: "none", rationale: "zero-evidence rationale text" },
      evidence: NO_EVIDENCE,
      industryBucket: "lawFirm",
      heroPattern: "editorial-typographic",
    })[0];
    assert.match(notGranted.reason, /Not granted/);
    assert.match(notGranted.reason, /zero-evidence rationale text/);
  });
});

// ===========================================================================
// Phase 6.6 — shader-enhanced-hero gate
// (docs/PHASE_6.6_SHADER_TECHNICAL_AUDIT.md's approved gate).
// ===========================================================================

function shaderDecisionFor(
  mode: ExperiencePlan["mode"],
  motionBudget: ExperiencePlan["motionBudget"],
  overrides: { brandPersonality?: string[]; contentTone?: string } = {}
) {
  const decisions = resolveExperienceCapabilities({
    experiencePlan: { mode, motionBudget, rationale: "test rationale" },
    evidence: NO_EVIDENCE,
    industryBucket: "general",
    heroPattern: "editorial-typographic",
    ...overrides,
  });
  return decisions.find((d) => d.token === "shader-enhanced-hero")!;
}

describe("capability-selector: resolveExperienceCapabilities — shader-enhanced-hero gate", () => {
  test("granted for every allowed energetic-register mode at enhanced or cinematic budget", () => {
    const allowedModes: ExperiencePlan["mode"][] = [
      "cinematic-storytelling",
      "high-energy-retail",
      "product-showcase",
      "interactive-showcase",
    ];
    for (const mode of allowedModes) {
      for (const motionBudget of ["enhanced", "cinematic"] as const) {
        const decision = shaderDecisionFor(mode, motionBudget);
        assert.equal(decision.granted, true, `expected granted for ${mode} at ${motionBudget}`);
      }
    }
  });

  test("NOT granted below the enhanced floor, even for an otherwise-allowed mode", () => {
    for (const motionBudget of ["none", "subtle"] as const) {
      const decision = shaderDecisionFor("cinematic-storytelling", motionBudget);
      assert.equal(decision.granted, false, `expected denied at ${motionBudget}`);
    }
  });

  test("trust-authority is denied — structurally, via its own subtle ceiling, never reaching the enhanced floor", () => {
    const decision = shaderDecisionFor("trust-authority", "subtle");
    assert.equal(decision.granted, false);
  });

  test("premium-minimal is denied — same structural reason as trust-authority", () => {
    const decision = shaderDecisionFor("premium-minimal", "subtle");
    assert.equal(decision.granted, false);
  });

  test("editorial-storytelling is denied even when it reaches the enhanced budget — an explicit allowlist exclusion, not merely a budget shortfall (proves the allowlist does real work beyond what the budget check alone would already exclude)", () => {
    const deniedAtEnhanced = shaderDecisionFor("editorial-storytelling", "enhanced");
    assert.equal(deniedAtEnhanced.granted, false);
    const deniedAtCinematic = shaderDecisionFor("editorial-storytelling", "cinematic");
    assert.equal(deniedAtCinematic.granted, false);
  });

  test("warm-local-business is denied even when it reaches the enhanced budget — register mismatch, not evidence starvation", () => {
    const decision = shaderDecisionFor("warm-local-business", "enhanced");
    assert.equal(decision.granted, false);
  });

  test("a zero-motion sparse experience is denied regardless of mode", () => {
    const decision = shaderDecisionFor("cinematic-storytelling", "none");
    assert.equal(decision.granted, false);
  });

  test("a restrained brand personality/content tone denies the capability even for an otherwise-eligible mode+budget", () => {
    const restrained = shaderDecisionFor("high-energy-retail", "cinematic", {
      brandPersonality: ["understated", "quiet"],
    });
    assert.equal(restrained.granted, false);

    const restrainedByTone = shaderDecisionFor("high-energy-retail", "cinematic", {
      contentTone: "refined and restrained",
    });
    assert.equal(restrainedByTone.granted, false);

    // A bold-read (not restrained) personality on the same otherwise-eligible mode+budget stays granted — confirms the tone check is a real exclusion, not an accidental universal denial.
    const bold = shaderDecisionFor("high-energy-retail", "cinematic", { brandPersonality: ["bold", "energetic"] });
    assert.equal(bold.granted, true);
  });

  test("human 'more energetic' + 'more motion' cannot breach the gate for trust-authority — the ceiling protection is inherited from resolveMotionBudget's own Math.min() composition, never re-implemented here", () => {
    const plan = resolveExperiencePlan({
      industryBucket: "lawFirm",
      heroPattern: "editorial-typographic",
      evidence: { services: 5, certifications: 3, hasReviews: true, galleryCount: 6, hasRealTeam: true },
      motionIntensity: "energetic",
      humanPreference: { energy: "more-energetic", motion: "more" },
    });
    assert.equal(plan.mode, "trust-authority");
    assert.equal(plan.motionBudget, "subtle");
    const decisions = resolveExperienceCapabilities({ experiencePlan: plan, evidence: NO_EVIDENCE, industryBucket: "lawFirm" });
    const shaderDecision = decisions.find((d) => d.token === "shader-enhanced-hero")!;
    assert.equal(shaderDecision.granted, false);
  });

  test("supportLevel is High when granted (the one shipped shader family fully supports every granted case), Low when not", () => {
    assert.equal(shaderDecisionFor("cinematic-storytelling", "cinematic").supportLevel, "High");
    assert.equal(shaderDecisionFor("trust-authority", "subtle").supportLevel, "Low");
  });

  test("reason distinguishes mode-exclusion, budget-shortfall, and restrained-tone denials honestly, and names the real granted conditions", () => {
    assert.match(shaderDecisionFor("editorial-storytelling", "enhanced").reason, /energetic-register modes/);
    assert.match(shaderDecisionFor("cinematic-storytelling", "subtle").reason, /enhanced.*floor/);
    assert.match(
      shaderDecisionFor("high-energy-retail", "cinematic", { brandPersonality: ["restrained"] }).reason,
      /deliberately restrained/
    );
    const granted = shaderDecisionFor("cinematic-storytelling", "cinematic");
    assert.match(granted.reason, /Granted/);
    assert.match(granted.reason, /"cinematic-storytelling"/);
    assert.match(granted.reason, /"cinematic"/);
  });

  test("evidence/industryBucket/heroPattern are entirely optional — the gate only ever reads experiencePlan and brandPersonality/contentTone", () => {
    const decisions = resolveExperienceCapabilities({
      experiencePlan: { mode: "cinematic-storytelling", motionBudget: "cinematic", rationale: "test" },
    });
    const decision = decisions.find((d) => d.token === "shader-enhanced-hero")!;
    assert.equal(decision.granted, true);
  });
});
