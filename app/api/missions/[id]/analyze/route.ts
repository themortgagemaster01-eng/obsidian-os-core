import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

import { createClient } from "@/lib/supabase/server";
import { createSecretKeyClient } from "@/lib/supabase/service-role";
import { missionRepository } from "@/lib/repositories/mission-repository";
import {
  createAnalysisRun,
  createAnalysisServiceDeps,
  runAnalysis,
} from "@/lib/services/analysis-service";

interface RouteParams {
  params: { id: string };
}

/**
 * Vercel is free to freeze this function's execution context the instant
 * the 202 response below is sent, since the analysis promise is otherwise
 * untracked background work — see the matching fix in
 * app/api/leads/scan/route.ts (commit 2873e6f). waitUntil() below keeps the
 * function alive until it settles; maxDuration raises the execution budget
 * to this Hobby-plan route's max so that extension has real time to use.
 */
export const maxDuration = 60;

/**
 * POST /api/missions/:id/analyze — triggers the Sprint 3 Analysis Engine
 * for an existing mission (docs/SPRINT_3_DESIGN_REVIEW.md §2, §5).
 *
 * Creates the `website_analyses` row synchronously (fast, RLS-scoped to
 * the caller's session) and returns 202 Accepted immediately with the new
 * row — it does NOT wait for the pipeline to finish. The actual
 * seven-adapter pipeline (lib/services/analysis-service.ts::runAnalysis)
 * is invoked afterward without being awaited, using a service-role client
 * since it keeps running after this request's session/cookies are gone.
 *
 * This is explicitly the lightweight v1 mechanism the design doc
 * describes (§2): no retry policy, no distributed queue, no worker pool,
 * and no guarantee this in-process fire-and-forget survives a serverless
 * platform freezing the function immediately after the response is sent
 * (§15 risk #1 — the hosting/runtime choice for this worker has real,
 * unpriced cost/reliability implications, not resolved here). It is the
 * minimum change that gets a 10-30+ second, resource-heavy pipeline off
 * the synchronous request/response cycle — no code path in this route (or
 * anywhere in the adapters/analysis-service it calls) runs Lighthouse or
 * any other adapter before this response is sent.
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
    console.error(`[POST /api/missions/${params.id}/analyze] supabase.auth.getUser() threw:`, err);
    return NextResponse.json({ error: "Could not verify your session — please try again." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: findById only returns a row if the caller is a member of
  // the mission's organization, so a successful fetch here doubles as the
  // authorization check — no separate org-membership query needed.
  let mission;
  try {
    mission = await missionRepository.findById(supabase, params.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[POST /api/missions/${params.id}/analyze] mission lookup failed:`, err);
    return NextResponse.json({ error: "Could not look up this mission — please try again." }, { status: 500 });
  }
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  let analysis;
  try {
    analysis = await createAnalysisRun(createAnalysisServiceDeps(supabase), {
      missionId: mission.id,
      organizationId: mission.organization_id,
      companyId: mission.company_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start analysis";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Fire-and-forget: intentionally not awaited. A service-role-equivalent
  // client is used because this promise keeps running after the 202
  // response below is sent, when there's no user session left to read
  // cookies from. Uses the independently-rotatable secret key (see the
  // matching fix in app/api/leads/scan/route.ts, commit 3023a36) rather
  // than the legacy service_role key — the same createServiceRoleClient()
  // call here previously crashed this route unhandled, confirmed live via
  // a website_analyses row stuck at status: 'pending' with no error_message.
  const backgroundDeps = createAnalysisServiceDeps(createSecretKeyClient());
  waitUntil(
    runAnalysis(backgroundDeps, analysis.id).catch((err) => {
      // Last-resort log: runAnalysis already persists failures to the
      // website_analyses row itself (status: 'failed' + error_message) and
      // publishes AnalysisFailed, so reaching this catch means something
      // failed even more fundamentally than a normal adapter error (e.g.
      // the row/mission lookup at the top of runAnalysis itself).
      // eslint-disable-next-line no-console
      console.error(`[analysis ${analysis!.id}] background run failed unexpectedly:`, err);
    })
  );

  return NextResponse.json({ analysis }, { status: 202 });
}
