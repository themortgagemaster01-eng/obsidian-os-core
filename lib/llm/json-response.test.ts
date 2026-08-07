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
