import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  REFERENCE_LIBRARY,
  resolveIndustryBucket,
  selectReferenceDirections,
  selectPrimaryReferenceDirection,
  type IndustryBucket,
} from "@/lib/design-references/reference-library";

const ALL_BUCKETS: IndustryBucket[] = [
  "restaurant",
  "lawFirm",
  "dentistMedical",
  "homeService",
  "realEstate",
  "fitness",
  "luxuryServices",
  "general",
];

describe("reference-library", () => {
  test("every reference direction has a non-empty id/description and exactly-one-primary-per-bucket invariant holds", () => {
    for (const entry of REFERENCE_LIBRARY) {
      assert.ok(entry.id.trim().length > 0);
      assert.ok(entry.description.trim().length > 0);
      assert.ok(entry.positioningEmphasis.trim().length > 0);
    }

    const ids = REFERENCE_LIBRARY.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, "reference ids must be unique");

    for (const bucket of ALL_BUCKETS) {
      const primaryCount = REFERENCE_LIBRARY.filter((r) => r.industryBucket === bucket && r.primary).length;
      assert.equal(primaryCount, 1, `bucket "${bucket}" should have exactly one primary reference`);
    }
  });

  test("every bucket has at least one reference direction", () => {
    for (const bucket of ALL_BUCKETS) {
      assert.ok(selectReferenceDirections(bucket).length > 0, `no references for bucket "${bucket}"`);
    }
  });

  test("selectReferenceDirections returns the primary entry first", () => {
    const directions = selectReferenceDirections("restaurant");
    assert.equal(directions[0].primary, true);
  });

  test("selectPrimaryReferenceDirection resolves for every bucket", () => {
    for (const bucket of ALL_BUCKETS) {
      const primary = selectPrimaryReferenceDirection(bucket);
      assert.ok(primary, `no primary reference resolved for "${bucket}"`);
      assert.equal(primary?.industryBucket, bucket);
    }
  });

  test("resolveIndustryBucket classifies known industries", () => {
    assert.equal(resolveIndustryBucket("Italian Restaurant", null), "restaurant");
    assert.equal(resolveIndustryBucket(null, "Law Firm"), "lawFirm");
    assert.equal(resolveIndustryBucket("Family Dental Clinic", null), "dentistMedical");
    assert.equal(resolveIndustryBucket("Residential HVAC", null), "homeService");
    assert.equal(resolveIndustryBucket("Real Estate Agency", null), "realEstate");
    assert.equal(resolveIndustryBucket("Boutique Fitness Studio", null), "fitness");
    assert.equal(resolveIndustryBucket("Luxury Concierge Services", null), "luxuryServices");
  });

  test("resolveIndustryBucket falls back to general for null, empty, or unmatched text", () => {
    assert.equal(resolveIndustryBucket(null, null), "general");
    assert.equal(resolveIndustryBucket("  ", ""), "general");
    assert.equal(resolveIndustryBucket("Widget Manufacturing", "Industrial Supplies"), "general");
  });

  test("resolveIndustryBucket checks businessCategory when industry doesn't match", () => {
    assert.equal(resolveIndustryBucket("Downtown Services LLC", "HVAC repair"), "homeService");
  });
});
