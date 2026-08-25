import { toSafeCssColor } from "@/lib/design-render/safe-css";
import type {
  CapabilityAdapter,
  CapabilityExecutionResult,
  CapabilityFailureReason,
  CapabilityQaContract,
} from "@/lib/design-intelligence/capability-adapter";

/**
 * lib/design-intelligence/shader-hero-adapter.ts — the shader-enhanced-hero
 * capability adapter (Phase 6.6, docs/PHASE_6.6_SHADER_TECHNICAL_AUDIT.md).
 * Unlike basic-motion-adapter.ts, this adapter does not wrap an existing
 * rendering system — it is the first capability whose execution technology
 * (raw WebGL) is genuinely new to this codebase, which is the whole point of
 * building it: proving the Selector/Adapter/Registry seam generalizes.
 *
 * This adapter is deliberately declarative and DOM-free. It never touches
 * `window`/`document`/WebGL itself — that stays entirely inside the client
 * runtime (components/design-preview/shader-hero-runtime.tsx), the only
 * layer allowed to know about the real visitor's browser/device (the same
 * Selector/Adapter-vs-Runtime device-independence boundary Phase 6.5 already
 * established). `execute()` here only decides "is there real, complete
 * per-business data to hand the client a config with" and produces that
 * config (sanitized color stops); the client runtime decides "can THIS
 * visitor's browser actually run a shader with it."
 *
 * requirementsMet checks two real preconditions, both already-available data
 * — never a device check:
 *   1. The hero does not already have a real photograph driving its own
 *      background (design-preview.tsx's `heroHasScrim` condition — only
 *      "image-full-bleed"/"centered-cinematic" patterns with a real photo
 *      paint it as the section's own background). Real business photography
 *      always wins; the shader is reserved for hero patterns with no photo
 *      to protect, sidestepping any "does an animated background obscure or
 *      misrepresent real evidence" question entirely rather than trying to
 *      blend the two.
 *   2. DesignMemory.colorPalette actually has real primary/secondary/accent
 *      values to derive shader color stops from — never a fixed, generic
 *      color recipe shared across every granted business (which would be
 *      exactly the flattening failure this whole architecture exists to
 *      prevent).
 */

export interface ShaderHeroColorPalette {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
}

export interface ShaderHeroAdapterInput {
  /** True only when the hero's own resolved pattern already paints a real photograph as its background (design-preview.tsx's heroHasScrim) — real evidence always takes precedence over atmospheric decoration. */
  heroHasRealPhoto: boolean;
  /** DesignMemory.colorPalette, passed through unchanged — the same real per-business signal design-preview.tsx already sanitizes via toSafeCssColor for every other on-page color. */
  colorPalette: ShaderHeroColorPalette;
}

/** Sanitized, ready-to-render color stops the client runtime derives its shader uniforms from — always three real CSS colors when status is "active", never present (null) when it isn't, so a caller can branch on payload.colors alone without also inspecting status. */
export interface ShaderHeroPayload {
  colors: { primary: string; secondary: string; accent: string } | null;
}

const SHADER_FALLBACK_PRIMARY = "#1a1a2e";
const SHADER_FALLBACK_SECONDARY = "#16213e";
const SHADER_FALLBACK_ACCENT = "#0f3460";

function emptyPayload(): ShaderHeroPayload {
  return { colors: null };
}

/**
 * requirementsMet: real, non-empty raw palette strings for all three roles,
 * AND no real photograph already occupying the hero background. Checks raw
 * presence specifically (`!!value?.trim()`), not merely that a sanitized
 * fallback color would exist — toSafeCssColor always returns *something*
 * (its own fallback) even for missing input, which would make a presence
 * check against its output meaningless; this is why the raw palette is
 * checked here and sanitization happens separately, only once requirements
 * are already confirmed met.
 */
function requirementsMet(input: ShaderHeroAdapterInput): boolean {
  if (input.heroHasRealPhoto) return false;
  const { primary, secondary, accent } = input.colorPalette;
  return !!primary?.trim() && !!secondary?.trim() && !!accent?.trim();
}

function execute(input: ShaderHeroAdapterInput): CapabilityExecutionResult<ShaderHeroPayload> {
  const colors = {
    primary: toSafeCssColor(input.colorPalette.primary, SHADER_FALLBACK_PRIMARY),
    secondary: toSafeCssColor(input.colorPalette.secondary, SHADER_FALLBACK_SECONDARY),
    accent: toSafeCssColor(input.colorPalette.accent, SHADER_FALLBACK_ACCENT),
  };
  return { token: "shader-enhanced-hero", status: "active", payload: { colors } };
}

/**
 * Safe degrade: colors: null. The caller (lib/design-intelligence/
 * capability-hero-execution.ts) treats this identically to "capability not
 * granted at all" — the hero simply renders its existing, unchanged
 * background, exactly as it did before this capability existed. There is no
 * intermediate "broken shader" state to represent, by construction.
 */
function fallback(_input: ShaderHeroAdapterInput, failureReason: CapabilityFailureReason): CapabilityExecutionResult<ShaderHeroPayload> {
  return { token: "shader-enhanced-hero", status: "fallback-active", failureReason, payload: emptyPayload() };
}

function qaContract(result: CapabilityExecutionResult<ShaderHeroPayload>): CapabilityQaContract {
  return {
    expected: "shader-enhanced-hero",
    actual: result.status === "active" ? "shader-enhanced-hero" : "static-fallback",
    status: result.status === "active" ? "active" : "degraded-but-valid",
  };
}

export const shaderHeroAdapter: CapabilityAdapter<ShaderHeroAdapterInput, ShaderHeroPayload> = {
  token: "shader-enhanced-hero",
  requirementsMet,
  execute,
  fallback,
  /**
   * "gate-initialization" — declared, not yet enforced by this file itself
   * (this adapter never touches WebGL). The real enforcement lives in
   * shader-hero-runtime.tsx, which checks prefers-reduced-motion BEFORE any
   * getContext() call, mirroring scroll-reveal-runtime.tsx's own "return
   * before touching the DOM" placement exactly. Declared here so the port's
   * own contract (every adapter states its strategy) stays honest even
   * though the strategy is fulfilled one layer downstream, in the runtime
   * that this adapter's declarative payload feeds.
   */
  reducedMotionStrategy: "gate-initialization",
  possibleFailureReasons: ["requirements-not-met", "runtime-error"],
  qaContract,
};
