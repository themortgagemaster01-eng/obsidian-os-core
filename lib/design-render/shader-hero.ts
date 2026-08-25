export { REDUCED_MOTION_QUERY } from "@/lib/design-render/scroll-reveal";

/**
 * lib/design-render/shader-hero.ts — Phase 6.6's shader-enhanced-hero
 * capability: pure constants and pure logic, mirroring lib/design-render/
 * scroll-reveal.ts's own shape exactly (kept dependency-free, no browser
 * globals referenced at module scope, so the real decision logic here is
 * unit-testable the same way every other pure module in this codebase
 * already is). Shared by shader-hero-adapter.ts (which never touches any of
 * the runtime pieces below — it only produces the color config) and
 * components/design-preview/shader-hero-runtime.tsx (the client component
 * that actually drives WebGL).
 *
 * This module makes no decision about WHETHER a hero should get a shader —
 * that decision was already made by lib/design-intelligence/capability-
 * selector.ts's isShaderHeroGranted and lib/design-intelligence/shader-hero-
 * adapter.ts's requirementsMet. This module only decides HOW the already-
 * granted, already-configured shader initializes and runs safely: whether to
 * even attempt WebGL at all (never for a reduced-motion visitor), at what
 * internal resolution, at what frame cadence — plus the actual GLSL source
 * for the one bounded procedural noise treatment this phase ships.
 *
 * Re-exports REDUCED_MOTION_QUERY from scroll-reveal.ts rather than
 * redefining the same media-query string a second time — both runtimes must
 * key off the identical condition so they can never disagree about which
 * visitors get no motion.
 */

/** The attribute design-preview.tsx emits on the hero section only when shader-enhanced-hero was granted AND its adapter's requirementsMet cleared (a real, sanitized color config exists) — absent entirely otherwise, mirroring scroll-reveal.ts's own SCROLL_REVEAL_SELECTOR "absent means nothing to do" discipline. The runtime's query root. */
export const SHADER_HERO_SELECTOR = "[data-op-shader-hero]";

/**
 * Internal canvas resolution is deliberately decoupled from CSS display
 * size. Capping the effective device-pixel-ratio contribution well below a
 * real device's own value (mobile Safari commonly reports 3) meaningfully
 * cuts GPU cost for a soft, slow-drifting noise field where the difference
 * is not perceptible — visual softness already hides resolution limits.
 */
export const SHADER_MAX_DEVICE_PIXEL_RATIO = 1.5;

/** Absolute cap on internal canvas pixel dimensions, independent of viewport size — CSS/compositor upscaling covers the remaining gap. Applied per-dimension. */
export const SHADER_MAX_INTERNAL_DIMENSION_PX = 1600;

/**
 * Explicitly throttled below the display's own refresh rate — an
 * atmospheric, slow-drifting visual has no perceptible quality loss at this
 * cadence, and the saved frames are real, direct GPU/battery savings. Frames
 * are SKIPPED (the RAF loop still runs at the browser's native cadence but
 * only does real work on a throttled subset), never achieved by requesting a
 * slower RAF cadence, which some browsers don't honor consistently.
 */
export const SHADER_TARGET_FPS = 28;
export const SHADER_MIN_FRAME_INTERVAL_MS = Math.round(1000 / SHADER_TARGET_FPS);

/**
 * The one gate that must be checked BEFORE any WebGL work — not "start then
 * hide," but "never even attempt." A reduced-motion visitor never pays for a
 * getContext() call, a shader compile, or a single RAF tick — mirroring
 * scroll-reveal-runtime.tsx's own "check before touching the DOM" placement,
 * applied here to a meaningfully more expensive operation than a DOM
 * attribute toggle. webglSupported is passed in rather than checked here so
 * this function stays pure and unit-testable without a real browser/canvas —
 * the runtime component is responsible for the actual getContext() probe.
 */
export function shouldInitializeShader(prefersReducedMotion: boolean, webglSupported: boolean): boolean {
  if (prefersReducedMotion) return false;
  return webglSupported;
}

/** Plain geometry in, capped geometry out — no DOM access, matching scroll-reveal.ts's own ElementViewportGeometry precedent of pre-measured numbers passed in rather than touched here. */
export interface CanvasResolutionInput {
  cssWidthPx: number;
  cssHeightPx: number;
  devicePixelRatio: number;
}

export interface CanvasResolution {
  width: number;
  height: number;
}

/**
 * resolveCanvasInternalResolution — the concrete mechanism behind the two
 * mobile-cost caps above. Clamps the effective DPR first, then clamps each
 * resulting dimension independently against SHADER_MAX_INTERNAL_DIMENSION_PX
 * — a very wide, short hero and a narrower, taller one are both protected on
 * their own worst axis, never only checked against one combined figure that
 * could let one dimension run away while the other stays small.
 */
export function resolveCanvasInternalResolution(input: CanvasResolutionInput): CanvasResolution {
  const dpr = Math.max(0, Math.min(input.devicePixelRatio, SHADER_MAX_DEVICE_PIXEL_RATIO));
  const width = Math.min(Math.round(input.cssWidthPx * dpr), SHADER_MAX_INTERNAL_DIMENSION_PX);
  const height = Math.min(Math.round(input.cssHeightPx * dpr), SHADER_MAX_INTERNAL_DIMENSION_PX);
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/**
 * shouldRenderFrame — the frame-throttle decision, extracted as its own pure
 * function (trivial today) because "this shader must not run at an
 * unnecessary, undamped frame rate" is a named, explicit Phase 6.6
 * requirement, not an incidental detail of the RAF-loop-wiring code.
 */
export function shouldRenderFrame(lastRenderTimestampMs: number, nowMs: number): boolean {
  return nowMs - lastRenderTimestampMs >= SHADER_MIN_FRAME_INTERVAL_MS;
}

/**
 * A trivial, always-successful full-screen triangle — the standard,
 * well-known technique for covering a viewport with exactly one draw call
 * and no vertex buffer beyond three points, avoiding the two-triangle-quad's
 * extra vertices for no visual difference (the triangle's excess beyond the
 * viewport is clipped for free by the GPU's own rasterizer).
 */
export const SHADER_VERTEX_SOURCE = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * One bounded, deliberately simple domain-warped value-noise field — a
 * single noise octave, not multi-octave fractal noise, per the approved
 * "one visual family, GPU cost bounded by design, not only by runtime
 * knobs" scope. Colors come entirely from three uniforms (u_colorPrimary/
 * Secondary/Accent) sourced from this business's own real DesignMemory
 * palette (shader-hero-adapter.ts) — never a fixed palette baked into the
 * shader itself, which would flatten every granted business into the same
 * look. Procedural and non-representational by construction: nothing here
 * samples a texture, an image, or any evidence source — it depicts nothing,
 * carrying zero fabrication risk (docs/PHASE_6.6_SHADER_TECHNICAL_AUDIT.md's
 * own non-negotiable).
 */
export const SHADER_FRAGMENT_SOURCE = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_colorPrimary;
uniform vec3 u_colorSecondary;
uniform vec3 u_colorAccent;

vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0));
  float b = dot(hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 aspectUv = vec2(uv.x * (u_resolution.x / u_resolution.y), uv.y);

  float t = u_time * 0.03;
  vec2 warp = vec2(valueNoise(aspectUv * 1.4 + t), valueNoise(aspectUv * 1.4 - t));
  float n = valueNoise(aspectUv * 1.8 + warp * 0.6 + t * 0.5);
  n = n * 0.5 + 0.5;

  vec3 base = mix(u_colorPrimary, u_colorSecondary, uv.y);
  vec3 color = mix(base, u_colorAccent, smoothstep(0.35, 0.85, n) * 0.5);

  // A fixed, deterministic darkening PLUS a hard per-channel ceiling — the
  // canvas fully occludes the CSS gradient fallback underneath once it
  // mounts (they occupy the same painted area), so this shader must
  // independently guarantee the same legible-text contrast range the CSS
  // fallback's own dark scrim provides, never relying on one layer to
  // protect the other. The multiplicative factor alone is not sufficient: a
  // real-browser WebGL check against a light/pastel business palette
  // (worst-case accent #ffffff) measured a peak channel of 139/255 after
  // only the *0.55 factor — WCAG relative luminance ~0.26, contrast against
  // design-preview.tsx's FALLBACK.onDark (#FAFAFA, luminance ~0.955) of only
  // ~1.7:1, well under the 4.5:1 AA floor safe-css.ts's own
  // WCAG_AA_NORMAL_TEXT_CONTRAST already enforces elsewhere in this
  // codebase. The added vec3(0.35) ceiling caps worst-case luminance at
  // ~0.10 (contrast ~6.7:1 against FALLBACK.onDark, real margin above AA),
  // verified the same way — real browser, real readPixels, not assumed.
  // Darker input palettes still render proportionally darker (the *0.55
  // factor keeps doing real work below the ceiling); only a palette bright
  // enough to need it ever gets clamped.
  gl_FragColor = vec4(min(color * 0.55, vec3(0.35)), 1.0);
}
`;
