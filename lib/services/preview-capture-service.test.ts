import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runPreviewCapture, type PreviewCaptureServiceDeps } from "@/lib/services/preview-capture-service";
import type { WebsiteDesignRow } from "@/lib/repositories/website-design-repository";
import type { MissionRow } from "@/lib/repositories/mission-repository";
import type { QaPreviewAccessConfig, QaPreviewAccess } from "@/lib/services/qa-preview-access";
import type { PreviewScreenshotCaptureResult } from "@/lib/adapters/rendered-preview-adapter";
import type { DomainEvent } from "@/lib/events/types";

function fakeWebsiteDesign(overrides: Partial<WebsiteDesignRow> = {}): WebsiteDesignRow {
  return {
    id: "design-1",
    design_brief_id: "brief-1",
    mission_id: "mission-1",
    organization_id: "org-1",
    status: "complete",
    wireframe: { layoutFamily: "editorial", sections: [], signatureElement: "x" } as unknown as WebsiteDesignRow["wireframe"],
    components: [{ section: "hero", componentKind: "hero-editorial", slots: [] }] as unknown as WebsiteDesignRow["components"],
    refined_design: null,
    qa_result: null,
    preview_screenshot_desktop_path: null,
    preview_screenshot_mobile_path: null,
    preview_screenshot_captured_at: null,
    preview_screenshot_error: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: "",
    ...overrides,
  };
}

function fakeMission(overrides: Partial<MissionRow> = {}): MissionRow {
  return {
    id: "mission-1",
    owner_id: "user-1",
    organization_id: "org-1",
    business_name: "Acme Diner",
    website_url: "https://acme-diner.test/",
    company_id: null,
    state: "qa",
    state_changed_at: "",
    created_at: "",
    updated_at: "",
  } as MissionRow;
}

const FAKE_CONFIG: QaPreviewAccessConfig = {
  appBaseUrl: "http://localhost:3000",
  mailpitBaseUrl: "http://localhost:54324",
  validationUserEmail: "validation@obsidian-local.test",
  supabaseUrl: "http://localhost:54321",
  supabaseAnonKey: "anon-key",
};

/** In-memory fake of the whole dependency surface — real enough to exercise every branch of runPreviewCapture without a database, Puppeteer, or network I/O. */
function createFakeDeps(overrides: {
  websiteDesign?: WebsiteDesignRow | null;
  mission?: MissionRow | null;
  accessConfig?: QaPreviewAccessConfig | null;
  access?: QaPreviewAccess;
  captureResult?: PreviewScreenshotCaptureResult;
  uploadError?: Error | null;
}): PreviewCaptureServiceDeps & {
  updatedValues: Record<string, unknown>[];
  publishedEvents: DomainEvent[];
  uploadedPaths: string[];
  uploadedBuffers: Record<string, Buffer>;
} {
  const websiteDesign = overrides.websiteDesign === undefined ? fakeWebsiteDesign() : overrides.websiteDesign;
  const mission = overrides.mission === undefined ? fakeMission() : overrides.mission;
  const updatedValues: Record<string, unknown>[] = [];
  const publishedEvents: DomainEvent[] = [];
  const uploadedPaths: string[] = [];
  const uploadedBuffers: Record<string, Buffer> = {};
  let currentDesign = websiteDesign;

  const client = {
    storage: {
      from: (_bucket: string) => ({
        upload: async (path: string, buffer: Buffer, _opts: unknown) => {
          uploadedPaths.push(path);
          uploadedBuffers[path] = buffer;
          return { error: overrides.uploadError ?? null };
        },
      }),
    },
  } as unknown as PreviewCaptureServiceDeps["client"];

  return {
    client,
    websiteDesignRepository: {
      async findById() {
        return currentDesign;
      },
      async update(_client, _id, values) {
        updatedValues.push(values as Record<string, unknown>);
        currentDesign = { ...(currentDesign as WebsiteDesignRow), ...values } as WebsiteDesignRow;
        return currentDesign;
      },
    },
    missionRepository: {
      async findById() {
        return mission;
      },
    },
    eventBus: {
      async publish(event) {
        publishedEvents.push(event);
      },
      subscribe: () => () => {},
    },
    resolveQaPreviewAccessConfig: () => (overrides.accessConfig === undefined ? FAKE_CONFIG : overrides.accessConfig),
    acquireQaPreviewAccess: async () => overrides.access ?? { available: true, cookies: [{ name: "sb-token", value: "x", domain: "localhost" }], cookieHeader: "sb-token=x" },
    runPreviewScreenshotCapture: async () =>
      overrides.captureResult ?? { desktop: Buffer.from("desktop-png"), mobile: Buffer.from("mobile-png") },
    updatedValues,
    publishedEvents,
    uploadedPaths,
    uploadedBuffers,
  };
}

describe("preview-capture-service: runPreviewCapture (Phase 4 — real screenshot of the live preview, NOT a deployment)", () => {
  test("real success path: uploads real desktop+mobile buffers, persists real paths, publishes PreviewScreenshotCaptured, never touches mission state", async () => {
    const deps = createFakeDeps({});
    const result = await runPreviewCapture(deps, "design-1");

    assert.equal(result.preview_screenshot_desktop_path, "org-1/mission-1/design/design-1/desktop.png");
    assert.equal(result.preview_screenshot_mobile_path, "org-1/mission-1/design/design-1/mobile.png");
    assert.ok(result.preview_screenshot_captured_at);
    assert.equal(result.preview_screenshot_error, null);
    assert.deepEqual(deps.uploadedPaths.sort(), ["org-1/mission-1/design/design-1/desktop.png", "org-1/mission-1/design/design-1/mobile.png"]);
    assert.equal(deps.publishedEvents.length, 1);
    assert.equal(deps.publishedEvents[0].type, "PreviewScreenshotCaptured");
  });

  test("throws when the website design run is not complete — never attempts a capture of an incomplete generation", async () => {
    const deps = createFakeDeps({ websiteDesign: fakeWebsiteDesign({ status: "running", wireframe: null }) });
    await assert.rejects(() => runPreviewCapture(deps, "design-1"), /not complete/);
    assert.equal(deps.uploadedPaths.length, 0);
  });

  test("honest failure when QA_PREVIEW_* isn't configured — no fabricated screenshot, real reason persisted", async () => {
    const deps = createFakeDeps({ accessConfig: null });
    await assert.rejects(() => runPreviewCapture(deps, "design-1"), /QA_PREVIEW_\* environment not configured/);
    const failedUpdate = deps.updatedValues.find((v) => v.preview_screenshot_error);
    assert.match(failedUpdate?.preview_screenshot_error as string, /QA_PREVIEW_\*/);
    assert.equal(deps.publishedEvents[0].type, "PreviewScreenshotFailed");
    assert.equal(deps.uploadedPaths.length, 0);
  });

  test("honest failure when the real magic-link sign-in doesn't succeed — the real reason from acquireQaPreviewAccess is preserved, not replaced with a generic message", async () => {
    const deps = createFakeDeps({ access: { available: false, reason: "No sign-in email arrived within 15s." } });
    await assert.rejects(() => runPreviewCapture(deps, "design-1"), /No sign-in email arrived within 15s\./);
  });

  test("honest failure when screenshot capture itself produces no image data", async () => {
    const deps = createFakeDeps({ captureResult: { desktop: null, mobile: null, fetchError: "Navigation timed out" } });
    await assert.rejects(() => runPreviewCapture(deps, "design-1"), /Navigation timed out/);
  });

  test("honest failure when the Storage upload itself fails — never silently swallowed", async () => {
    const deps = createFakeDeps({ uploadError: new Error("Storage quota exceeded") });
    await assert.rejects(() => runPreviewCapture(deps, "design-1"), /Storage quota exceeded/);
  });

  test("throws for a missing website design row", async () => {
    const deps = createFakeDeps({ websiteDesign: null });
    await assert.rejects(() => runPreviewCapture(deps, "design-404"), /not found/);
  });

  test("real screenshot bytes are the ones actually uploaded, not fabricated placeholders", async () => {
    const desktopBytes = Buffer.from("REAL-DESKTOP-PNG-BYTES");
    const mobileBytes = Buffer.from("REAL-MOBILE-PNG-BYTES");
    const deps = createFakeDeps({ captureResult: { desktop: desktopBytes, mobile: mobileBytes } });
    await runPreviewCapture(deps, "design-1");
    assert.equal(deps.uploadedBuffers["org-1/mission-1/design/design-1/desktop.png"]?.toString(), "REAL-DESKTOP-PNG-BYTES");
    assert.equal(deps.uploadedBuffers["org-1/mission-1/design/design-1/mobile.png"]?.toString(), "REAL-MOBILE-PNG-BYTES");
  });
});
