import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TYPE_FAMILIES,
  TYPE_ROLE_ORDER,
  DEFAULT_TYPE_SCALE,
  COMPACT_TYPE_SCALE,
  DISPLAY_LED_TYPE_SCALE,
  TYPE_SCALE_VARIANTS,
  READABILITY,
  validateTypeScaleOrdering,
  validateTypographyChoice,
  resolveTypeScaleIntent,
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

/**
 * Phase 15 — Design Intelligence Gap Map, Fix #1 (typography scale
 * adaptation). resolveTypeScaleIntent is the one new decision point this
 * fix adds — every TYPE_SCALE_VARIANTS entry must independently satisfy
 * the exact same guardrails DEFAULT_TYPE_SCALE always has, and the
 * resolver itself must default to "editorial" (== today's exact
 * pre-existing behavior) whenever the signal is missing or ambiguous.
 */
describe("typography-rules: TYPE_SCALE_VARIANTS (Fix #1)", () => {
  test("every variant covers every role in TYPE_ROLE_ORDER and passes its own ordering validator", () => {
    for (const [intent, spec] of Object.entries(TYPE_SCALE_VARIANTS)) {
      const roles = spec.map((s) => s.role);
      for (const role of TYPE_ROLE_ORDER) {
        assert.ok(roles.includes(role), `${intent} is missing role: ${role}`);
      }
      assert.deepEqual(validateTypeScaleOrdering(spec), [], `${intent} must pass ordering validation with zero violations`);
    }
  });

  test("compact and display-led are real, distinct scales — not aliases of editorial", () => {
    assert.notDeepEqual(COMPACT_TYPE_SCALE, DEFAULT_TYPE_SCALE);
    assert.notDeepEqual(DISPLAY_LED_TYPE_SCALE, DEFAULT_TYPE_SCALE);
    assert.notDeepEqual(COMPACT_TYPE_SCALE, DISPLAY_LED_TYPE_SCALE);
  });

  test("TYPE_SCALE_VARIANTS.editorial is DEFAULT_TYPE_SCALE itself, not a copy with different values", () => {
    assert.deepEqual(TYPE_SCALE_VARIANTS.editorial, DEFAULT_TYPE_SCALE);
  });
});

describe("typography-rules: resolveTypeScaleIntent (Fix #1)", () => {
  test("no typography information at all resolves to the safe default (editorial)", () => {
    assert.equal(resolveTypeScaleIntent(undefined), "editorial");
    assert.equal(resolveTypeScaleIntent(null), "editorial");
    assert.equal(resolveTypeScaleIntent({}), "editorial");
    assert.equal(resolveTypeScaleIntent({ headingFamily: "", bodyFamily: "", scaleNotes: "" }), "editorial");
  });

  test("real, closed-vocabulary compact language resolves to compact", () => {
    const intent = resolveTypeScaleIntent({
      headingFamily: "A clean, understated sans",
      bodyFamily: "Inter",
      scaleNotes: "A compact, space-efficient hierarchy given how much real menu content needs to fit per section.",
    });
    assert.equal(intent, "compact");
  });

  test("real, closed-vocabulary display-led language resolves to display-led", () => {
    const intent = resolveTypeScaleIntent({
      headingFamily: "A bold serif display face for headlines",
      bodyFamily: "Inter",
      scaleNotes: "A striking, commanding display headline given the strength of the real photography.",
    });
    assert.equal(intent, "display-led");
  });

  test("ambiguous text matching BOTH keyword sets resolves to the safe default, never a coin flip", () => {
    const intent = resolveTypeScaleIntent({
      headingFamily: "A compact but also striking display face",
      bodyFamily: "Inter",
      scaleNotes: "",
    });
    assert.equal(intent, "editorial");
  });

  test("generic, non-matching prose (the exact real shape most missions produce) resolves to the safe default", () => {
    const intent = resolveTypeScaleIntent({
      headingFamily: "A warm humanist serif for headlines and section titles",
      bodyFamily: "A clean, high-legibility sans-serif for body copy",
      scaleNotes: "Clear two-step hierarchy with generous line-height for readability.",
    });
    assert.equal(intent, "editorial");
  });

  test("only scans DesignMemory.typography's own text — never parses a number out of the prose", () => {
    // A scaleNotes mentioning literal pixel numbers must not influence the
    // outcome at all; only the closed keyword vocabulary can.
    const intent = resolveTypeScaleIntent({
      headingFamily: "Georgia",
      bodyFamily: "Arial",
      scaleNotes: "Display should be exactly 96px and body exactly 22px, a 4.36x ratio.",
    });
    assert.equal(intent, "editorial");
  });
});
