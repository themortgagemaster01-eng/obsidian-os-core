import type { CapabilityToken } from "@/lib/design-intelligence/capability-selector";
import type { CapabilityAdapter, CapabilityExecutionResult } from "@/lib/design-intelligence/capability-adapter";
import { basicMotionAdapter } from "@/lib/design-intelligence/basic-motion-adapter";
import { shaderHeroAdapter } from "@/lib/design-intelligence/shader-hero-adapter";

/**
 * lib/design-intelligence/capability-adapter-registry.ts — the "simple
 * registry that looks up the adapter for a granted token"
 * (docs/PHASE_6.5_CAPABILITY_AUDIT.md item 37). Deliberately a plain,
 * explicit Record — not a mutable Map with import-side-effect self-
 * registration — matching this codebase's existing lookup-table convention
 * (e.g. BASE_VARIANT_BY_HERO_PATTERN in composition-variants.ts,
 * WIREFRAME_TEMPLATE_BY_BUCKET in design-generation-service.ts): the full
 * set of registered adapters is visible in one place, in source, with no
 * dependency on module import order.
 *
 * This file is the one place allowed to import both the port
 * (capability-adapter.ts) and a concrete adapter (basic-motion-adapter.ts)
 * — the port itself stays adapter-agnostic, and a concrete adapter only
 * ever imports the port's types, never this registry, so there is no import
 * cycle as more adapters are added later.
 */

const CAPABILITY_ADAPTER_REGISTRY: Readonly<Partial<Record<CapabilityToken, CapabilityAdapter<unknown, unknown>>>> = {
  "basic-motion": basicMotionAdapter,
  "shader-enhanced-hero": shaderHeroAdapter,
};

export function getCapabilityAdapter<TInput, TPayload>(
  token: CapabilityToken
): CapabilityAdapter<TInput, TPayload> | undefined {
  return CAPABILITY_ADAPTER_REGISTRY[token] as CapabilityAdapter<TInput, TPayload> | undefined;
}

/**
 * requestCapabilityExecution — the one entry point a future Execution
 * Runtime calls for a token the Selector already granted. Fail-closed at
 * every step (the founder's Phase 6.5 non-negotiable, mirroring
 * resolveQaPreviewAccessConfig's "unavailable by default, never a
 * hardcoded fallback" discipline): no registered adapter, unmet
 * requirements, or a thrown execute() all degrade to either `null` (no
 * adapter exists at all — nothing this layer can safely construct a payload
 * from) or a real, honestly-classified fallback result — never a crash,
 * never a silently-invented success.
 */
export function requestCapabilityExecution<TInput, TPayload>(
  token: CapabilityToken,
  input: TInput
): CapabilityExecutionResult<TPayload> | null {
  const adapter = getCapabilityAdapter<TInput, TPayload>(token);
  if (!adapter) return null;

  if (!adapter.requirementsMet(input)) {
    return adapter.fallback(input, "requirements-not-met");
  }

  try {
    return adapter.execute(input);
  } catch {
    return adapter.fallback(input, "runtime-error");
  }
}
