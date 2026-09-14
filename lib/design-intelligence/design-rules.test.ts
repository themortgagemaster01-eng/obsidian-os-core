import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DESIGN_PRINCIPLES,
  findDesignPrinciple,
  DEFAULT_SPACING_SCALE,
  COMPACT_SPACING_SCALE,
  GENEROUS_SPACING_SCALE,
  SPACING_SCALE_VARIANTS,
  MIN_SPACING_SCALE_STEPS,
  validateSpacingScale,
  resolveSpacingScaleIntent,
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

/**
 * Phase 16 — Design Intelligence Gap Map, Fix #4 (adaptive spacing scale).
 * resolveSpacingScaleIntent is the one new decision point this fix adds —
 * every SPACING_SCALE_VARIANTS entry must independently satisfy the exact
 * same guardrails DEFAULT_SPACING_SCALE always has, and the resolver itself
 * must default to "standard" (== today's exact pre-existing behavior)
 * whenever the signal is missing or ambiguous.
 */
describe("design-rules: SPACING_SCALE_VARIANTS (Fix #4)", () => {
  test("every variant passes its own validator", () => {
    for (const [intent, scale] of Object.entries(SPACING_SCALE_VARIANTS)) {
      assert.deepEqual(validateSpacingScale(scale), [], `${intent} must pass validation with zero violations`);
    }
  });

  test("compact and generous are real, distinct scales — not aliases of standard, and genuinely change the scale itself, not just an index within it", () => {
    assert.notDeepEqual(COMPACT_SPACING_SCALE, DEFAULT_SPACING_SCALE);
    assert.notDeepEqual(GENEROUS_SPACING_SCALE, DEFAULT_SPACING_SCALE);
    assert.notDeepEqual(COMPACT_SPACING_SCALE, GENEROUS_SPACING_SCALE);
    // Every step index actually consumed by design-refinement-service.ts's
    // refineSpacing (1, 3, 5, 7, 9) must differ from the default at that
    // same index in both variants — a real change to the rhythm itself, not
    // a relabeling of the same numbers.
    for (const i of [1, 3, 5, 7, 9]) {
      assert.notEqual(COMPACT_SPACING_SCALE.steps[i], DEFAULT_SPACING_SCALE.steps[i], `compact step ${i} must differ from standard`);
      assert.notEqual(GENEROUS_SPACING_SCALE.steps[i], DEFAULT_SPACING_SCALE.steps[i], `generous step ${i} must differ from standard`);
      assert.ok(COMPACT_SPACING_SCALE.steps[i] < DEFAULT_SPACING_SCALE.steps[i], `compact step ${i} must be tighter than standard`);
      assert.ok(GENEROUS_SPACING_SCALE.steps[i] > DEFAULT_SPACING_SCALE.steps[i], `generous step ${i} must be more generous than standard`);
    }
  });

  test("SPACING_SCALE_VARIANTS.standard is DEFAULT_SPACING_SCALE itself, not a copy with different values", () => {
    assert.equal(SPACING_SCALE_VARIANTS.standard, DEFAULT_SPACING_SCALE);
  });
});

describe("design-rules: resolveSpacingScaleIntent (Fix #4)", () => {
  test("no spacing information at all resolves to the safe default (standard)", () => {
    assert.equal(resolveSpacingScaleIntent(undefined), "standard");
    assert.equal(resolveSpacingScaleIntent(null), "standard");
    assert.equal(resolveSpacingScaleIntent({}), "standard");
    assert.equal(resolveSpacingScaleIntent({ baseUnit: "", notes: "" }), "standard");
  });

  test("real, closed-vocabulary generous language resolves to generous — the exact shape real DesignMemory rows in this database actually use", () => {
    const intent = resolveSpacingScaleIntent({
      baseUnit: "8px",
      notes: "Generous section spacing so photography has room to breathe; avoids the cramped, budget-feeling density the old site implied.",
    });
    assert.equal(intent, "generous");
  });

  test("real, closed-vocabulary compact language resolves to compact", () => {
    const intent = resolveSpacingScaleIntent({
      baseUnit: "4px",
      notes: "A compact, space-efficient rhythm given how much real menu content needs to fit per section.",
    });
    assert.equal(intent, "compact");
  });

  test("ambiguous text matching BOTH keyword sets resolves to the safe default, never a coin flip", () => {
    const intent = resolveSpacingScaleIntent({
      baseUnit: "8px",
      notes: "A compact layout in most places but generous around the hero photograph.",
    });
    assert.equal(intent, "standard");
  });

  test("generic, non-matching prose (a real shape some missions produce) resolves to the safe default", () => {
    const intent = resolveSpacingScaleIntent({
      baseUnit: "8px",
      notes: "A single consistent unit applied throughout the page.",
    });
    assert.equal(intent, "standard");
  });

  test("only scans DesignMemory.spacingScale's own text — never parses a number out of the prose", () => {
    const intent = resolveSpacingScaleIntent({
      baseUnit: "8px",
      notes: "Section padding should be exactly 96px and component padding exactly 24px.",
    });
    assert.equal(intent, "standard");
  });
});

// ===========================================================================
// Fix #11 spacing negation (2026-09-14).
//
// The full 12-mission production audit found every real mission writes
// unambiguously generous spacing prose, yet 4 of 12 (33%) fell back to
// "standard" — not from a vocabulary gap, but because a compact keyword
// sitting inside an explicitly NEGATED phrase was counted as positive
// evidence for a compact scale, which then cancelled the real generous
// intent via the matched-and-not-the-other rule. All four fixtures below are
// the missions' own real, unedited DesignMemory.spacingScale.notes.
// ===========================================================================
describe("design-rules: resolveSpacingScaleIntent (Fix #11 — negated terms are not positive evidence)", () => {
  const REAL_REGRESSION_FIXTURES: { mission: string; notes: string }[] = [
    {
      mission: "Countryside Kitchen",
      notes:
        "Generous whitespace framing each photograph and menu highlight so the page feels like a place, not a dense listing.",
    },
    {
      mission: "Station Plaza Wine r2",
      notes:
        "Generous whitespace around photography so images breathe; avoid cramming multiple photo grids tightly — let the shop's real images be the resting point for the eye.",
    },
    {
      mission: "Video Game Plus A",
      notes:
        "Generous multiples (24/40/64/96px) between the two service groups and hero to give each real offering room to breathe rather than compressing them into a dense list.",
    },
    {
      mission: "Joseph J. Smith Funeral Home",
      notes:
        "Generous vertical rhythm between the few sections that exist; whitespace itself communicates care rather than emptiness — no dense stacking of content that isn't there.",
    },
  ];

  for (const { mission, notes } of REAL_REGRESSION_FIXTURES) {
    test(`real production fixture — ${mission} now resolves generous instead of falling back to standard`, () => {
      assert.equal(resolveSpacingScaleIntent({ baseUnit: "8px", notes }), "generous");
    });
  }

  test("every negation shape present in the real evidence is recognized", () => {
    // "not X" / "no X" / "rather than X" / "avoid ... X-ly" — the four real shapes.
    assert.equal(resolveSpacingScaleIntent({ notes: "Generous rhythm, not a dense grid" }), "generous");
    assert.equal(resolveSpacingScaleIntent({ notes: "Generous rhythm — no dense stacking" }), "generous");
    assert.equal(resolveSpacingScaleIntent({ notes: "Generous rhythm rather than a dense list" }), "generous");
    assert.equal(resolveSpacingScaleIntent({ notes: "Generous rhythm; avoid packing the grids tightly" }), "generous");
    assert.equal(resolveSpacingScaleIntent({ notes: "Generous rhythm instead of a compact grid" }), "generous");
    assert.equal(resolveSpacingScaleIntent({ notes: "Generous rhythm without dense stacking" }), "generous");
  });

  // -------------------------------------------------------------------------
  // Positive matching must be completely unchanged. No real mission in the
  // 12-record population ever asks for a compact scale (compact was 0/12), so
  // these are deliberately synthetic — the one direction the real production
  // data cannot cover.
  // -------------------------------------------------------------------------
  test("positive compact language still resolves compact — unchanged by this fix", () => {
    assert.equal(resolveSpacingScaleIntent({ notes: "A compact, space-efficient scale" }), "compact");
    assert.equal(resolveSpacingScaleIntent({ notes: "Tight vertical rhythm with condensed section padding" }), "compact");
    assert.equal(resolveSpacingScaleIntent({ baseUnit: "4px", notes: "Dense, efficient use of space throughout" }), "compact");
  });

  test("positive generous language still resolves generous — unchanged by this fix", () => {
    assert.equal(resolveSpacingScaleIntent({ notes: "Generous whitespace throughout" }), "generous");
    assert.equal(resolveSpacingScaleIntent({ notes: "Airy, spacious sections with room to breathe" }), "generous");
  });

  test("at least one UN-negated occurrence still counts — a negated mention elsewhere never suppresses a real one", () => {
    assert.equal(resolveSpacingScaleIntent({ notes: "Use a compact scale, not a dense grid" }), "compact");
  });

  test("a negation never carries across a clause boundary", () => {
    // The "avoid" belongs to the next clause and must not negate "dense".
    assert.equal(resolveSpacingScaleIntent({ notes: "Keep it dense; avoid wasted space" }), "compact");
  });

  test("a genuine both-directions conflict still resolves standard — the ambiguity rule itself is unchanged", () => {
    assert.equal(resolveSpacingScaleIntent({ notes: "Generous hero spacing with a compact, dense footer" }), "standard");
  });

  test("negation is symmetric — a negated generous term is not positive evidence for generous either", () => {
    assert.equal(resolveSpacingScaleIntent({ notes: "Not a generous layout — keep it dense and condensed" }), "compact");
  });

  test("empty/missing input still falls back to standard, exactly as before", () => {
    assert.equal(resolveSpacingScaleIntent(null), "standard");
    assert.equal(resolveSpacingScaleIntent(undefined), "standard");
    assert.equal(resolveSpacingScaleIntent({ notes: "" }), "standard");
    assert.equal(resolveSpacingScaleIntent({ notes: "A considered, deliberate rhythm" }), "standard");
  });
});
