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
