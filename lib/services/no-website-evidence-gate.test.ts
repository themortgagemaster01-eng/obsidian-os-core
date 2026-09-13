import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { evaluateNoWebsiteEvidence } from "@/lib/services/no-website-evidence-gate";

describe("no-website-evidence-gate: evaluateNoWebsiteEvidence (Robert's locked spec, §1 — hard safety gate)", () => {
  test("CONFIRMED when a verified phone number is on record, even with no address", () => {
    const result = evaluateNoWebsiteEvidence({ businessName: "Skyline Towing", phone: "555-0100", address: null });
    assert.equal(result.verdict, "CONFIRMED");
    assert.match(result.reason, /555-0100/);
  });

  test("CONFIRMED when a specific street address is on record, even with no phone", () => {
    const result = evaluateNoWebsiteEvidence({ businessName: "Frasers Hardware", phone: null, address: "12 Main St, Mahopac NY" });
    assert.equal(result.verdict, "CONFIRMED");
    assert.match(result.reason, /12 Main St/);
  });

  test("CONFIRMED when both a phone and an address are on record", () => {
    const result = evaluateNoWebsiteEvidence({ businessName: "Keller William Realty Partners", phone: "555-0100", address: "12 Main St" });
    assert.equal(result.verdict, "CONFIRMED");
  });

  test("UNCERTAIN for name + category + town-level geocode only — the real, currently-discovered profile of Skyline Towing / Frasers Hardware / Keller William Realty Partners", () => {
    const result = evaluateNoWebsiteEvidence({ businessName: "Skyline Towing And Auto Repair", phone: null, address: null });
    assert.equal(result.verdict, "UNCERTAIN");
    assert.match(result.reason, /Insufficient business evidence/);
  });

  test("UNCERTAIN, not CONFIRMED, for an empty-string phone/address (whitespace-only is not real evidence)", () => {
    const result = evaluateNoWebsiteEvidence({ businessName: "Acme Diner", phone: "   ", address: "" });
    assert.equal(result.verdict, "UNCERTAIN");
  });

  test("FAILED when there is no business name at all — a genuine data-integrity problem, not just thin evidence", () => {
    const result = evaluateNoWebsiteEvidence({ businessName: "", phone: "555-0100", address: "12 Main St" });
    assert.equal(result.verdict, "FAILED");
  });

  test("never returns CONFIRMED from town/city, industry, or coordinates alone — those aren't inputs to this function at all, only phone/address are", () => {
    // Structural guarantee, not just a behavioral one: NoWebsiteEvidenceInput
    // has no field for industry/location/coordinates — this test documents
    // that a caller cannot accidentally pass them in and have them count.
    const result = evaluateNoWebsiteEvidence({ businessName: "Generic Business", phone: null, address: null });
    assert.equal(result.verdict, "UNCERTAIN");
  });

  test("deterministic — same input always produces the same verdict (no randomness, no LLM)", () => {
    const input = { businessName: "Acme Diner", phone: "555-0100", address: null };
    const first = evaluateNoWebsiteEvidence(input);
    const second = evaluateNoWebsiteEvidence(input);
    assert.deepEqual(first, second);
  });
});
