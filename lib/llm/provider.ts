/**
 * The LLM provider port (docs/ARCHITECTURE_SPECIFICATION_V1.md §3). Design
 * Intelligence's business logic (lib/services/design-intelligence-service.ts)
 * depends on THIS interface only — never on a specific vendor SDK or a raw
 * `fetch` call to a specific vendor's API. Anthropic
 * (lib/llm/anthropic-provider.ts) is the first concrete implementation;
 * swapping in OpenAI, Gemini, or a local model later means writing a new
 * class that implements this interface, not touching any Design
 * Intelligence business logic. Same port/adapter reasoning
 * lib/events/event-bus.ts's EventBus interface already established in this
 * codebase for the same kind of "swappable external dependency" problem.
 */

/** Token counts for one completion — real spend now that a live API key exists, so callers that care about cost can observe it per call. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmMessageRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  /**
   * When true, the caller expects the response to be a single JSON value
   * with no surrounding prose. Providers that support a stronger mechanism
   * for this (e.g. Anthropic's assistant-message prefill trick, OpenAI's
   * `response_format: { type: "json_object" }`) should use it — the
   * request only states the *intent*, each implementation decides *how*.
   * This does not replace defensive parsing on the caller's side
   * (lib/llm/json-response.ts) — no provider guarantee is treated as
   * absolute, since models occasionally wrap JSON in prose or markdown
   * fences even when explicitly instructed not to.
   */
  expectJson?: boolean;
  /** Opportunistic — called with token usage if the provider's response reports it. Not every provider/response is guaranteed to; absence is not an error. */
  onUsage?: (usage: LlmUsage) => void;
}

export interface LlmProvider {
  /** Sends a single-turn prompt and returns the model's raw text response. */
  complete(request: LlmMessageRequest): Promise<string>;
}
