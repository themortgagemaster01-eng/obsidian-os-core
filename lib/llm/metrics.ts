import type { LlmMessageRequest, LlmProvider, LlmUsage } from "@/lib/llm/provider";

/**
 * Basic operational metrics for LLM calls (Sprint 4 Phase 3's second
 * deliverable, alongside Design Refinement — see docs/SPRINT_STATUS.md).
 * Wraps ANY LlmProvider — this hooks into the port
 * (lib/llm/provider.ts), not a specific vendor, so every current and future
 * caller of an LlmProvider gets metrics for free, not just
 * design-intelligence-service.ts. Logs only, per instruction ("logs are
 * fine for now, no dashboard needed") — no table, no persistence layer.
 * Should a dashboard or persisted history ever be wanted, the `sink`
 * parameter is already the seam to redirect these records somewhere other
 * than console.log without touching this file's call-timing/retry logic.
 */

export interface LlmCallMetrics {
  /** The wrapped provider's LlmProvider.name — e.g. "anthropic:claude-sonnet-5". */
  provider: string;
  /** The model portion of the provider identifier, when the provider exposes one. */
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Rough USD estimate from COST_PER_MILLION_TOKENS_USD below — null for an unrecognized model rather than a fabricated number (evidence-first discipline, ADR-013, applied to cost instead of a report claim). */
  costEstimateUsd: number | null;
  generationTimeMs: number;
  /** Number of retry attempts made beyond the first, per MetricsLlmProviderOptions.maxRetries. Always 0 unless a caller opts into retries. */
  retryCount: number;
  success: boolean;
  errorMessage: string | null;
}

export type LlmMetricsSink = (metrics: LlmCallMetrics) => void;

/** Default sink: a single structured log line per call — real spend and latency become visible in server logs without requiring a dashboard. */
export const consoleLlmMetricsSink: LlmMetricsSink = (metrics) => {
  // eslint-disable-next-line no-console
  console.log(`[llm-metrics] ${JSON.stringify(metrics)}`);
};

/**
 * Approximate per-million-token USD pricing, keyed by a substring match
 * against LlmProvider.name/model — not an exact, continuously-updated price
 * list (docs/SPRINT_STATUS.md already discloses the same honesty gap: "not
 * precisely computed here since exact current pricing wasn't looked up").
 * An unrecognized model yields a null cost estimate rather than guessing —
 * the same "no evidence, no claim" discipline this codebase applies
 * everywhere else (ADR-013).
 */
const COST_PER_MILLION_TOKENS_USD: { match: string; inputUsd: number; outputUsd: number }[] = [
  { match: "opus", inputUsd: 15, outputUsd: 75 },
  { match: "sonnet", inputUsd: 3, outputUsd: 15 },
  { match: "haiku", inputUsd: 0.8, outputUsd: 4 },
];

function estimateCostUsd(providerName: string, usage: LlmUsage | null): number | null {
  if (!usage) return null;
  const lowerName = providerName.toLowerCase();
  const pricing = COST_PER_MILLION_TOKENS_USD.find((p) => lowerName.includes(p.match));
  if (!pricing) return null;

  return (usage.inputTokens / 1_000_000) * pricing.inputUsd + (usage.outputTokens / 1_000_000) * pricing.outputUsd;
}

function modelFromProviderName(providerName: string): string | null {
  const separator = providerName.indexOf(":");
  const model = separator === -1 ? "" : providerName.slice(separator + 1).trim();
  return model.length > 0 ? model : null;
}

export interface MetricsLlmProviderOptions {
  /**
   * Retry attempts on failure, beyond the first try. Defaults to 0 — real
   * API spend shouldn't silently multiply just because metrics tracking was
   * added; a caller that wants retry behavior opts in explicitly. Retries
   * indiscriminately on any thrown error (including e.g. a missing API key)
   * rather than trying to classify errors as transient/permanent — that
   * classification would need real evidence from production failures to do
   * well, which doesn't exist yet.
   */
  maxRetries?: number;
  /** Where a completed call's metrics are reported. Defaults to consoleLlmMetricsSink. */
  sink?: LlmMetricsSink;
}

/**
 * Wraps any LlmProvider and reports LlmCallMetrics for every call — success
 * or failure — via `sink`. Implements LlmProvider itself, so it's a drop-in
 * replacement anywhere an LlmProvider is expected (design-brief-service.ts's
 * createDesignBriefServiceDeps, or any future caller).
 */
export class MetricsLlmProvider implements LlmProvider {
  private readonly inner: LlmProvider;
  private readonly maxRetries: number;
  private readonly sink: LlmMetricsSink;

  constructor(inner: LlmProvider, options: MetricsLlmProviderOptions = {}) {
    this.inner = inner;
    this.maxRetries = options.maxRetries ?? 0;
    this.sink = options.sink ?? consoleLlmMetricsSink;
  }

  get name(): string {
    return this.inner.name;
  }

  async complete(request: LlmMessageRequest): Promise<string> {
    const startedAt = Date.now();
    // `onUsage` is an opaque provider callback, so TypeScript cannot prove a
    // local assignment made there is visible after await complete(). A
    // mutable state object accurately represents this optional callback.
    const usageState: { value: LlmUsage | null } = { value: null };
    const onUsage: LlmMessageRequest["onUsage"] = (u) => {
      usageState.value = u;
      request.onUsage?.(u);
    };

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      try {
        const text = await this.inner.complete({ ...request, onUsage });
        const usage = usageState.value;

        this.sink({
          provider: this.inner.name,
          model: modelFromProviderName(this.inner.name),
          promptTokens: usage ? usage.inputTokens : null,
          completionTokens: usage ? usage.outputTokens : null,
          costEstimateUsd: estimateCostUsd(this.inner.name, usage),
          generationTimeMs: Date.now() - startedAt,
          retryCount: attempt,
          success: true,
          errorMessage: null,
        });

        return text;
      } catch (err) {
        lastError = err;
        attempt++;
      }
    }

    const message = lastError instanceof Error ? lastError.message : "LLM call failed for an unknown reason.";
    const usage = usageState.value;
    this.sink({
      provider: this.inner.name,
      model: modelFromProviderName(this.inner.name),
      promptTokens: usage ? usage.inputTokens : null,
      completionTokens: usage ? usage.outputTokens : null,
      costEstimateUsd: estimateCostUsd(this.inner.name, usage),
      generationTimeMs: Date.now() - startedAt,
      retryCount: attempt - 1,
      success: false,
      errorMessage: message,
    });

    throw lastError;
  }
}
