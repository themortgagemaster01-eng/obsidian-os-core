import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TYPE_FAMILIES,
  TYPE_ROLE_ORDER,
  DEFAULT_TYPE_SCALE,
  READABILITY,
  validateTypeScaleOrdering,
  validateTypographyChoice,
} from "@/lib/design-intelligence/typography-rules";

describe("typography-rules", () => {
  test("the default type scale covers every role in TYPE_ROLE_ORDER", () => {
    const roles = DEFAULT_TYPE_SCALE.map((s) => s.role);
    for (const role of TYPE_ROLE_ORDER) {
      assert.ok(roles.includes(role), `missing role: ${role}`);
    }
  });

  test("the default type scale passes its own ordering validator", () => {
    assert.deepEqual(validateTypeScaleOrdering(DEFAULT_TYPE_SCALE), []);
  });

  test("flags a scale missing a required role", () => {
    const incomplete = DEFAULT_TYPE_SCALE.filter((s) => s.role !== "heading3");
    const errors = validateTypeScaleOrdering(incomplete);
    assert.ok(errors.some((e) => e.includes("heading3")));
  });

  test("flags a scale where a later role is larger than an earlier one", () => {
    const broken = DEFAULT_TYPE_SCALE.map((s) => (s.role === "body" ? { ...s, relativeSize: 5 } : s));
    const errors = validateTypeScaleOrdering(broken);
    assert.ok(errors.some((e) => e.includes("heading3") && e.includes("body")));
  });

  test("accepts a valid typography choice", () => {
    const errors = validateTypographyChoice({
      families: ["Fraunces", "Inter"],
      bodyLineLengthChars: 65,
      bodyLineHeight: 1.5,
    });
    assert.deepEqual(errors, []);
  });

  test("rejects more than MAX_TYPE_FAMILIES distinct families", () => {
    const errors = validateTypographyChoice({
      families: ["Fraunces", "Inter", "Georgia"],
      bodyLineLengthChars: 65,
      bodyLineHeight: 1.5,
    });
    assert.ok(errors.some((e) => e.includes(String(MAX_TYPE_FAMILIES))));
  });

  test("rejects body line length outside the readable range", () => {
    const tooShort = validateTypographyChoice({
      families: ["Inter"],
      bodyLineLengthChars: 30,
      bodyLineHeight: 1.5,
    });
    assert.ok(tooShort.some((e) => e.includes("line length")));

    const tooLong = validateTypographyChoice({
      families: ["Inter"],
      bodyLineLengthChars: 100,
      bodyLineHeight: 1.5,
    });
    assert.ok(tooLong.some((e) => e.includes("line length")));
  });

  test("rejects body line-height outside the readable range", () => {
    const errors = validateTypographyChoice({
      families: ["Inter"],
      bodyLineLengthChars: 65,
      bodyLineHeight: 1.1,
    });
    assert.ok(errors.some((e) => e.includes("line-height")));
  });

  test("READABILITY bounds match §3's stated range", () => {
    assert.equal(READABILITY.bodyLineLengthCharsMin, 45);
    assert.equal(READABILITY.bodyLineLengthCharsMax, 75);
    assert.equal(READABILITY.bodyLineHeightMin, 1.4);
    assert.equal(READABILITY.bodyLineHeightMax, 1.6);
  });
});
