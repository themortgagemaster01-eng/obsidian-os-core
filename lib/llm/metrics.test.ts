import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MetricsLlmProvider, type LlmCallMetrics } from "@/lib/llm/metrics";
import type { LlmProvider, LlmMessageRequest } from "@/lib/llm/provider";

function fakeProvider(opts: {
  name?: string;
  responses?: (string | Error)[];
  usage?: { inputTokens: number; outputTokens: number };
}): LlmProvider {
  const responses = opts.responses ?? ["ok"];
  let call = 0;
  return {
    name: opts.name ?? "fake:test-model",
    async complete(request: LlmMessageRequest) {
      const response = responses[Math.min(call, responses.length - 1)];
      call++;
      if (opts.usage) request.onUsage?.(opts.usage);
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

describe("MetricsLlmProvider: name passthrough", () => {
  test("exposes the wrapped provider's name", () => {
    const provider = new MetricsLlmProvider(fakeProvider({ name: "anthropic:claude-sonnet-5" }));
    assert.equal(provider.name, "anthropic:claude-sonnet-5");
  });
});

describe("MetricsLlmProvider: success path", () => {
  test("returns the inner provider's result unchanged", async () => {
    const provider = new MetricsLlmProvider(fakeProvider({ responses: ["hello"] }));
    const result = await provider.complete({ systemPrompt: "sys", userPrompt: "user" });
    assert.equal(result, "hello");
  });

  test("reports success:true, retryCount:0, and token/cost fields on the first-try success", async () => {
    const metrics: LlmCallMetrics[] = [];
    const provider = new MetricsLlmProvider(
      fakeProvider({ name: "anthropic:claude-sonnet-5", usage: { inputTokens: 1000, outputTokens: 2000 } }),
      { sink: (m) => metrics.push(m) }
    );

    await provider.complete({ systemPrompt: "sys", userPrompt: "user" });

    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].success, true);
    assert.equal(metrics[0].retryCount, 0);
    assert.equal(metrics[0].provider, "anthropic:claude-sonnet-5");
    assert.equal(metrics[0].model, "claude-sonnet-5");
    assert.equal(metrics[0].promptTokens, 1000);
    assert.equal(metrics[0].completionTokens, 2000);
    assert.equal(metrics[0].errorMessage, null);
    assert.ok(metrics[0].generationTimeMs >= 0);
  });

  test("estimates cost for a recognized model family and leaves it null for an unrecognized one", async () => {
    const metrics: LlmCallMetrics[] = [];
    const provider = new MetricsLlmProvider(
      fakeProvider({ name: "anthropic:claude-sonnet-5", usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } }),
      { sink: (m) => metrics.push(m) }
    );
    await provider.complete({ systemPrompt: "sys", userPrompt: "user" });
    assert.equal(metrics[0].costEstimateUsd, 3 + 15);

    const unknownMetrics: LlmCallMetrics[] = [];
    const unknownProvider = new MetricsLlmProvider(
      fakeProvider({ name: "some-future-vendor:mystery-model", usage: { inputTokens: 100, outputTokens: 100 } }),
      { sink: (m) => unknownMetrics.push(m) }
    );
    await unknownProvider.complete({ systemPrompt: "sys", userPrompt: "user" });
    assert.equal(unknownMetrics[0].costEstimateUsd, null);
  });

  test("reports null token/cost fields when the inner provider never reports usage", async () => {
    const metrics: LlmCallMetrics[] = [];
    const provider = new MetricsLlmProvider(fakeProvider({ responses: ["hello"] }), { sink: (m) => metrics.push(m) });
    await provider.complete({ systemPrompt: "sys", userPrompt: "user" });
    assert.equal(metrics[0].promptTokens, null);
    assert.equal(metrics[0].completionTokens, null);
    assert.equal(metrics[0].costEstimateUsd, null);
  });

  test("still forwards onUsage to the caller's own callback", async () => {
    const observed: { inputTokens: number; outputTokens: number }[] = [];
    const provider = new MetricsLlmProvider(fakeProvider({ usage: { inputTokens: 5, outputTokens: 7 } }));
    await provider.complete({ systemPrompt: "sys", userPrompt: "user", onUsage: (u) => observed.push(u) });
    assert.deepEqual(observed, [{ inputTokens: 5, outputTokens: 7 }]);
  });

  test("records usage delivered through an asynchronous provider callback", async () => {
    const metrics: LlmCallMetrics[] = [];
    const provider = new MetricsLlmProvider(
      {
        name: "anthropic:claude-sonnet-5",
        async complete(request) {
          await Promise.resolve();
          request.onUsage?.({ inputTokens: 11, outputTokens: 13 });
          return "ok";
        },
      },
      { sink: (m) => metrics.push(m) }
    );

    await provider.complete({ systemPrompt: "sys", userPrompt: "user" });
    assert.equal(metrics[0].promptTokens, 11);
    assert.equal(metrics[0].completionTokens, 13);
  });
});

describe("MetricsLlmProvider: failure path", () => {
  test("rethrows the error and reports success:false with the error message, by default with no retries", async () => {
    const metrics: LlmCallMetrics[] = [];
    const provider = new MetricsLlmProvider(fakeProvider({ responses: [new Error("boom")] }), {
      sink: (m) => metrics.push(m),
    });

    await assert.rejects(() => provider.complete({ systemPrompt: "sys", userPrompt: "user" }), /boom/);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].success, false);
    assert.equal(metrics[0].errorMessage, "boom");
    assert.equal(metrics[0].retryCount, 0);
  });
});

describe("MetricsLlmProvider: retry behavior (opt-in)", () => {
  test("does not retry by default (maxRetries: 0)", async () => {
    let attempts = 0;
    const provider = new MetricsLlmProvider({
      name: "fake",
      async complete() {
        attempts++;
        throw new Error("always fails");
      },
    });
    await assert.rejects(() => provider.complete({ systemPrompt: "sys", userPrompt: "user" }));
    assert.equal(attempts, 1);
  });

  test("retries up to maxRetries and succeeds if a later attempt succeeds, reporting the actual retryCount", async () => {
    let attempts = 0;
    const metrics: LlmCallMetrics[] = [];
    const provider = new MetricsLlmProvider(
      {
        name: "fake",
        async complete() {
          attempts++;
          if (attempts < 3) throw new Error("transient failure");
          return "recovered";
        },
      },
      { maxRetries: 3, sink: (m) => metrics.push(m) }
    );

    const result = await provider.complete({ systemPrompt: "sys", userPrompt: "user" });
    assert.equal(result, "recovered");
    assert.equal(attempts, 3);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].success, true);
    assert.equal(metrics[0].retryCount, 2);
  });

  test("exhausts all retries, rethrows the last error, and reports the final retryCount", async () => {
    let attempts = 0;
    const metrics: LlmCallMetrics[] = [];
    const provider = new MetricsLlmProvider(
      {
        name: "fake",
        async complete() {
          attempts++;
          throw new Error(`failure ${attempts}`);
        },
      },
      { maxRetries: 2, sink: (m) => metrics.push(m) }
    );

    await assert.rejects(() => provider.complete({ systemPrompt: "sys", userPrompt: "user" }), /failure 3/);
    assert.equal(attempts, 3);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].success, false);
    assert.equal(metrics[0].retryCount, 2);
  });
});
