import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { extractConfirmationLink, resolveQaPreviewAccessConfig } from "@/lib/services/qa-preview-access";

const SUPABASE_URL = "http://127.0.0.1:54321";

describe("qa-preview-access: extractConfirmationLink", () => {
  test("finds the real Supabase verify link inside an HTML email body", () => {
    const html = `<html><body><p>Click <a href="${SUPABASE_URL}/auth/v1/verify?token=abc123&amp;type=magiclink&amp;redirect_to=http://localhost:3000/auth/callback">this link</a> to sign in.</p></body></html>`;
    const link = extractConfirmationLink(html, SUPABASE_URL);
    assert.equal(link, `${SUPABASE_URL}/auth/v1/verify?token=abc123&type=magiclink&redirect_to=http://localhost:3000/auth/callback`);
  });

  test("finds the link inside a plain-text email body", () => {
    const text = `Sign in here: ${SUPABASE_URL}/auth/v1/verify?token=xyz&type=magiclink&redirect_to=http://localhost:3000/auth/callback\n\nThanks.`;
    const link = extractConfirmationLink(text, SUPABASE_URL);
    assert.equal(link, `${SUPABASE_URL}/auth/v1/verify?token=xyz&type=magiclink&redirect_to=http://localhost:3000/auth/callback`);
  });

  test("returns null when no verify link is present", () => {
    const link = extractConfirmationLink("<html><body>No link here.</body></html>", SUPABASE_URL);
    assert.equal(link, null);
  });

  test("does not match a verify link for a different Supabase URL", () => {
    const html = `<a href="https://someone-elses-project.supabase.co/auth/v1/verify?token=abc">link</a>`;
    const link = extractConfirmationLink(html, SUPABASE_URL);
    assert.equal(link, null);
  });
});

describe("qa-preview-access: resolveQaPreviewAccessConfig", () => {
  test("returns null when any required env var is missing — Rendered QA is UNAVAILABLE by default, never a hardcoded fallback account", () => {
    const config = resolveQaPreviewAccessConfig({});
    assert.equal(config, null);
  });

  test("returns a config only when every required var is present", () => {
    const config = resolveQaPreviewAccessConfig({
      QA_PREVIEW_APP_BASE_URL: "http://localhost:3000",
      QA_PREVIEW_MAILPIT_URL: "http://localhost:54324",
      QA_PREVIEW_VALIDATION_USER_EMAIL: "validation@obsidian-local.test",
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
    assert.ok(config);
    assert.equal(config?.validationUserEmail, "validation@obsidian-local.test");
  });
});
