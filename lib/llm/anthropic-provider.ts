import type { LlmProvider, LlmMessageRequest } from "@/lib/llm/provider";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Default model id — per this session's own model-id reference, "claude-
 * sonnet-5" is a current, valid Anthropic API model identifier as of this
 * writing. Overridable via ANTHROPIC_MODEL without a code change, since
 * Anthropic's current model lineup will change over the life of this
 * codebase and this default should not require a redeploy to update.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

/** Anthropic's documented Messages API response shape, narrowed to the fields this provider actually reads. */
interface AnthropicMessagesResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Raw-fetch Anthropic implementation of LlmProvider — no SDK dependency,
 * matching this codebase's existing precedent
 * (lib/adapters/crawl-adapter.ts already calls fetch() directly rather than
 * pulling in an HTTP client library). Reads ANTHROPIC_API_KEY lazily,
 * inside complete(), not in the constructor — so constructing a provider
 * (and therefore constructing DesignBriefServiceDeps, which holds one)
 * never throws just because a key isn't configured yet. Only an actual
 * attempt to call the model does, with a clear, actionable message
 * (ADR-013's "adapters must fail gracefully and report why" consequence,
 * applied here even though this isn't an adapter).
 */
export class AnthropicLlmProvider implements LlmProvider {
  private readonly model: string;

  constructor(model: string = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL) {
    this.model = model;
  }

  async complete(request: LlmMessageRequest): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable LLM-powered Design Intelligence " +
          "(docs/ARCHITECTURE_SPECIFICATION_V1.md §3)."
      );
    }

    // The assistant-message prefill trick: seeding the assistant turn with
    // "{" strongly biases Claude toward continuing directly into JSON
    // rather than prefacing it with "Here's the JSON:" or similar — the
    // model's completion picks up after the seed, so it's prepended back
    // below rather than duplicated.
    const messages: { role: "user" | "assistant"; content: string }[] = [
      { role: "user", content: request.userPrompt },
    ];
    if (request.expectJson) {
      messages.push({ role: "assistant", content: "{" });
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Anthropic API request failed (${response.status}): ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as AnthropicMessagesResponse;
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (typeof text !== "string") {
      throw new Error("Anthropic API response did not contain expected text content.");
    }

    if (request.onUsage && data.usage?.input_tokens !== undefined && data.usage?.output_tokens !== undefined) {
      request.onUsage({ inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens });
    }

    return request.expectJson ? `{${text}` : text;
  }
}

/**
 * Convenience factory reading ANTHROPIC_MODEL from the environment (falls
 * back to DEFAULT_ANTHROPIC_MODEL) — does NOT check for ANTHROPIC_API_KEY
 * here, since that check is deferred to complete() (see class doc comment
 * above). Named "FromEnv" to make that env-driven construction explicit at
 * call sites.
 */
export function createAnthropicProviderFromEnv(): AnthropicLlmProvider {
  return new AnthropicLlmProvider();
}
