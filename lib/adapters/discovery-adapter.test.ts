import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseOverpassElements, OSM_TAGS_BY_INDUSTRY_BUCKET, type OverpassElement } from "@/lib/adapters/discovery-adapter";

// A real, captured shape from a live Overpass query against Kitchener, ON
// (this adapter's own validation run) — restaurant/fast_food/cafe nodes
// with varying tag completeness, exactly the "coverage is real but uneven"
// case this module's own header comment names.
const REAL_SHAPE_ELEMENTS: OverpassElement[] = [
  { type: "node" as const, id: 308703910, lat: 43.4523056, lon: -80.5558684, tags: { amenity: "restaurant", cuisine: "chinese", name: "Kam Yin" } },
  {
    type: "node" as const,
    id: 308704561,
    lat: 43.4523288,
    lon: -80.5557798,
    tags: { amenity: "fast_food", name: "Pizza Pizza", phone: "+1-519-747-1111" },
  },
  {
    type: "node" as const,
    id: 308863429,
    lat: 43.4845371,
    lon: -80.5262628,
    tags: { amenity: "fast_food", name: "Subway", website: "https://restaurants.subway.com/canada/on/waterloo/402-king-st-n" },
  },
  {
    type: "node" as const,
    id: 421138265,
    lat: 43.4540371,
    lon: -80.4927948,
    tags: {
      amenity: "restaurant",
      name: "Pepi's Pizza",
      website: "www.pepispizza.com",
      phone: "+1 519-578-6640",
      "addr:housenumber": "87",
      "addr:street": "Water Street North",
      "addr:city": "Kitchener",
      "addr:postcode": "N2H 5A6",
    },
  },
  // An unnamed element — a real OSM node this codebase's evidence-first
  // discipline correctly refuses to treat as a candidate business (§8:
  // never invent what a real name would be).
  { type: "node" as const, id: 999, lat: 43.1, lon: -80.1, tags: { amenity: "restaurant" } },
  // No tags at all — real OSM data includes bare nodes matched by a
  // pre-filter that carry nothing usable.
  { type: "node" as const, id: 1000, lat: 43.2, lon: -80.2 },
];

describe("discovery-adapter: parseOverpassElements", () => {
  test("extracts real name/website/phone/address from a live-shaped Overpass response, never fabricating a missing field", () => {
    const results = parseOverpassElements(REAL_SHAPE_ELEMENTS, ["amenity=restaurant", "amenity=fast_food"]);
    assert.equal(results.length, 4);

    const kamYin = results.find((r) => r.name === "Kam Yin")!;
    assert.equal(kamYin.websiteUrl, null);
    assert.equal(kamYin.phone, null);
    assert.equal(kamYin.osmTag, "amenity=restaurant");

    const pepis = results.find((r) => r.name === "Pepi's Pizza")!;
    assert.equal(pepis.phone, "+1 519-578-6640");
    assert.equal(pepis.address, "87 Water Street North Kitchener N2H 5A6");
  });

  test("normalizes a bare (schemeless) website tag into a real https URL, and passes through an already-schemed one unchanged", () => {
    const results = parseOverpassElements(REAL_SHAPE_ELEMENTS, ["amenity=fast_food", "amenity=restaurant"]);
    const subway = results.find((r) => r.name === "Subway")!;
    assert.equal(subway.websiteUrl, "https://restaurants.subway.com/canada/on/waterloo/402-king-st-n");
    const pepis = results.find((r) => r.name === "Pepi's Pizza")!;
    assert.equal(pepis.websiteUrl, "https://www.pepispizza.com");
  });

  test("skips an unnamed element and a tagless element entirely — never invents a business name", () => {
    const results = parseOverpassElements(REAL_SHAPE_ELEMENTS, ["amenity=restaurant"]);
    assert.ok(!results.some((r) => r.externalId === "node/999"));
    assert.ok(!results.some((r) => r.externalId === "node/1000"));
  });

  test("produces a stable externalId ('<type>/<id>') suitable as the real dedupe key (leads.discovery_external_id)", () => {
    const results = parseOverpassElements(REAL_SHAPE_ELEMENTS, ["amenity=restaurant"]);
    const kamYin = results.find((r) => r.name === "Kam Yin")!;
    assert.equal(kamYin.externalId, "node/308703910");
  });

  test("dedupes an element appearing twice in the raw elements array (a real shape: a node matched by two overlapping tag clauses)", () => {
    const duplicated = [...REAL_SHAPE_ELEMENTS, REAL_SHAPE_ELEMENTS[0]];
    const results = parseOverpassElements(duplicated, ["amenity=restaurant", "amenity=fast_food"]);
    assert.equal(results.filter((r) => r.externalId === "node/308703910").length, 1);
  });

  test("a way element's center (not lat/lon directly) is used as its coordinate — the real shape 'out center tags' produces for a way", () => {
    const wayElement = { type: "way" as const, id: 55, center: { lat: 43.5, lon: -80.5 }, tags: { amenity: "restaurant", name: "Way Diner" } };
    const results = parseOverpassElements([wayElement], ["amenity=restaurant"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].latitude, 43.5);
    assert.equal(results[0].longitude, -80.5);
  });
});

describe("discovery-adapter: OSM_TAGS_BY_INDUSTRY_BUCKET", () => {
  test("every declared IndustryBucket has at least one real OSM tag mapped — no silently-empty category", () => {
    for (const [bucket, tags] of Object.entries(OSM_TAGS_BY_INDUSTRY_BUCKET)) {
      assert.ok(tags.length > 0, `${bucket} has no mapped OSM tags`);
      for (const tag of tags) {
        assert.match(tag, /^[a-z:]+=\S+$/, `${bucket}'s tag "${tag}" is not a valid key=value OSM tag`);
      }
    }
  });
});
