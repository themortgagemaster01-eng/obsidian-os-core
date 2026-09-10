import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

import { createClient } from "@/lib/supabase/server";
import { createSecretKeyClient } from "@/lib/supabase/service-role";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import {
  createDesignQaRun,
  createDesignQaServiceDeps,
  runDesignQa,
} from "@/lib/services/design-qa-service";

interface RouteParams {
  params: { id: string };
}

/**
 * Vercel is free to freeze this function's execution context the instant
 * the 202 response below is sent, since the QA promise is otherwise
 * untracked background work — see the matching fix in
 * app/api/leads/scan/route.ts (commit 2873e6f). waitUntil() below keeps the
 * function alive until it settles; maxDuration raises the execution budget
 * to this Hobby-plan route's max so that extension has real time to use.
 */
export const maxDuration = 60;

/**
 * POST /api/missions/:id/qa — Sprint 4 Phase 4's Design QA step. Uses the
 * mission's latest completed website_designs run automatically (no request
 * body), the same "find the latest completed upstream artifact" pattern
 * POST /api/missions/:id/generate-design uses for design_briefs. If no
 * complete design run exists yet, returns 409 rather than creating a QA run
 * that would just fail anyway.
 *
 * Mirrors the other two Design Engine POST routes exactly (ADR-012): no new
 * row is created for QA itself (design-qa-service.ts persists its result
 * directly onto the website_designs row it graded — see that file's
 * createDesignQaRun doc comment), but the response/background shape stays
 * identical for consistency: 202 Accepted immediately, the actual QA run
 * invoked afterward without being awaited.
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
    console.error(`[POST /api/missions/${params.id}/qa] supabase.auth.getUser() threw:`, err);
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
    console.error(`[POST /api/missions/${params.id}/qa] mission lookup failed:`, err);
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

  let run;
  try {
    run = await createDesignQaRun(createDesignQaServiceDeps(supabase), { websiteDesignId: websiteDesign.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start Design QA";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Fire-and-forget: intentionally not awaited (ADR-012). Uses the
  // independently-rotatable secret key (see app/api/leads/scan/route.ts,
  // commit 3023a36) rather than the legacy service_role key.
  const backgroundDeps = createDesignQaServiceDeps(createSecretKeyClient());
  waitUntil(
    runDesignQa(backgroundDeps, run.id).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[design-qa ${run!.id}] background run failed unexpectedly:`, err);
    })
  );

  return NextResponse.json({ websiteDesign: run }, { status: 202 });
}
