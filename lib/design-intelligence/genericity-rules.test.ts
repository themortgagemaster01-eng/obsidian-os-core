import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { findGenericPhrases, findDuplicateDesignSignatures } from "@/lib/design-intelligence/genericity-rules";

describe("genericity-rules", () => {
  test("findGenericPhrases flags known hollow marketing filler", () => {
    const hits = findGenericPhrases("We are committed to quality and your satisfaction is our top priority.");
    assert.ok(hits.includes("committed to quality"));
    assert.ok(hits.includes("your satisfaction is our"));
  });

  test("findGenericPhrases is case-insensitive", () => {
    assert.deepEqual(findGenericPhrases("STATE-OF-THE-ART facility"), ["state-of-the-art"]);
  });

  test("findGenericPhrases flags a generic 'Welcome to...' headline opener (CTO Design Brain amendment)", () => {
    assert.ok(findGenericPhrases("Welcome to Acme HVAC").includes("welcome to"));
  });

  test("findGenericPhrases returns nothing for evidence-grounded copy", () => {
    assert.deepEqual(
      findGenericPhrases("Family-owned since 1974, serving pastrami on rye across three generations."),
      []
    );
  });

  test("findGenericPhrases does not false-positive on a shared word alone", () => {
    // "quality" alone is not banned — only the specific hollow phrase "committed to quality" is.
    assert.deepEqual(findGenericPhrases("Our HVAC technicians hold three EPA quality certifications."), []);
  });

  test("findDuplicateDesignSignatures flags missions sharing an identical hero thesis", () => {
    const result = findDuplicateDesignSignatures([
      { missionId: "a", heroThesis: "The neighborhood's trusted HVAC team since 1998.", signatureElement: "credibility-certification-display" },
      { missionId: "b", heroThesis: "Family-run landscaping crew serving three counties.", signatureElement: "gallery-atmosphere-treatment" },
      { missionId: "c", heroThesis: "The neighborhood's trusted HVAC team since 1998.", signatureElement: "service-list-editorial-treatment" },
    ]);
    assert.deepEqual(result.duplicateHeroThesis, [["a", "c"]]);
    assert.deepEqual(result.duplicateSignatureElement, []);
  });

  test("findDuplicateDesignSignatures flags missions sharing an identical signature element", () => {
    const result = findDuplicateDesignSignatures([
      { missionId: "a", heroThesis: "Thesis A", signatureElement: "gallery-atmosphere-treatment" },
      { missionId: "b", heroThesis: "Thesis B", signatureElement: "gallery-atmosphere-treatment" },
    ]);
    assert.deepEqual(result.duplicateSignatureElement, [["a", "b"]]);
  });

  test("findDuplicateDesignSignatures normalizes case/whitespace before comparing", () => {
    const result = findDuplicateDesignSignatures([
      { missionId: "a", heroThesis: "  Trusted HVAC team  ", signatureElement: "x" },
      { missionId: "b", heroThesis: "trusted hvac team", signatureElement: "y" },
    ]);
    assert.deepEqual(result.duplicateHeroThesis, [["a", "b"]]);
  });

  test("findDuplicateDesignSignatures never flags empty heroThesis/signatureElement as duplicates — legacy/failed-run rows are 'no data,' not a real match", () => {
    const result = findDuplicateDesignSignatures([
      { missionId: "a", heroThesis: "", signatureElement: "" },
      { missionId: "b", heroThesis: "", signatureElement: "" },
      { missionId: "c", heroThesis: "   ", signatureElement: "gallery-atmosphere-treatment" },
    ]);
    assert.deepEqual(result.duplicateHeroThesis, []);
    assert.deepEqual(result.duplicateSignatureElement, []);
  });

  test("findDuplicateDesignSignatures returns nothing when every entry is unique", () => {
    const result = findDuplicateDesignSignatures([
      { missionId: "a", heroThesis: "Thesis A", signatureElement: "x" },
      { missionId: "b", heroThesis: "Thesis B", signatureElement: "y" },
    ]);
    assert.deepEqual(result.duplicateHeroThesis, []);
    assert.deepEqual(result.duplicateSignatureElement, []);
  });
});
