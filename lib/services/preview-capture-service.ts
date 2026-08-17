import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { websiteDesignRepository, type WebsiteDesignRow } from "@/lib/repositories/website-design-repository";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";
import { resolveQaPreviewAccessConfig, acquireQaPreviewAccess } from "@/lib/services/qa-preview-access";
import { runPreviewScreenshotCapture } from "@/lib/adapters/rendered-preview-adapter";

type TypedClient = SupabaseClient<Database>;

/**
 * preview-capture-service.ts — Phase 4's real screenshot capture of the
 * LIVE, authenticated Design Preview route (app/missions/[id]/preview/
 * page.tsx). This is explicitly NOT a deployment: no external host, no
 * public URL, no vendor integration — lib/workflow/mission-state.ts's own
 * documented decision is that a `deployment` mission state was deliberately
 * removed, since "publishing a preview build is a sub-activity of QA/design
 * review, tracked via events... rather than a pipeline gate." This service
 * is that sub-activity: it reuses the exact real authenticated-access
 * mechanism Design QA's own Rendered checks already use (lib/services/
 * qa-preview-access.ts — no new auth flow, no second implementation of the
 * same magic-link dance), captures real PNG screenshots at desktop and
 * mobile viewports (lib/adapters/rendered-preview-adapter.ts's new
 * runPreviewScreenshotCapture, the keep-the-bytes counterpart to the
 * existing measure-and-discard one QA uses), and uploads them to the same
 * private "website-screenshots" bucket the ORIGINAL business's own site
 * screenshot already lives in (lib/services/analysis-service.ts) — under a
 * `design/` path segment, so no new bucket or RLS policy is needed.
 *
 * Honest failure, not a fabricated pass: if QA_PREVIEW_* isn't configured,
 * or the real magic-link sign-in doesn't succeed, this throws with the real
 * reason — the caller persists that as `preview_screenshot_error`, the same
 * "UNAVAILABLE, never a silent fake" discipline Rendered QA already holds
 * itself to. No mission-state transition happens here, ever — capturing (or
 * failing to capture) a preview screenshot is not a pipeline gate.
 */

const SCREENSHOT_BUCKET = "website-screenshots";

export interface PreviewCaptureServiceDeps {
  client: TypedClient;
  websiteDesignRepository: Pick<typeof websiteDesignRepository, "findById" | "update">;
  missionRepository: Pick<typeof missionRepository, "findById">;
  eventBus: EventBus;
  resolveQaPreviewAccessConfig: typeof resolveQaPreviewAccessConfig;
  acquireQaPreviewAccess: typeof acquireQaPreviewAccess;
  runPreviewScreenshotCapture: typeof runPreviewScreenshotCapture;
}

export function createPreviewCaptureServiceDeps(client: TypedClient): PreviewCaptureServiceDeps {
  return {
    client,
    websiteDesignRepository,
    missionRepository,
    eventBus: createEventBus(client),
    resolveQaPreviewAccessConfig,
    acquireQaPreviewAccess,
    runPreviewScreenshotCapture,
  };
}

/**
 * runPreviewCapture — requires a `complete` website_designs row (a real
 * generated design must exist; QA does not need to have run first — a
 * preview screenshot of the generated design is meaningful independent of
 * its QA verdict). Uploads with the caller's own client (a service-role
 * client when invoked from the fire-and-forget API route, matching every
 * other background Design Engine step's own ADR-012 pattern) since the
 * upload happens well after any user session that triggered it.
 */
export async function runPreviewCapture(deps: PreviewCaptureServiceDeps, websiteDesignId: string): Promise<WebsiteDesignRow> {
  const run = await deps.websiteDesignRepository.findById(deps.client, websiteDesignId);
  if (!run) throw new Error(`Website design ${websiteDesignId} not found.`);

  const mission = await deps.missionRepository.findById(deps.client, run.mission_id);
  if (!mission) throw new Error(`Mission ${run.mission_id} not found.`);

  try {
    if (run.status !== "complete" || !run.wireframe || !run.components) {
      throw new Error("This website design run is not complete — Preview Capture requires a real generated wireframe and components first.");
    }

    const accessConfig = deps.resolveQaPreviewAccessConfig();
    if (!accessConfig) {
      throw new Error(
        "QA_PREVIEW_* environment not configured — real preview screenshot capture requires the same explicit, opt-in QA validation account as Rendered QA (see lib/services/qa-preview-access.ts). No external deployment exists in this codebase; this captures the live, authenticated in-app preview only."
      );
    }

    const access = await deps.acquireQaPreviewAccess(accessConfig);
    if (!access.available) {
      throw new Error(`Could not sign in to capture a real preview screenshot: ${access.reason}`);
    }

    const previewUrl = `${accessConfig.appBaseUrl}/missions/${mission.id}/preview?designId=${run.id}`;
    const captured = await deps.runPreviewScreenshotCapture(previewUrl, { cookies: access.cookies });
    if (!captured.desktop || !captured.mobile) {
      throw new Error(captured.fetchError ?? "Preview screenshot capture produced no image data.");
    }

    const desktopPath = `${mission.organization_id}/${mission.id}/design/${run.id}/desktop.png`;
    const mobilePath = `${mission.organization_id}/${mission.id}/design/${run.id}/mobile.png`;

    const [desktopUpload, mobileUpload] = await Promise.all([
      deps.client.storage.from(SCREENSHOT_BUCKET).upload(desktopPath, captured.desktop, { contentType: "image/png", upsert: true }),
      deps.client.storage.from(SCREENSHOT_BUCKET).upload(mobilePath, captured.mobile, { contentType: "image/png", upsert: true }),
    ]);
    if (desktopUpload.error) throw desktopUpload.error;
    if (mobileUpload.error) throw mobileUpload.error;

    const updated = await deps.websiteDesignRepository.update(deps.client, run.id, {
      preview_screenshot_desktop_path: desktopPath,
      preview_screenshot_mobile_path: mobilePath,
      preview_screenshot_captured_at: new Date().toISOString(),
      preview_screenshot_error: null,
    });

    await deps.eventBus.publish({
      type: "PreviewScreenshotCaptured",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: { desktopPath, mobilePath },
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview screenshot capture failed for an unknown reason.";

    await deps.websiteDesignRepository.update(deps.client, run.id, {
      preview_screenshot_error: message,
    });

    await deps.eventBus.publish({
      type: "PreviewScreenshotFailed",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: { errorMessage: message },
    });

    throw err instanceof Error ? err : new Error(message);
  }
}
