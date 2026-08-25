import { resolveExperienceCapabilities, type CapabilityDecision } from "@/lib/design-intelligence/capability-selector";
import { requestCapabilityExecution } from "@/lib/design-intelligence/capability-adapter-registry";
import type { ShaderHeroAdapterInput, ShaderHeroPayload, ShaderHeroColorPalette } from "@/lib/design-intelligence/shader-hero-adapter";
import type { ExperiencePlan } from "@/shared/design-intelligence/types";

/**
 * lib/design-intelligence/capability-hero-execution.ts — the shader-
 * enhanced-hero render-time integration point (Phase 6.6, per Robert's
 * approved renderer decision: "The renderer may re-derive the capability
 * decision at render time rather than persisting it... must use the same
 * deterministic selector logic rather than duplicating eligibility rules").
 *
 * Unlike lib/design-intelligence/capability-motion-execution.ts (called from
 * Generation/Refinement, whose payload gets persisted as part of
 * RefinedDesign), this integration point is called directly from
 * components/design-preview/design-preview.tsx — a Server Component — at
 * RENDER time, on every request. This is a deliberate, approved exception to
 * "compute once at generation time": the renderer is the only place that
 * knows whether the hero already has a real photograph occupying its
 * background (design-preview.tsx's own heroHasScrim condition), which
 * shader-enhanced-hero's adapter needs as a precondition, and re-deriving a
 * PURE, deterministic decision from already-persisted inputs
 * (wireframe.experiencePlan, DesignMemory.colorPalette/brandPersonality/
 * contentTone — all already on the row) is cheap and carries zero drift
 * risk, unlike re-deriving raw EVIDENCE would. No schema change, no new
 * persisted field — this function is called fresh on every render.
 *
 * Calls the exact same resolveExperienceCapabilities and
 * requestCapabilityExecution primary generation and founder refinement
 * already use for basic-motion — no second, independent eligibility rule
 * exists anywhere in this codebase for shader-enhanced-hero.
 */

export interface ResolveShaderHeroInput {
  /** wireframe.experiencePlan — undefined for a legacy wireframe predating Phase 6.1, in which case the capability layer is never consulted at all, mirroring capability-motion-execution.ts's own legacy-wireframe short circuit. */
  experiencePlan: ExperiencePlan | undefined;
  /** design-preview.tsx's own heroHasScrim — true only when a real photograph already drives the hero's background. */
  heroHasRealPhoto: boolean;
  /** DesignMemory.colorPalette, passed through unchanged. */
  colorPalette: ShaderHeroColorPalette | undefined;
  /** DesignMemory.brandPersonality/contentTone, passed through unchanged — the same real signal the Selector's restrained-tone check already consumes. */
  brandPersonality?: string[];
  contentTone?: string;
}

export interface ShaderHeroResult {
  /** Real, sanitized color stops when the capability was granted AND the adapter's own requirementsMet cleared; null in every other case (not granted, no adapter, unmet requirements, a thrown execute()) — the renderer treats null identically in all of these: render the hero's existing, unchanged background. */
  colors: ShaderHeroPayload["colors"];
  /** Always populated when experiencePlan is present (empty only for the legacy-wireframe case) — real observability into why shader-enhanced-hero was or wasn't granted, for the same explainability reason capability-motion-execution.ts already exposes capabilityDecisions. */
  capabilityDecisions: CapabilityDecision[];
}

/**
 * resolveShaderHeroThroughCapabilities — the one entry point design-
 * preview.tsx calls. Always returns a real result, never throws, never
 * partial.
 */
export function resolveShaderHeroThroughCapabilities(input: ResolveShaderHeroInput): ShaderHeroResult {
  if (!input.experiencePlan) {
    return { colors: null, capabilityDecisions: [] };
  }

  const capabilityDecisions = resolveExperienceCapabilities({
    experiencePlan: input.experiencePlan,
    brandPersonality: input.brandPersonality,
    contentTone: input.contentTone,
  });

  const decision = capabilityDecisions.find((d) => d.token === "shader-enhanced-hero");
  if (!decision?.granted) {
    return { colors: null, capabilityDecisions };
  }

  const executionResult = requestCapabilityExecution<ShaderHeroAdapterInput, ShaderHeroPayload>("shader-enhanced-hero", {
    heroHasRealPhoto: input.heroHasRealPhoto,
    colorPalette: input.colorPalette ?? {},
  });

  if (!executionResult || executionResult.status !== "active") {
    return { colors: null, capabilityDecisions };
  }

  return { colors: executionResult.payload.colors, capabilityDecisions };
}
