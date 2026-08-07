import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  GENERIC_SAAS_TEMPLATE_SECTION_ORDER,
  matchesGenericSaasTemplate,
  findDuplicateSectionStructures,
} from "@/lib/design-intelligence/layout-rules";

describe("layout-rules", () => {
  test("matchesGenericSaasTemplate is true for the exact named pattern", () => {
    assert.equal(matchesGenericSaasTemplate([...GENERIC_SAAS_TEMPLATE_SECTION_ORDER]), true);
  });

  test("matchesGenericSaasTemplate is false when sections are reordered or substituted", () => {
    const reordered = [...GENERIC_SAAS_TEMPLATE_SECTION_ORDER].reverse();
    assert.equal(matchesGenericSaasTemplate(reordered), false);

    const substituted = [...GENERIC_SAAS_TEMPLATE_SECTION_ORDER];
    substituted[0] = "editorial-photo-hero";
    assert.equal(matchesGenericSaasTemplate(substituted), false);
  });

  test("matchesGenericSaasTemplate is false for a shorter, editorial structure", () => {
    assert.equal(matchesGenericSaasTemplate(["editorial-photo-hero", "menu-highlights", "footer"]), false);
  });

  test("findDuplicateSectionStructures flags missions sharing an identical structure", () => {
    const duplicates = findDuplicateSectionStructures([
      { missionId: "a", sectionOrder: ["hero", "menu", "footer"] },
      { missionId: "b", sectionOrder: ["hero", "credibility", "footer"] },
      { missionId: "c", sectionOrder: ["hero", "menu", "footer"] },
    ]);
    assert.deepEqual(duplicates, [["a", "c"]]);
  });

  test("findDuplicateSectionStructures returns nothing when every structure is unique", () => {
    const duplicates = findDuplicateSectionStructures([
      { missionId: "a", sectionOrder: ["hero", "menu", "footer"] },
      { missionId: "b", sectionOrder: ["hero", "credibility", "footer"] },
    ]);
    assert.deepEqual(duplicates, []);
  });
});
