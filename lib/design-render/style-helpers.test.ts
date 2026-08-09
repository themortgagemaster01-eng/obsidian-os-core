import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { refineDesign } from "@/lib/services/design-refinement-service";
import { generateWireframe } from "@/lib/services/design-generation-service";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import {
  findSectionSpacing,
  findSectionMotion,
  findTypeRole,
  findTouchTarget,
  remToPx,
  SECTION_HEADING_LABEL,
} from "@/lib/design-render/style-helpers";

function briefFor(): DesignBrief {
  return {
    missionId: "mission-1",
    businessName: "Acme Co",
    websiteUrl: "https://acme.test",
    industry: null,
    industryBucket: "restaurant",
    citedInsights: [],
    targetAudience: "Test audience",
    positioning: "Test positioning",
    direction: {
      layoutFamily: "imagery-led",
      typographicMood: "test mood",
      colorDirection: "test color direction",
      motionIntensity: "restrained",
    },
    referencesConsidered: [],
  };
}

describe("style-helpers", () => {
  const brief = briefFor();
  const wireframe = generateWireframe(brief, { hasRealTestimonials: false });
  const refined = refineDesign({ wireframe }, brief, null);

  test("findSectionSpacing returns a real entry for every section actually in the wireframe", () => {
    for (const { type } of wireframe.sections) {
      assert.ok(findSectionSpacing(refined, type), `expected spacing for ${type}`);
    }
  });

  test("findSectionMotion has no entry for footer (NO_MOTION_SECTIONS) but does for hero", () => {
    assert.equal(findSectionMotion(refined, "footer"), undefined);
    assert.ok(findSectionMotion(refined, "hero"));
  });

  test("findTypeRole looks up display and body roles", () => {
    assert.equal(findTypeRole(refined, "display")?.role, "display");
    assert.equal(findTypeRole(refined, "body")?.role, "body");
  });

  test("findTouchTarget returns a sized target for hero, undefined for footer", () => {
    const heroTarget = findTouchTarget(refined, "hero");
    assert.ok(heroTarget);
    assert.ok(heroTarget!.widthPx > 0);
    assert.equal(findTouchTarget(refined, "footer"), undefined);
  });

  test("remToPx converts using a 16px base", () => {
    assert.equal(remToPx(1), 16);
    assert.equal(remToPx(2.5), 40);
  });

  test("SECTION_HEADING_LABEL has an entry for every SectionType used in this wireframe", () => {
    for (const { type } of wireframe.sections) {
      assert.equal(typeof SECTION_HEADING_LABEL[type], "string");
    }
  });
});
