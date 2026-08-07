import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DESIGN_PRINCIPLES,
  findDesignPrinciple,
  DEFAULT_SPACING_SCALE,
  MIN_SPACING_SCALE_STEPS,
  validateSpacingScale,
} from "@/lib/design-intelligence/design-rules";

describe("design-rules", () => {
  test("every design principle has a non-empty id, statement, and reference", () => {
    assert.ok(DESIGN_PRINCIPLES.length > 0);
    for (const principle of DESIGN_PRINCIPLES) {
      assert.ok(principle.id.trim().length > 0);
      assert.ok(principle.statement.trim().length > 0);
      assert.ok(principle.reference.trim().length > 0);
    }
  });

  test("design principle ids are unique", () => {
    const ids = DESIGN_PRINCIPLES.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("findDesignPrinciple looks up by id, and returns undefined for an unknown one", () => {
    const found = findDesignPrinciple("whitespace-is-active");
    assert.ok(found);
    assert.equal(found?.reference, "DESIGN_INTELLIGENCE.md §2, §4");
    assert.equal(findDesignPrinciple("not-a-real-principle"), undefined);
  });

  test("the default spacing scale passes its own validator", () => {
    assert.deepEqual(validateSpacingScale(DEFAULT_SPACING_SCALE), []);
  });

  test("rejects a scale with too few steps", () => {
    const errors = validateSpacingScale({ steps: [1, 2] });
    assert.ok(errors.some((e) => e.includes(String(MIN_SPACING_SCALE_STEPS))));
  });

  test("rejects a scale with non-ascending steps", () => {
    const errors = validateSpacingScale({ steps: [1, 2, 4, 3, 8] });
    assert.ok(errors.some((e) => e.includes("ascending")));
  });

  test("rejects a scale with duplicate steps", () => {
    const errors = validateSpacingScale({ steps: [1, 2, 2, 4, 8] });
    assert.ok(errors.some((e) => e.includes("duplicate")));
  });

  test("rejects a scale with a non-positive step", () => {
    const errors = validateSpacingScale({ steps: [0, 1, 2, 4] });
    assert.ok(errors.some((e) => e.includes("positive")));
  });
});
