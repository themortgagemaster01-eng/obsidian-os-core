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

  test("resolveIndustryBucket falls back to real structural menu evidence when industry/category are empty", () => {
    // janebond.ca (Phase 4.8/4.9): companies.industry and business_category
    // were both null, but the crawler structurally found a real menu with
    // real "FOOD"/"DRINK" category labels — that's stronger evidence than
    // an absent text field, and should classify as "restaurant" without any
    // business-name-specific branch.
    assert.equal(resolveIndustryBucket(null, null, ["FOOD", "DRINK"]), "restaurant");
    assert.equal(resolveIndustryBucket("  ", "", ["Appetizers", "Entrees", "Desserts"]), "restaurant");
  });

  test("resolveIndustryBucket ignores menu evidence when industry/category already matched", () => {
    // Text-based classification still wins when it succeeds — the menu
    // fallback only applies once text classification is inconclusive.
    assert.equal(resolveIndustryBucket("Boutique Fitness Studio", null, ["FOOD", "DRINK"]), "fitness");
  });

  test("resolveIndustryBucket does not misclassify a non-food real price list as a restaurant", () => {
    // A spa's or fitness studio's real rate card is the same *structural*
    // shape crawl-adapter.ts's findMenuItemsByStructure detects, but its
    // real category labels aren't food/drink-shaped — never guessed into
    // "restaurant" just because *some* real menu-shaped evidence exists.
    assert.equal(resolveIndustryBucket(null, null, ["Massage", "Facial", "Packages"]), "general");
    assert.equal(resolveIndustryBucket(null, null, ["Drop-In", "10-Class Pack", "Membership"]), "general");
  });

  test("Phase 5.1: a non-food business calling its own real offerings a 'menu'/'service'/'package'/'special' is not accidentally classified as a restaurant", () => {
    // The word "menu" is generic across industries ("service menu", "spa
    // menu", "pricing menu" are all real, common phrasings) — RESTAURANT_
    // MENU_CATEGORY_KEYWORDS deliberately does not include the bare word
    // "menu" for exactly this reason. Real food/drink vocabulary
    // ("appetizer", "cocktail", "dessert", etc.) still covers genuine
    // restaurants without this false-positive surface.
    assert.equal(resolveIndustryBucket(null, null, ["Service Menu", "Pricing"]), "general");
    assert.equal(resolveIndustryBucket(null, null, ["Spa Menu", "Packages"]), "general");
    assert.equal(resolveIndustryBucket(null, null, ["Our Service Packages", "Special Offers"]), "general");
    assert.equal(resolveIndustryBucket(null, null, ["Class Packages", "Membership Specials"]), "general");
  });

  test("resolveIndustryBucket handles empty/whitespace-only menu category names safely", () => {
    assert.equal(resolveIndustryBucket(null, null, []), "general");
    assert.equal(resolveIndustryBucket(null, null, ["  ", ""]), "general");
  });
});
