import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveMotionThroughCapabilities } from "@/lib/design-intelligence/capability-motion-execution";
import { refineMotion } from "@/lib/services/design-refinement-service";
import { generateWireframe, type Wireframe } from "@/lib/services/design-generation-service";
import type { DesignBrief } from "@/lib/services/design-brief-service";

function briefFor(
  overrides: Partial<DesignBrief["direction"]> = {},
  industryBucket: DesignBrief["industryBucket"] = "general"
): DesignBrief {
  return {
    missionId: "mission-1",
    businessName: "Acme Co",
    websiteUrl: "https://acme.test",
    industry: null,
    industryBucket,
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

/** A real, generated wireframe carrying a non-"none" ExperiencePlan — a homeService business with real offering/gallery evidence, mirroring design-refinement-service.test.ts's own recipe. */
function grantedWireframe(): Wireframe {
  return generateWireframe(briefFor({ motionIntensity: "energetic" }, "homeService"), {
    hasRealTestimonials: false,
    hasRealTeam: true,
    hasRealImagery: true,
    compositionEvidence: { services: 5, certifications: 2, hasReviews: true, galleryCount: 6 },
  });
}

/** A real, generated wireframe whose evidence is sparse enough to resolve motionBudget "none" — a general-bucket business with no evidence at all. */
function noneWireframe(): Wireframe {
  return generateWireframe(briefFor({ motionIntensity: "restrained" }, "general"), { hasRealTestimonials: false });
}

describe("capability-motion-execution: resolveMotionThroughCapabilities — legacy wireframe (no ExperiencePlan)", () => {
  test("never consults the capability layer — motion equals a direct refineMotion call, capabilityDecisions is empty", () => {
    const wireframe = grantedWireframe();
    const { experiencePlan: _experiencePlan, ...legacyFields } = wireframe;
    const legacyWireframe = legacyFields as Wireframe;

    const direct = refineMotion(legacyWireframe, "energetic");
    const result = resolveMotionThroughCapabilities({ wireframe: legacyWireframe, motionIntensity: "energetic" });

    assert.deepEqual(result.motion, direct);
    assert.deepEqual(result.capabilityDecisions, []);
  });
});

describe("capability-motion-execution: resolveMotionThroughCapabilities — granted basic-motion (real evidence, non-none budget)", () => {
  test("produces the SAME effective output as calling refineMotion directly — the seam never invents a different render", () => {
    const wireframe = grantedWireframe();
    assert.notEqual(wireframe.experiencePlan!.motionBudget, "none");

    const direct = refineMotion(wireframe, "energetic");
    const result = resolveMotionThroughCapabilities({ wireframe, motionIntensity: "energetic" });

    assert.deepEqual(result.motion, direct);
    assert.ok(result.motion.motions.length > 0);
  });

  test("the real capability decision reports basic-motion granted, explainable with a real reason", () => {
    const wireframe = grantedWireframe();
    const result = resolveMotionThroughCapabilities({ wireframe, motionIntensity: "energetic" });
    const decision = result.capabilityDecisions.find((d) => d.token === "basic-motion")!;
    assert.equal(decision.granted, true);
    assert.equal(decision.supportLevel, "High");
    assert.match(decision.reason, /Granted/);
  });
});

describe("capability-motion-execution: resolveMotionThroughCapabilities — motion budget none stays genuinely zero-motion through the integrated path", () => {
  test("motion is empty, capability decision reports NOT granted, and the real experienceMode/motionBudget fields are still correctly set (not the adapter's generic empty shape)", () => {
    const wireframe = noneWireframe();
    assert.equal(wireframe.experiencePlan!.motionBudget, "none");

    const result = resolveMotionThroughCapabilities({ wireframe, motionIntensity: "restrained" });

    assert.deepEqual(result.motion.motions, []);
    assert.deepEqual(result.motion.hover, []);
    assert.deepEqual(result.motion.violations, []);
    assert.equal(result.motion.motionBudget, "none");
    assert.equal(result.motion.experienceMode, wireframe.experiencePlan!.mode);

    const decision = result.capabilityDecisions.find((d) => d.token === "basic-motion")!;
    assert.equal(decision.granted, false);
    assert.equal(decision.supportLevel, "Low");
  });
});

describe("capability-motion-execution: resolveMotionThroughCapabilities — fail-closed, never a crash", () => {
  test("unmet adapter requirements (empty sections, granted plan) fall back to the REAL existing computation — richer than the adapter's own generic fallback shape", () => {
    const wireframe = grantedWireframe();
    const brokenWireframe: Wireframe = { ...wireframe, sections: [] };

    const result = resolveMotionThroughCapabilities({ wireframe: brokenWireframe, motionIntensity: "energetic" });

    // The real refineMotion computation on an empty-sections wireframe still
    // sets experienceMode/motionBudget correctly (proven directly below) —
    // the integration's own fallback must match that, not the adapter's
    // fallback()'s bare {motions: [], hover: [], violations: []} shape
    // (which omits those two fields entirely).
    const direct = refineMotion(brokenWireframe, "energetic");
    assert.deepEqual(result.motion, direct);
    assert.equal(result.motion.motionBudget, wireframe.experiencePlan!.motionBudget);
    assert.equal(result.motion.experienceMode, wireframe.experiencePlan!.mode);
  });

  test("a genuinely throwing adapter execution never propagates — resolveMotionThroughCapabilities always returns a real, valid result", () => {
    const wireframe = grantedWireframe();
    const corrupted = {
      ...wireframe,
      experiencePlan: { ...wireframe.experiencePlan!, motionBudget: "not-a-real-budget" },
    } as unknown as Wireframe;

    assert.doesNotThrow(() => {
      const result = resolveMotionThroughCapabilities({ wireframe: corrupted, motionIntensity: "energetic" });
      assert.deepEqual(result.motion.motions, []);
      assert.deepEqual(result.motion.violations, []);
    });
  });
});

describe("capability-motion-execution: resolveMotionThroughCapabilities — four fixture types, no regression", () => {
  test("trust-authority (lawFirm, subtle budget)", () => {
    const wireframe = generateWireframe(briefFor({ motionIntensity: "restrained" }, "lawFirm"), {
      hasRealTestimonials: false,
      hasRealTeam: true,
    });
    assert.equal(wireframe.experiencePlan!.motionBudget, "subtle");
    const result = resolveMotionThroughCapabilities({ wireframe, motionIntensity: "restrained" });
    assert.deepEqual(result.motion, refineMotion(wireframe, "restrained"));
  });

  test("high-energy-retail (homeService, enhanced budget)", () => {
    const wireframe = generateWireframe(briefFor({ motionIntensity: "energetic" }, "homeService"), {
      hasRealTestimonials: false,
      hasRealImagery: true,
      compositionEvidence: { galleryCount: 6, services: 5 },
    });
    assert.equal(wireframe.experiencePlan!.motionBudget, "enhanced");
    const result = resolveMotionThroughCapabilities({ wireframe, motionIntensity: "energetic" });
    assert.deepEqual(result.motion, refineMotion(wireframe, "energetic"));
  });

  test("cinematic-storytelling (restaurant, cinematic budget)", () => {
    const wireframe = generateWireframe(briefFor({ motionIntensity: "energetic" }, "restaurant"), {
      hasRealTestimonials: false,
      hasRealImagery: true,
      compositionEvidence: { galleryCount: 8, services: 4, hasReviews: true },
    });
    assert.equal(wireframe.experiencePlan!.motionBudget, "cinematic");
    const result = resolveMotionThroughCapabilities({ wireframe, motionIntensity: "energetic" });
    assert.deepEqual(result.motion, refineMotion(wireframe, "energetic"));
  });

  test("sparse general bucket (none budget)", () => {
    const wireframe = noneWireframe();
    assert.equal(wireframe.experiencePlan!.motionBudget, "none");
    const result = resolveMotionThroughCapabilities({ wireframe, motionIntensity: "restrained" });
    assert.deepEqual(result.motion, refineMotion(wireframe, "restrained"));
  });
});
