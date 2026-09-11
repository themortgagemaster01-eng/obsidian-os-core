import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { extractJsonFromLlmResponse } from "@/lib/llm/json-response";

describe("json-response: extractJsonFromLlmResponse", () => {
  test("parses a clean JSON response", () => {
    const result = extractJsonFromLlmResponse('{"a": 1, "b": "two"}');
    assert.deepEqual(result, { a: 1, b: "two" });
  });

  test("extracts JSON wrapped in a markdown code fence", () => {
    const raw = '```json\n{"a": 1}\n```';
    assert.deepEqual(extractJsonFromLlmResponse(raw), { a: 1 });
  });

  test("extracts JSON wrapped in an unlabeled code fence", () => {
    const raw = '```\n{"a": 1}\n```';
    assert.deepEqual(extractJsonFromLlmResponse(raw), { a: 1 });
  });

  test("extracts JSON preceded and followed by conversational prose", () => {
    const raw = 'Sure, here is the JSON you asked for:\n\n{"a": 1}\n\nLet me know if you need anything else!';
    assert.deepEqual(extractJsonFromLlmResponse(raw), { a: 1 });
  });

  test("handles a JSON array response", () => {
    const raw = "Here you go: [1, 2, 3] — hope that helps.";
    assert.deepEqual(extractJsonFromLlmResponse(raw), [1, 2, 3]);
  });

  test("handles nested objects/arrays inside prose and fences together", () => {
    const raw = '```json\n{"nested": {"list": [1, 2], "flag": true}}\n```\nDone.';
    assert.deepEqual(extractJsonFromLlmResponse(raw), { nested: { list: [1, 2], flag: true } });
  });

  test("throws a descriptive error, including a snippet of the raw response, when nothing parses", () => {
    const raw = "I'm sorry, I can't help with that request.";
    assert.throws(() => extractJsonFromLlmResponse(raw), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Failed to parse JSON from LLM response/);
      assert.match(err.message, /can't help with that request/);
      return true;
    });
  });
});

// ===========================================================================
// Fix B (Design Intelligence Gap Map) — real production incident (Video
// Game Plus mission, 2026-09-11): a malformed LLM JSON response failed the
// entire design-brief run outright, with zero recovery attempt. These test
// the one bounded repair pass now attempted before giving up — never a
// second LLM call, never invented content, only syntax-level fixes for
// well-known real LLM JSON formatting mistakes.
// ===========================================================================
describe("json-response: extractJsonFromLlmResponse — Fix B (bounded repair)", () => {
  test("repairs a literal, unescaped quote embedded in a string value — the most likely real cause of the Video Game Plus incident (the model echoing real evidence text containing a literal \" without escaping it)", () => {
    const raw = '{"positioning": "It sells 13" screens and consoles.", "targetAudience": "Local gamers"}';
    const result = extractJsonFromLlmResponse(raw) as { positioning: string; targetAudience: string };
    assert.equal(result.positioning, 'It sells 13" screens and consoles.');
    assert.equal(result.targetAudience, "Local gamers");
  });

  test("does not touch a string value that already correctly escapes its own embedded quote", () => {
    const raw = '{"a": "already \\"escaped\\" correctly"}';
    assert.deepEqual(extractJsonFromLlmResponse(raw), { a: 'already "escaped" correctly' });
  });

  test("repairs a trailing comma before a closing brace/bracket", () => {
    assert.deepEqual(extractJsonFromLlmResponse('{"a": 1, "b": [1, 2, 3,],}'), { a: 1, b: [1, 2, 3] });
  });

  test("repairs an unquoted (bare-identifier) object key", () => {
    assert.deepEqual(extractJsonFromLlmResponse('{a: 1, b: "two"}'), { a: 1, b: "two" });
  });

  test("repairs multiple distinct issues in the same response at once", () => {
    const raw = '{a: "It\'s a 13" TV.", b: [1, 2,],}';
    const result = extractJsonFromLlmResponse(raw) as { a: string; b: number[] };
    assert.equal(result.a, "It's a 13\" TV.");
    assert.deepEqual(result.b, [1, 2]);
  });

  test("when the repair attempt still doesn't produce valid JSON, reports the ORIGINAL parse error, not a confusing error about the repair attempt", () => {
    const raw = "This is just prose with a stray { brace and nothing resembling real JSON at all.";
    assert.throws(() => extractJsonFromLlmResponse(raw), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Failed to parse JSON from LLM response/);
      assert.match(err.message, /stray \{ brace/);
      return true;
    });
  });

  test("never invents or drops real content — a successful repair preserves every real value exactly", () => {
    const raw = '{name: "Video Game Plus", desc: "Buys, sells, and trades 8" and 16" cartridges.", count: 42,}';
    const result = extractJsonFromLlmResponse(raw) as { name: string; desc: string; count: number };
    assert.equal(result.name, "Video Game Plus");
    assert.equal(result.desc, 'Buys, sells, and trades 8" and 16" cartridges.');
    assert.equal(result.count, 42);
  });
});
