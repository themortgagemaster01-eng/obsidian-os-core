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

    const usages: { inputTokens: number; outputTokens: number }[] = [];
    const provider = new AnthropicLlmProvider();
    await provider.complete({ systemPrompt: "sys", userPrompt: "user", onUsage: (u) => usages.push(u) });

    assert.equal(usages.length, 1);
    assert.deepEqual(usages[0], { inputTokens: 120, outputTokens: 45 });
  });

  test("does not call onUsage, and does not throw, when the response has no usage field", async () => {
    mockFetchOnce({ ok: true, json: { content: [{ type: "text", text: "hello" }] } });

    let called = false;
    const provider = new AnthropicLlmProvider();
    await provider.complete({ systemPrompt: "sys", userPrompt: "user", onUsage: () => (called = true) });

    assert.equal(called, false);
  });
});
