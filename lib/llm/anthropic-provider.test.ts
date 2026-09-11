import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { AnthropicLlmProvider } from "@/lib/llm/anthropic-provider";

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

let originalFetch: typeof fetch;
let originalApiKey: string | undefined;
let lastFetchArgs: FetchArgs | null;

function mockFetchOnce(response: { ok: boolean; status?: number; statusText?: string; json?: unknown; text?: string }) {
  lastFetchArgs = null;
  global.fetch = (async (...args: FetchArgs) => {
    lastFetchArgs = args;
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      statusText: response.statusText ?? "",
      json: async () => response.json,
      text: async () => response.text ?? "",
    } as unknown as Response;
  }) as typeof fetch;
}

/** Returns each response in sequence (repeating the last one past the end) and reports how many times fetch was actually called — for testing retry/backoff. */
function mockFetchSequence(responses: { ok: boolean; status?: number; statusText?: string; json?: unknown; text?: string }[]) {
  let calls = 0;
  global.fetch = (async (...args: FetchArgs) => {
    lastFetchArgs = args;
    const response = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      statusText: response.statusText ?? "",
      json: async () => response.json,
      text: async () => response.text ?? "",
    } as unknown as Response;
  }) as typeof fetch;
  return () => calls;
}

describe("anthropic-provider", () => {
  beforeEach(() => {
    originalFetch = global.fetch;
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key-123";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  test("throws a clear error when ANTHROPIC_API_KEY is not set, without calling fetch", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    let fetchCalled = false;
    global.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not be called");
    }) as typeof fetch;

    const provider = new AnthropicLlmProvider();
    await assert.rejects(
      () => provider.complete({ systemPrompt: "sys", userPrompt: "user" }),
      /ANTHROPIC_API_KEY is not set/
    );
    assert.equal(fetchCalled, false);
  });

  test("sends the expected request shape (headers, model, messages)", async () => {
    mockFetchOnce({ ok: true, json: { content: [{ type: "text", text: "hello" }] } });

    const provider = new AnthropicLlmProvider("claude-sonnet-5");
    const result = await provider.complete({ systemPrompt: "You are helpful.", userPrompt: "Say hi." });

    assert.equal(result, "hello");
    assert.ok(lastFetchArgs);
    const [url, init] = lastFetchArgs!;
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "test-key-123");
    assert.equal((init?.headers as Record<string, string>)["anthropic-version"], "2023-06-01");

    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "claude-sonnet-5");
    assert.deepEqual(body.messages, [{ role: "user", content: "Say hi." }]);
  });

  test("does NOT send an assistant-prefill message when expectJson is true — confirmed against the real API that some models reject a conversation not ending on a user message", async () => {
    mockFetchOnce({ ok: true, json: { content: [{ type: "text", text: '{"a": 1}' }] } });

    const provider = new AnthropicLlmProvider();
    const result = await provider.complete({ systemPrompt: "sys", userPrompt: "user", expectJson: true });

    assert.equal(result, '{"a": 1}');
    const body = JSON.parse(lastFetchArgs![1]!.body as string);
    assert.deepEqual(body.messages, [{ role: "user", content: "user" }]);
  });

  test("throws a descriptive error on a non-ok HTTP response", async () => {
    mockFetchOnce({ ok: false, status: 401, statusText: "Unauthorized", text: "invalid api key" });

    const provider = new AnthropicLlmProvider();
    await assert.rejects(
      () => provider.complete({ systemPrompt: "sys", userPrompt: "user" }),
      /Anthropic API request failed \(401\).*invalid api key/
    );
  });

  test("throws if the response has no text content block", async () => {
    mockFetchOnce({ ok: true, json: { content: [] } });

    const provider = new AnthropicLlmProvider();
    await assert.rejects(
      () => provider.complete({ systemPrompt: "sys", userPrompt: "user" }),
      /did not contain expected text content/
    );
  });

  test("calls onUsage with token counts when the response reports them", async () => {
    mockFetchOnce({
      ok: true,
      json: { content: [{ type: "text", text: "hello" }], usage: { input_tokens: 120, output_tokens: 45 } },
    });

    const usages: { inputTokens: number; outputTokens: number; stopReason: string | null }[] = [];
    const provider = new AnthropicLlmProvider();
    await provider.complete({ systemPrompt: "sys", userPrompt: "user", onUsage: (u) => usages.push(u) });

    assert.equal(usages.length, 1);
    assert.deepEqual(usages[0], { inputTokens: 120, outputTokens: 45, stopReason: null });
  });

  // Fix B (Design Intelligence Gap Map): stop_reason lets a later JSON-parse
  // failure (lib/llm/json-response.ts) be correlated against the nearest
  // metrics log line to tell a genuine model formatting mistake ("end_turn")
  // apart from a response truncated by the token budget ("max_tokens").
  test("Fix B: passes through the real Anthropic stop_reason via onUsage", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 120, output_tokens: 45 },
        stop_reason: "max_tokens",
      },
    });

    const usages: { stopReason: string | null }[] = [];
    const provider = new AnthropicLlmProvider();
    await provider.complete({ systemPrompt: "sys", userPrompt: "user", onUsage: (u) => usages.push(u) });

    assert.equal(usages[0].stopReason, "max_tokens");
  });

  test("does not call onUsage, and does not throw, when the response has no usage field", async () => {
    mockFetchOnce({ ok: true, json: { content: [{ type: "text", text: "hello" }] } });

    let called = false;
    const provider = new AnthropicLlmProvider();
    await provider.complete({ systemPrompt: "sys", userPrompt: "user", onUsage: () => (called = true) });

    assert.equal(called, false);
  });

  test("retries a transient 529 (Anthropic's own documented 'overloaded' status) and succeeds on the next attempt", async () => {
    const getCalls = mockFetchSequence([
      { ok: false, status: 529, text: "overloaded" },
      { ok: true, json: { content: [{ type: "text", text: "hello" }] } },
    ]);

    const provider = new AnthropicLlmProvider();
    const result = await provider.complete({ systemPrompt: "sys", userPrompt: "user" });

    assert.equal(result, "hello");
    assert.equal(getCalls(), 2, "expected exactly one retry after the first 529");
  });

  test("does not retry a 401 — fails on the first attempt (a bad key won't fix itself on retry)", async () => {
    const getCalls = mockFetchSequence([{ ok: false, status: 401, statusText: "Unauthorized", text: "invalid api key" }]);

    const provider = new AnthropicLlmProvider();
    await assert.rejects(
      () => provider.complete({ systemPrompt: "sys", userPrompt: "user" }),
      /Anthropic API request failed \(401\).*invalid api key/
    );
    assert.equal(getCalls(), 1, "a 401 is a real auth-error signal — retrying it verbatim would just fail identically");
  });

  test("gives up after exhausting retries against a persistent 429, with the same honest error shape as before this fix", async () => {
    const getCalls = mockFetchSequence([{ ok: false, status: 429, statusText: "Too Many Requests", text: "rate limited" }]);

    const provider = new AnthropicLlmProvider();
    await assert.rejects(
      () => provider.complete({ systemPrompt: "sys", userPrompt: "user" }),
      /Anthropic API request failed \(429\).*rate limited/
    );
    assert.equal(getCalls(), 3, "expected the initial attempt plus 2 retries, then giving up");
  });
});
