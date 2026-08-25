"use client";

import * as React from "react";

import {
  SHADER_HERO_SELECTOR,
  REDUCED_MOTION_QUERY,
  SHADER_VERTEX_SOURCE,
  SHADER_FRAGMENT_SOURCE,
  shouldInitializeShader,
  shouldRenderFrame,
  resolveCanvasInternalResolution,
} from "@/lib/design-render/shader-hero";

/**
 * ShaderHeroRuntime — Phase 6.6's shader-enhanced-hero execution, the client
 * half of the capability whose declarative half (color config only) lives in
 * lib/design-intelligence/shader-hero-adapter.ts. Mounted once per
 * DesignPreview render (see design-preview.tsx), sibling to
 * ScrollRevealRuntime; renders nothing itself (returns null) — its entire
 * job is imperative canvas/WebGL lifecycle, mirroring scroll-reveal-
 * runtime.tsx's own shape exactly: guard before touching the DOM, do real
 * work only if a real marker element exists, clean up completely.
 *
 * No dependency added — this is plain WebGL1, a standard browser API this
 * app's audience already has, the same "no polyfill needed" precedent
 * ScrollRevealRuntime already sets for IntersectionObserver.
 *
 * Never the sole source of the hero's visual identity: design-preview.tsx
 * always renders a complete, per-business, palette-derived static gradient
 * as the mount element's own CSS background before this component ever
 * runs. The canvas this component creates is a strictly additive layer on
 * top of that gradient — every failure path below simply results in the
 * canvas never mounting (or being torn down), never in a blank or broken
 * hero, because the gradient underneath was never replaced, only overlaid.
 */
export function ShaderHeroRuntime(): null {
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    // Reduced motion: the one check that must happen before ANY WebGL work
    // — never getContext(), never a shader compile, never a single RAF
    // tick. Mirrors scroll-reveal-runtime.tsx's own "check before touching
    // the DOM" placement, applied here to a meaningfully more expensive
    // operation than a DOM attribute toggle.
    const prefersReducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;

    const mount = document.querySelector<HTMLElement>(SHADER_HERO_SELECTOR);
    if (!mount) return; // Not granted, or the adapter's own requirementsMet didn't clear — nothing to do.

    const webglSupported = typeof window.WebGLRenderingContext !== "undefined";
    if (!shouldInitializeShader(prefersReducedMotion, webglSupported)) return;

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
    if (!gl) return; // WebGL unavailable / context creation failure / unsupported browser — leave the static gradient exactly as it is.

    // Everything from here is caught as one unit — a compile/link failure
    // partway through must not leave a half-created program or a canvas
    // appended with nothing to draw with. On any failure, the canvas simply
    // never gets appended, and the static gradient remains the entire
    // visible state.
    const setup = createShaderProgram(gl);
    if (!setup) return;

    const style = window.getComputedStyle(mount);
    const colorPrimary = parseCssColorToRgb(style.getPropertyValue("--op-shader-primary")) ?? [0.1, 0.1, 0.18];
    const colorSecondary = parseCssColorToRgb(style.getPropertyValue("--op-shader-secondary")) ?? [0.09, 0.13, 0.24];
    const colorAccent = parseCssColorToRgb(style.getPropertyValue("--op-shader-accent")) ?? [0.06, 0.2, 0.38];

    mount.style.position = mount.style.position || "relative";
    mount.appendChild(canvas);

    let rafHandle: number | null = null;
    let disposed = false;
    let paused = false;
    let lastRenderTimestampMs = 0;
    const startTimestampMs = performance.now();

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const { width, height } = resolveCanvasInternalResolution({
        cssWidthPx: rect.width,
        cssHeightPx: rect.height,
        devicePixelRatio: window.devicePixelRatio || 1,
      });
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };
    resize();

    const renderFrame = (nowMs: number) => {
      if (disposed) return;
      rafHandle = requestAnimationFrame(renderFrame);
      if (paused) return;
      if (!shouldRenderFrame(lastRenderTimestampMs, nowMs)) return;
      lastRenderTimestampMs = nowMs;

      try {
        gl.useProgram(setup.program);
        gl.uniform2f(setup.uniforms.resolution, canvas.width, canvas.height);
        gl.uniform1f(setup.uniforms.time, (nowMs - startTimestampMs) / 1000);
        gl.uniform3f(setup.uniforms.colorPrimary, colorPrimary[0], colorPrimary[1], colorPrimary[2]);
        gl.uniform3f(setup.uniforms.colorSecondary, colorSecondary[0], colorSecondary[1], colorSecondary[2]);
        gl.uniform3f(setup.uniforms.colorAccent, colorAccent[0], colorAccent[1], colorAccent[2]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } catch {
        // Runtime shader failure mid-session: stop permanently, tear
        // everything down, and let the static gradient underneath — never
        // covered by replacement, only overlay — be the entire visible
        // state again.
        dispose();
      }
    };

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      gl.deleteProgram(setup.program);
      gl.deleteBuffer(setup.buffer);
      if (canvas.parentElement === mount) mount.removeChild(canvas);
    };

    const onVisibilityChange = () => {
      paused = document.visibilityState !== "visible" || !isIntersecting;
    };

    let isIntersecting = false;
    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        isIntersecting = entry.isIntersecting;
        paused = !isIntersecting || document.visibilityState !== "visible";
      }
    });
    intersectionObserver.observe(mount);

    document.addEventListener("visibilitychange", onVisibilityChange);

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(mount);

    rafHandle = requestAnimationFrame(renderFrame);

    return dispose;
  }, []);

  return null;
}

interface ShaderProgramSetup {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  uniforms: {
    resolution: WebGLUniformLocation;
    time: WebGLUniformLocation;
    colorPrimary: WebGLUniformLocation;
    colorSecondary: WebGLUniformLocation;
    colorAccent: WebGLUniformLocation;
  };
}

/** Compiles/links the one shader program this phase ships. Returns null on any failure — compilation error, link error, a missing uniform location — rather than throwing, so the caller's single guard clause covers every case identically. */
function createShaderProgram(gl: WebGLRenderingContext): ShaderProgramSetup | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, SHADER_VERTEX_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, SHADER_FRAGMENT_SOURCE);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // One triangle covering the full clip-space viewport — the standard
  // "full-screen triangle" technique: the GPU's own rasterizer clips
  // whatever falls outside [-1, 1], so no second triangle is needed.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const positionLocation = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const resolution = gl.getUniformLocation(program, "u_resolution");
  const time = gl.getUniformLocation(program, "u_time");
  const colorPrimary = gl.getUniformLocation(program, "u_colorPrimary");
  const colorSecondary = gl.getUniformLocation(program, "u_colorSecondary");
  const colorAccent = gl.getUniformLocation(program, "u_colorAccent");
  if (!resolution || !time || !colorPrimary || !colorSecondary || !colorAccent) {
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    return null;
  }

  return { program, buffer, uniforms: { resolution, time, colorPrimary, colorSecondary, colorAccent } };
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Parses a `rgb(r, g, b)` / `#rrggbb` CSS custom-property value (as set inline by design-preview.tsx, always sanitized via toSafeCssColor before reaching the DOM) into normalized [0,1] GL floats. Returns null for anything it can't parse — the caller already has a real, sensible fallback triple for that case. */
function parseCssColorToRgb(value: string): [number, number, number] | null {
  const trimmed = value.trim();
  const hexMatch = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (hexMatch) {
    const int = parseInt(hexMatch[1], 16);
    return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
  }
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(trimmed);
  if (rgbMatch) {
    return [Number(rgbMatch[1]) / 255, Number(rgbMatch[2]) / 255, Number(rgbMatch[3]) / 255];
  }
  return null;
}
