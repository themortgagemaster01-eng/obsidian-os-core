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
 * so that extension has real time to use.
 *
 * Raised 60 -> 120 (Design Intelligence Gap Map Fix E, audit finding #2):
 * runDesignQa's one LLM call (runAiDerivedAssessments,
 * design-qa-service.ts) shares lib/llm/anthropic-provider.ts with the
 * Design Brief pipeline, so it inherited Fix D's FETCH_TIMEOUT_MS=85s with
 * no retry — but this route's maxDuration was still 60, meaning a
 * legitimately-slow-but-working QA call (up to 85s) would be killed by the
 * PLATFORM before the app's own 85s AbortController ever got a chance to
 * fire, let alone catch/log/persist anything — a silent death, no
 * error_message, nothing to investigate afterward. Unlike the Design Brief
 * pipeline, this route makes exactly one LLM call with no chaining, so no
 * multi-pass math is needed here — just enough margin above that single
 * call's own ceiling: 85s (LLM) + ~10s (a handful of DB reads/writes, event
 * publish, the state transition — all fast, budgeted generously) = 95s
 * worst case; 120 leaves a real 25s (~21%) margin, comfortably under
 * Vercel's true Hobby+Fluid-Compute ceiling of 300s.
 */
export const maxDuration = 120;

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
  //
  // Pipeline audit fix #4 (2026-09-11): createSecretKeyClient() throws
  // synchronously if SUPABASE_SECRET_KEY is missing/misconfigured —
  // createDesignQaRun above only reads the existing website_designs row, it
  // never creates or marks one 'pending', so a clean error response is
  // sufficient.
  let backgroundDeps;
  try {
    backgroundDeps = createDesignQaServiceDeps(createSecretKeyClient());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[POST /api/missions/${params.id}/qa] createSecretKeyClient() threw:`, err);
    return NextResponse.json({ error: "Could not start Design QA — please try again." }, { status: 500 });
  }
  waitUntil(
    runDesignQa(backgroundDeps, run.id).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[design-qa ${run!.id}] background run failed unexpectedly:`, err);
    })
  );

  return NextResponse.json({ websiteDesign: run }, { status: 202 });
}
