import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getCapabilityAdapter, requestCapabilityExecution } from "@/lib/design-intelligence/capability-adapter-registry";
import type { BasicMotionAdapterInput } from "@/lib/design-intelligence/basic-motion-adapter";
import { generateWireframe, type Wireframe } from "@/lib/services/design-generation-service";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { CapabilityToken } from "@/lib/design-intelligence/capability-selector";
import type { CapabilityExecutionResult } from "@/lib/design-intelligence/capability-adapter";
import type { MotionRefinement } from "@/lib/services/design-refinement-service";

function briefFor(): DesignBrief {
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
      motionIntensity: "energetic",
    },
    heroThesis: "Test hero thesis.",
    signatureElement: { element: "service-list-editorial-treatment", justification: "Test justification." },
    contentEmphasis: [],
    referencesConsidered: [],
  };
}

function motionWireframe(): Wireframe {
  return generateWireframe(briefFor(), {
    hasRealTestimonials: false,
    hasRealTeam: true,
    hasRealImagery: true,
    compositionEvidence: { services: 5, certifications: 2, hasReviews: true, galleryCount: 6 },
  });
}

describe("capability-adapter-registry: getCapabilityAdapter", () => {
  test("returns the real registered basic-motion adapter", () => {
    const adapter = getCapabilityAdapter<BasicMotionAdapterInput, MotionRefinement>("basic-motion");
    assert.ok(adapter);
    assert.equal(adapter!.token, "basic-motion");
  });

  test("returns undefined for a token that isn't in the registry — fails closed, never throws", () => {
    const adapter = getCapabilityAdapter("not-a-real-token" as CapabilityToken);
    assert.equal(adapter, undefined);
  });
});

describe("capability-adapter-registry: requestCapabilityExecution — fail-closed at every step", () => {
  test("real, registered token with real requirements met: delegates to the adapter's own execute()", () => {
    const wireframe = motionWireframe();
    const result = requestCapabilityExecution<BasicMotionAdapterInput, MotionRefinement>("basic-motion", {
      wireframe,
      motionIntensity: "energetic",
    });
    assert.ok(result);
    assert.equal(result!.status, "active");
    assert.ok(result!.payload.motions.length > 0);
  });

  test("unregistered token returns null — no crash, nothing invented", () => {
    const result = requestCapabilityExecution("not-a-real-token" as CapabilityToken, { anything: true });
    assert.equal(result, null);
  });

  test("unmet requirements degrade to the adapter's own fallback(), classified requirements-not-met", () => {
    const emptyWireframe: Wireframe = { ...motionWireframe(), sections: [] };
    const result = requestCapabilityExecution<BasicMotionAdapterInput, MotionRefinement>("basic-motion", {
      wireframe: emptyWireframe,
      motionIntensity: "restrained",
    });
    assert.ok(result);
    assert.equal(result!.status, "fallback-active");
    assert.equal(result!.failureReason, "requirements-not-met");
    assert.deepEqual(result!.payload.motions, []);
  });

  test("a throwing execute() degrades to fallback(), classified runtime-error — never propagates the exception", () => {
    // Forces a genuine throw inside refineMotion: requirementsMet only checks
    // for a real, non-empty sections array (so it passes), but the resolved
    // ExperiencePlan carries a motionBudget string outside
    // MOTION_PROFILE_BY_BUDGET's keys — design-refinement-service.ts's own
    // refineMotionFromExperiencePlan indexes that table unconditionally for
    // any non-"none" budget, so an unrecognized one throws deep inside
    // execute(), proving the REGISTRY's try/catch, not just the adapter's
    // own well-behaved path.
    const wireframe = motionWireframe();
    const brokenWireframe = {
      ...wireframe,
      experiencePlan: { ...wireframe.experiencePlan!, motionBudget: "not-a-real-budget" },
    } as unknown as Wireframe;

    const result = requestCapabilityExecution<BasicMotionAdapterInput, MotionRefinement>("basic-motion", {
      wireframe: brokenWireframe,
      motionIntensity: "restrained",
    });
    assert.ok(result);
    assert.equal(result!.status, "fallback-active");
    assert.equal(result!.failureReason, "runtime-error");
    assert.deepEqual(result!.payload.motions, []);
  });
});

describe("capability-adapter-registry: full round trip proves the seam (Selector grant -> Adapter execution -> real motion output)", () => {
  test("a business whose real evidence earns a non-none motion budget gets a real, active basic-motion execution through the registry", () => {
    const wireframe = motionWireframe();
    assert.ok(wireframe.experiencePlan, "fixture must carry a real resolved ExperiencePlan");
    assert.notEqual(wireframe.experiencePlan!.motionBudget, "none");

    const result: CapabilityExecutionResult<MotionRefinement> | null = requestCapabilityExecution(
      "basic-motion",
      { wireframe, motionIntensity: "energetic" } satisfies BasicMotionAdapterInput
    );
    assert.ok(result);
    assert.equal(result!.status, "active");
  });
});
