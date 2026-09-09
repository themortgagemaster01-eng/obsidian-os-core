import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createSecretKeyClient } from "@/lib/supabase/service-role";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import { createPreviewCaptureServiceDeps, runPreviewCapture } from "@/lib/services/preview-capture-service";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/missions/:id/capture-preview — Phase 4: triggers a real
 * screenshot capture of the live, authenticated Design Preview route.
 * Mirrors POST /api/missions/:id/qa exactly (ADR-012): uses the mission's
 * latest `complete` website_designs run automatically (no request body,
 * 409 if none exists), 202 Accepted immediately, the actual capture
 * invoked afterward without being awaited on a service-role client (the
 * upload itself needs no RLS-scoped session; the preview page navigation
 * inside the service authenticates as a real, separate QA validation
 * account via lib/services/qa-preview-access.ts, not this route's caller).
 *
 * This is NOT a deployment endpoint — no external host, no public URL. It
 * captures the same in-app preview a signed-in founder can already browse
 * to. See lib/services/preview-capture-service.ts's own doc comment.
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
    console.error(`[POST /api/missions/${params.id}/capture-preview] supabase.auth.getUser() threw:`, err);
    return NextResponse.json({ error: "Could not verify your session — please try again." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: doubles as the authorization check, same pattern as the other mission-scoped POST routes.
  let mission;
  try {
    mission = await missionRepository.findById(supabase, params.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[POST /api/missions/${params.id}/capture-preview] mission lookup failed:`, err);
    return NextResponse.json({ error: "Could not look up this mission — please try again." }, { status: 500 });
  }
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  const websiteDesign = await websiteDesignRepository.findLatestByMission(supabase, mission.id);
  if (!websiteDesign || websiteDesign.status !== "complete") {
    return NextResponse.json(
      { error: "No completed website design found for this mission — run POST /api/missions/:id/generate-design first." },
      { status: 409 }
    );
  }

  // Fire-and-forget: intentionally not awaited (ADR-012). Uses the
  // independently-rotatable secret key (see app/api/leads/scan/route.ts,
  // commit 3023a36) rather than the legacy service_role key.
  const backgroundDeps = createPreviewCaptureServiceDeps(createSecretKeyClient());
  void runPreviewCapture(backgroundDeps, websiteDesign.id).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[preview-capture ${websiteDesign.id}] background run failed unexpectedly:`, err);
  });

  return NextResponse.json({ websiteDesign }, { status: 202 });
}
