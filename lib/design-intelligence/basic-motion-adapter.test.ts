import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { basicMotionAdapter, type BasicMotionAdapterInput } from "@/lib/design-intelligence/basic-motion-adapter";
import { refineMotion } from "@/lib/services/design-refinement-service";
import { generateWireframe, type Wireframe } from "@/lib/services/design-generation-service";
import type { DesignBrief } from "@/lib/services/design-brief-service";

function briefFor(overrides: Partial<DesignBrief["direction"]> = {}, industryBucket: DesignBrief["industryBucket"] = "general"): DesignBrief {
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

/** Real generated wireframe with a real, resolved ExperiencePlan carrying a non-"none" motion budget — mirrors design-refinement-service.test.ts's own experienceWireframeFor recipe. */
function motionWireframe(): Wireframe {
  return generateWireframe(briefFor({ motionIntensity: "energetic" }, "homeService"), {
    hasRealTestimonials: false,
    hasRealTeam: true,
    hasRealImagery: true,
    compositionEvidence: { services: 5, certifications: 2, hasReviews: true, galleryCount: 6 },
  });
}

describe("basic-motion-adapter: requirementsMet", () => {
  test("true for a real wireframe with a non-empty sections array", () => {
    const input: BasicMotionAdapterInput = { wireframe: motionWireframe(), motionIntensity: "energetic" };
    assert.equal(basicMotionAdapter.requirementsMet(input), true);
  });

  test("false when sections is empty — defensive, even though the registry never calls this for an ungranted token", () => {
    const emptyWireframe: Wireframe = { ...motionWireframe(), sections: [] };
    const input: BasicMotionAdapterInput = { wireframe: emptyWireframe, motionIntensity: "restrained" };
    assert.equal(basicMotionAdapter.requirementsMet(input), false);
  });
});

describe("basic-motion-adapter: execute — wraps the EXISTING refineMotion/scroll-reveal system, never reimplements it", () => {
  test("execute's payload is byte-identical to calling refineMotion directly on the same wireframe/intensity", () => {
    const wireframe = motionWireframe();
    const direct = refineMotion(wireframe, "energetic");
    const viaAdapter = basicMotionAdapter.execute({ wireframe, motionIntensity: "energetic" });

    assert.equal(viaAdapter.status, "active");
    assert.equal(viaAdapter.token, "basic-motion");
    assert.deepEqual(viaAdapter.payload, direct);
  });

  test("existing motion behavior (real motion entries, no violations) still comes through the adapter", () => {
    const wireframe = motionWireframe();
    const result = basicMotionAdapter.execute({ wireframe, motionIntensity: "energetic" });
    assert.ok(result.payload.motions.length > 0);
    assert.deepEqual(result.payload.violations, []);
  });
});

describe("basic-motion-adapter: fallback — fail closed, never a crash, never a broken page", () => {
  test("produces a genuinely empty, valid MotionRefinement — the same zero-motion shape the real 'none' budget path already produces", () => {
    const result = basicMotionAdapter.fallback({ wireframe: motionWireframe(), motionIntensity: "restrained" }, "requirements-not-met");
    assert.equal(result.status, "fallback-active");
    assert.equal(result.failureReason, "requirements-not-met");
    assert.deepEqual(result.payload.motions, []);
    assert.deepEqual(result.payload.hover, []);
    assert.deepEqual(result.payload.violations, []);
  });
});

describe("basic-motion-adapter: reducedMotionStrategy and failure classification", () => {
  test("declares gate-initialization — matches scroll-reveal.ts's own real, existing reduced-motion discipline", () => {
    assert.equal(basicMotionAdapter.reducedMotionStrategy, "gate-initialization");
  });

  test("possibleFailureReasons is a real, non-empty subset of the closed failure vocabulary", () => {
    assert.ok(basicMotionAdapter.possibleFailureReasons.length > 0);
    for (const reason of basicMotionAdapter.possibleFailureReasons) {
      assert.ok(["adapter-not-registered", "requirements-not-met", "runtime-error"].includes(reason));
    }
  });
});

describe("basic-motion-adapter: qaContract — never reports active when a fallback is actually showing", () => {
  test("active execution reports expected === actual === basic-motion, status active", () => {
    const wireframe = motionWireframe();
    const result = basicMotionAdapter.execute({ wireframe, motionIntensity: "energetic" });
    const qa = basicMotionAdapter.qaContract(result);
    assert.deepEqual(qa, { expected: "basic-motion", actual: "basic-motion", status: "active" });
  });

  test("fallback execution reports actual as static-fallback, never the token name, status degraded-but-valid", () => {
    const result = basicMotionAdapter.fallback({ wireframe: motionWireframe(), motionIntensity: "restrained" }, "runtime-error");
    const qa = basicMotionAdapter.qaContract(result);
    assert.deepEqual(qa, { expected: "basic-motion", actual: "static-fallback", status: "degraded-but-valid" });
  });
});
