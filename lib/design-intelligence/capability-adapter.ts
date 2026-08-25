import type { CapabilityToken } from "@/lib/design-intelligence/capability-selector";

/**
 * lib/design-intelligence/capability-adapter.ts — the Capability Adapter
 * port (docs/PHASE_6.5_CAPABILITY_AUDIT.md items 24/31), mirroring the
 * EventBus (lib/events/event-bus.ts) / LlmProvider (lib/llm/provider.ts)
 * precedent already in this codebase: an interface (port) defined first,
 * concrete implementations written separately and wired explicitly, never
 * a hidden global side effect. Type definitions only — this file declares
 * no concrete adapter and imports none, so it never needs to know a real
 * capability's vendor, library, or execution technology. The Capability
 * Selector (capability-selector.ts) never imports this file, and this file
 * never imports the Selector's decision logic, only its CapabilityToken
 * vocabulary type — the two stay independently testable peers.
 *
 * Every adapter is a self-contained unit (item 31's "single cleanest
 * organizing idea in Batch 3") bundling execution + fallback + reduced-
 * motion strategy + failure classification + its own QA contract as one
 * shape — mirroring design-refinement-service.ts's own refine* passes
 * ("produce the value" + "validate against a real validator" + "return
 * violations" as one function each), extended with a fallback because a
 * capability, unlike a typography/spacing choice, can genuinely fail at
 * runtime in a way a pure style computation cannot.
 */

/**
 * Closed failure vocabulary (item 29) — mirrors EXPERIENCE_MODE_VOCABULARY/
 * MOTION_BUDGET_VOCABULARY's own closed-union discipline
 * (shared/design-intelligence/types.ts), never a freeform string. Owned by
 * the Adapter (it knows why its own execution attempt failed), surfaced by
 * the Runtime, and verified for accuracy by a future Rendered QA pass (item
 * 29's "QA verifies it's accurate" requirement) — never invented after the
 * fact.
 */
export const CAPABILITY_FAILURE_REASON_VOCABULARY = [
  "adapter-not-registered",
  "requirements-not-met",
  "runtime-error",
] as const;
export type CapabilityFailureReason = (typeof CAPABILITY_FAILURE_REASON_VOCABULARY)[number];

/**
 * Item 28: every adapter must declare an explicit reduced-motion strategy —
 * a hard requirement on every adapter's contract, never per-adapter
 * discretion. "gate-initialization" is the only value real today: the
 * existing scroll-reveal.ts discipline already gets this right by
 * construction (check `prefers-reduced-motion` in JS BEFORE the
 * IntersectionObserver ever engages, never hidden-but-still-computing).
 * Kept as a closed vocabulary (not a boolean) so a future, heavier adapter
 * (a WebGL canvas that must never mount its render loop, a video element
 * that must never even source-load) is forced to declare which strategy it
 * actually implements rather than silently reusing this one by omission.
 */
export const REDUCED_MOTION_STRATEGY_VOCABULARY = ["gate-initialization"] as const;
export type ReducedMotionStrategy = (typeof REDUCED_MOTION_STRATEGY_VOCABULARY)[number];

/** Item 30's expected/actual/status shape, adopted verbatim from the audit. */
export type CapabilityQaStatus = "active" | "degraded-but-valid" | "unavailable";

export interface CapabilityQaContract {
  expected: CapabilityToken;
  /** The token itself when genuinely active; a plain description of the fallback otherwise — never the token name when a fallback is actually showing (item 29's hard rule: never report "active" when a fallback is displayed). */
  actual: CapabilityToken | "static-fallback" | "no-capability";
  status: CapabilityQaStatus;
}

/**
 * The concrete shape a granted capability's execution produces — generic
 * over the adapter's own real payload type (TPayload) so basic-motion can
 * carry a real MotionRefinement while a future adapter carries its own real
 * shape, without a shared union of every capability's payload forcing an
 * unrelated import into this port file.
 */
export interface CapabilityExecutionResult<TPayload> {
  token: CapabilityToken;
  status: "active" | "fallback-active";
  /** Present only when status is "fallback-active" — the classified reason, never inferred after the fact by a caller. */
  failureReason?: CapabilityFailureReason;
  payload: TPayload;
}

/**
 * CapabilityAdapter<TInput, TPayload> — the port every capability
 * implementation must satisfy. Vendor-aware, execution-aware, the ONLY layer
 * allowed to know how a granted token actually gets fulfilled — the
 * Selector never sees any of this. `requirementsMet` is checked by the
 * registry (capability-adapter-registry.ts) BEFORE `execute()` is ever
 * called, so an adapter's own `execute()` can assume its declared
 * requirements already hold.
 */
export interface CapabilityAdapter<TInput, TPayload> {
  token: CapabilityToken;
  /**
   * True when this specific input carries everything this adapter needs to
   * execute for real — checked defensively even though the registry only
   * ever calls this for a token the Selector already granted (the same
   * "never trust an upstream value blindly" discipline design-refinement-
   * service.ts's own refineMotionFromExperiencePlan already applies to its
   * ExperiencePlan input).
   */
  requirementsMet(input: TInput): boolean;
  /** The real execution path — only ever called once requirementsMet(input) is true. May still throw (a genuine runtime failure); the registry, not the adapter, is responsible for catching it and degrading to fallback(). */
  execute(input: TInput): CapabilityExecutionResult<TPayload>;
  /** The safe-degrade path (item 25's progressive-enhancement contract) — always produces a real, valid, ship-able result, never a broken or partial one. Called whenever requirementsMet is false or execute() throws. */
  fallback(input: TInput, failureReason: CapabilityFailureReason): CapabilityExecutionResult<TPayload>;
  reducedMotionStrategy: ReducedMotionStrategy;
  /** The full set of failure reasons THIS adapter can genuinely produce — a subset of CAPABILITY_FAILURE_REASON_VOCABULARY, declared so a future QA pass can verify a reported failure is one this adapter actually claims to be capable of (item 29's "QA verifies it's accurate" requirement). */
  possibleFailureReasons: CapabilityFailureReason[];
  /** Builds item 30's expected/actual/status shape from a real execution result — never a static return value, so the QA contract can never drift from what actually happened. */
  qaContract(result: CapabilityExecutionResult<TPayload>): CapabilityQaContract;
}
