import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { isServerlessChromeRuntime, resolveChromeLaunchConfig } from "@/lib/adapters/chrome-runtime";

// Fix C (Design Intelligence Gap Map) — only the pure environment-branching
// logic is unit-tested here. The two real Chrome-launch paths (local
// `puppeteer`, and `@sparticuz/chromium-min` + `puppeteer-core` on Vercel)
// are deliberately left to real verification, matching the existing,
// established precedent for this codebase's other Chrome-launching adapters
// (screenshot-adapter.ts, accessibility-adapter.ts, lighthouse-adapter.ts —
// none of which have unit tests either): a real headless-browser launch is
// an integration concern, not something worth mocking out for a unit test.

let originalVercelEnv: string | undefined;

describe("chrome-runtime: isServerlessChromeRuntime", () => {
  beforeEach(() => {
    originalVercelEnv = process.env.VERCEL;
  });

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercelEnv;
  });

  test("is false on a local dev machine (VERCEL unset) — matches the incident's own Windows dev environment", () => {
    delete process.env.VERCEL;
    assert.equal(isServerlessChromeRuntime(), false);
  });

  test("is true on any Vercel deployment, preview or production (VERCEL is set)", () => {
    process.env.VERCEL = "1";
    assert.equal(isServerlessChromeRuntime(), true);
  });
});

describe("chrome-runtime: resolveChromeLaunchConfig — local dev branch", () => {
  beforeEach(() => {
    originalVercelEnv = process.env.VERCEL;
    delete process.env.VERCEL;
  });

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercelEnv;
  });

  test("returns an undefined chromePath (chrome-launcher auto-detects a local install) and the pre-fix flags, without touching @sparticuz/chromium-min", async () => {
    const config = await resolveChromeLaunchConfig();
    assert.equal(config.chromePath, undefined);
    assert.deepEqual(config.chromeFlags, ["--headless", "--no-sandbox"]);
  });
});
