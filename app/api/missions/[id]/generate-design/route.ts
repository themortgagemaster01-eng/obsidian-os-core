import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

import { createClient } from "@/lib/supabase/server";
import { createSecretKeyClient } from "@/lib/supabase/service-role";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import { resolveScreenshotUrl } from "@/lib/presentation/resolve-screenshot-url";
import {
  createDesignGenerationRun,
  createDesignGenerationServiceDeps,
  runDesignGeneration,
  checkDesignGenerationOverlap,
} from "@/lib/services/design-generation-service";

interface RouteParams {
  params: { id: string };
}

/**
 * Vercel is free to freeze this function's execution context the instant
 * the 202 response below is sent, since the generation promise is
 * otherwise untracked background work — see the matching fix in
 * app/api/leads/scan/route.ts (commit 2873e6f). waitUntil() below keeps the
 * function alive until it settles; maxDuration raises the execution budget
 * to this Hobby-plan route's max so that extension has real time to use.
 */
export const maxDuration = 60;

/**
 * GET /api/missions/:id/generate-design — read-only counterpart to the POST
 * below, for the Founder-facing Generation/Refinement/QA panel to poll.
 * Returns the mission's latest website_designs row as-is — this single row
 * carries generation (`wireframe`/`components`), refinement
 * (`refined_design`), QA (`qa_result`), and Phase 4's preview screenshot
 * paths once each step has run, so one endpoint covers all four panels'
 * polling needs without a second read path for the same table.
 *
 * Phase 4 addition: also resolves the preview screenshot storage paths
 * (private bucket, same as the original site's own screenshot) into
 * short-lived signed URLs the browser can actually load — the same
 * resolution `screenshotUrl` already gets for the original site's
 * screenshot on GET /api/missions/:id/analysis, applied here to the new
 * design's own real screenshots.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient();

  let user;
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[GET /api/missions/${params.id}/generate-design] supabase.auth.getUser() threw:`, err);
    return NextResponse.json({ error: "Could not verify your session — please try again." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let mission;
  try {
    mission = await missionRepository.findById(supabase, params.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[GET /api/missions/${params.id}/generate-design] mission lookup failed:`, err);
    return NextResponse.json({ error: "Could not look up this mission — please try again." }, { status: 500 });
  }
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  const websiteDesign = await websiteDesignRepository.findLatestByMission(supabase, mission.id);

  const [previewScreenshotDesktopUrl, previewScreenshotMobileUrl] = await Promise.all([
    resolveScreenshotUrl(supabase, websiteDesign?.preview_screenshot_desktop_path ?? null),
    resolveScreenshotUrl(supabase, websiteDesign?.preview_screenshot_mobile_path ?? null),
  ]);

  return NextResponse.json({ websiteDesign, previewScreenshotDesktopUrl, previewScreenshotMobileUrl });
}

/**
 * POST /api/missions/:id/generate-design — triggers Sprint 4 Phase 2's
 * Wireframe + Component Assembly step. Uses the mission's latest completed
 * Design Brief automatically (no request body) — the same "find the latest
 * completed upstream artifact" pattern GET /api/missions/:id/analysis uses
 * for website_analyses, applied here to design_briefs. If no completed
 * Design Brief exists yet, returns 409 rather than creating a run that
 * runDesignGeneration() would just fail anyway — cheaper for the caller to
 * find out synchronously than to poll a run that was doomed at creation.
 *
 * Otherwise mirrors POST /api/missions/:id/design-brief and
 * .../analyze exactly (ADR-012): creates the `website_designs` row
 * synchronously and returns 202 Accepted immediately; the actual
 * generation work is invoked afterward without being awaited.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient();

  let user;
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[POST /api/missions/${params.id}/generate-design] supabase.auth.getUser() threw:`, err);
    return NextResponse.json({ error: "Could not verify your session — please try again." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: doubles as the authorization check, same pattern as the
  // other mission-scoped POST routes.
  let mission;
  try {
    mission = await missionRepository.findById(supabase, params.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[POST /api/missions/${params.id}/generate-design] mission lookup failed:`, err);
    return NextResponse.json({ error: "Could not look up this mission — please try again." }, { status: 500 });
  }
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  const designBrief = await designBriefRepository.findLatestByMission(supabase, mission.id);
  if (!designBrief || designBrief.status !== "complete") {
    return NextResponse.json(
      { error: "No completed Design Brief found for this mission — run POST /api/missions/:id/design-brief first." },
      { status: 409 }
    );
  }

  // Overlap guard: checked before creating a new row, so a caller gets a
  // real 409 instead of a duplicate generation racing the one already in
  // flight for this mission. The DB's own partial unique index
  // (website_designs_one_inflight_per_mission) is the real, final
  // authority against a genuine race between this check and the insert.
  const overlap = await checkDesignGenerationOverlap(createDesignGenerationServiceDeps(supabase), mission.id);
  if (overlap.kind === "already_running") {
    return NextResponse.json(
      {
        error: `A website generation is already ${overlap.runningRun.status} for this mission — wait for it to finish before starting another.`,
        runningWebsiteDesign: overlap.runningRun,
      },
      { status: 409 }
    );
  }

  let websiteDesign;
  try {
    websiteDesign = await createDesignGenerationRun(createDesignGenerationServiceDeps(supabase), {
      designBriefId: designBrief.id,
      missionId: mission.id,
      organizationId: mission.organization_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start website design generation";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Fire-and-forget: intentionally not awaited (ADR-012). Uses the
  // independently-rotatable secret key (see app/api/leads/scan/route.ts,
  // commit 3023a36) rather than the legacy service_role key.
  const backgroundDeps = createDesignGenerationServiceDeps(createSecretKeyClient());
  waitUntil(
    runDesignGeneration(backgroundDeps, websiteDesign.id).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[website-design ${websiteDesign!.id}] background run failed unexpectedly:`, err);
    })
  );

  return NextResponse.json({ websiteDesign }, { status: 202 });
}
