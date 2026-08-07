import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NEVER_GENERATE_RULES,
  findNeverGenerateRule,
} from "@/lib/design-intelligence/never-generate-rules";

describe("never-generate-rules", () => {
  test("encodes all ten entries from DESIGN_INTELLIGENCE.md §11", () => {
    assert.equal(NEVER_GENERATE_RULES.length, 10);
  });

  test("every rule has a non-empty id, neverGenerate statement, and positive alternative", () => {
    for (const rule of NEVER_GENERATE_RULES) {
      assert.ok(rule.id.trim().length > 0);
      assert.ok(rule.neverGenerate.trim().length > 0);
      assert.ok(rule.positiveAlternative.trim().length > 0);
    }
  });

  test("rule ids are unique", () => {
    const ids = NEVER_GENERATE_RULES.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("findNeverGenerateRule looks up the template-looking-pages rule", () => {
    const rule = findNeverGenerateRule("template-looking-pages");
    assert.ok(rule);
    assert.match(rule!.neverGenerate, /Template-looking pages/);
  });

  test("findNeverGenerateRule returns undefined for an unknown id", () => {
    assert.equal(findNeverGenerateRule("not-a-real-rule"), undefined);
  });
});
