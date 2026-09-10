import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

import { createClient } from "@/lib/supabase/server";
import { createSecretKeyClient } from "@/lib/supabase/service-role";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import {
  createDesignBriefRun,
  createDesignBriefServiceDeps,
  runDesignBrief,
  checkDesignBriefOverlap,
} from "@/lib/services/design-brief-service";

interface RouteParams {
  params: { id: string };
}

/**
 * Vercel is free to freeze this function's execution context the instant
 * the 202 response below is sent, since the design brief promise is
 * otherwise untracked background work — see the matching fix in
 * app/api/leads/scan/route.ts (commit 2873e6f). waitUntil() below keeps the
 * function alive until it settles; maxDuration raises the execution budget
 * so that extension has real time to use.
 *
 * Raised from 60 to 280 (Phase 5.5): runDesignBrief's real shape is up to
 * three SEQUENTIAL LLM calls (Pass 1, a mandatory critique, and — only if
 * the critique flags the result as generic or a content-boundary violation
 * — one bounded revision), each now able to retry through
 * fetchAnthropicWithRetry (lib/llm/anthropic-provider.ts). A single stuck
 * live row (design_briefs f8f06285, Sep 10 2026, 30+ minutes at 'running'
 * with no error) traced to exactly this: the function very likely exceeded
 * the old 60s ceiling and was killed by the platform before any code could
 * mark the row 'failed' — the same "killed mid-flight" symptom as the
 * original waitUntil bug, just triggered by legitimate worst-case latency
 * this time, not a missing waitUntil() (which was already in place).
 *
 * Vercel's Hobby plan, with Fluid Compute (enabled by default), allows up
 * to 300s — confirmed via Vercel's own docs, not assumed. 280 leaves a
 * real ~7% buffer below that true ceiling. Worst case this covers with
 * real margin: revision triggered (3 calls) AND two of the three calls
 * each need one retry that hits the full 60s timeout before succeeding —
 * (60+1+51) + 10 + (60+1+50) ≈ 233s, ~47s (20%) of headroom under 280.
 * Even one call fully exhausting all 3 attempts via timeout (60+1+60+2+60
 * = 183s) plus the other two completing normally (~60s) ≈ 243s still fits
 * with real margin. A scenario beyond that (every attempt on every call
 * timing out) is a sustained network outage, not a bound worth designing
 * a single request/response cycle around.
 */
export const maxDuration = 280;

/**
 * GET /api/missions/:id/design-brief — read-only counterpart to the POST
 * below, added for the Founder-facing Design Brief panel to poll while a
 * run is `pending`/`running` (same shape as GET /api/missions/:id/analysis
 * polling website_analyses). Returns the mission's latest design_briefs row,
 * or `null` if one has never been created — never assembles or infers
 * anything the row doesn't already have.
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
    console.error(`[GET /api/missions/${params.id}/design-brief] supabase.auth.getUser() threw:`, err);
    return NextResponse.json({ error: "Could not verify your session — please try again." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: doubles as the authorization check, same pattern as every other mission-scoped route.
  let mission;
  try {
    mission = await missionRepository.findById(supabase, params.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[GET /api/missions/${params.id}/design-brief] mission lookup failed:`, err);
    return NextResponse.json({ error: "Could not look up this mission — please try again." }, { status: 500 });
  }
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  const designBrief = await designBriefRepository.findLatestByMission(supabase, mission.id);
  return NextResponse.json({ designBrief });
}

/**
 * POST /api/missions/:id/design-brief — triggers Sprint 4 Phase 2's Design
 * Brief step (docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md §1, §2). Requires
 * a completed website analysis for this mission (Sprint 3's Analysis
 * Engine) — runDesignBrief() fails gracefully with a persisted error if one
 * doesn't exist yet, rather than throwing back to this route.
 *
 * Mirrors POST /api/missions/:id/analyze exactly (ADR-012): creates the
 * `design_briefs` row synchronously and returns 202 Accepted immediately;
 * the actual brief-building work — now a real LLM call via
 * design-intelligence-service.ts (docs/ARCHITECTURE_SPECIFICATION_V1.md
 * §3) — is invoked afterward without being awaited, using a service-role
 * client since it keeps running after this request's session/cookies are
 * gone. Fails gracefully with a persisted 'failed' status and error
 * message if ANTHROPIC_API_KEY isn't configured — see
 * lib/llm/anthropic-provider.ts.
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
    console.error(`[POST /api/missions/${params.id}/design-brief] supabase.auth.getUser() threw:`, err);
    return NextResponse.json({ error: "Could not verify your session — please try again." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: doubles as the authorization check, same pattern as the
  // POST .../analyze route.
  let mission;
  try {
    mission = await missionRepository.findById(supabase, params.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[POST /api/missions/${params.id}/design-brief] mission lookup failed:`, err);
    return NextResponse.json({ error: "Could not look up this mission — please try again." }, { status: 500 });
  }
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  // Overlap guard: checked before creating a new row, so a caller gets a
  // real 409 instead of a duplicate Design Brief racing the one already
  // in flight for this mission. The DB's own partial unique index
  // (design_briefs_one_inflight_per_mission) is the real, final authority
  // against a genuine race between this check and the insert below.
  const overlap = await checkDesignBriefOverlap(createDesignBriefServiceDeps(supabase), mission.id);
  if (overlap.kind === "already_running") {
    return NextResponse.json(
      {
        error: `A Design Brief is already ${overlap.runningRun.status} for this mission — wait for it to finish before starting another.`,
        runningDesignBrief: overlap.runningRun,
      },
      { status: 409 }
    );
  }

  let designBrief;
  try {
    designBrief = await createDesignBriefRun(createDesignBriefServiceDeps(supabase), {
      missionId: mission.id,
      organizationId: mission.organization_id,
      companyId: mission.company_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start Design Brief generation";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Fire-and-forget: intentionally not awaited (ADR-012). Uses the
  // independently-rotatable secret key (see app/api/leads/scan/route.ts,
  // commit 3023a36) rather than the legacy service_role key — the same
  // createServiceRoleClient() call here previously crashed this route
  // unhandled, confirmed live via a design_briefs row stuck at status:
  // 'pending' with no error_message.
  const backgroundDeps = createDesignBriefServiceDeps(createSecretKeyClient());
  waitUntil(
    runDesignBrief(backgroundDeps, designBrief.id).catch((err) => {
      // Last-resort log: runDesignBrief already persists failures to the
      // design_briefs row itself (status: 'failed' + error_message) and
      // publishes DesignBriefFailed, so reaching this catch means something
      // failed even more fundamentally than a normal build error.
      // eslint-disable-next-line no-console
      console.error(`[design-brief ${designBrief!.id}] background run failed unexpectedly:`, err);
    })
  );

  return NextResponse.json({ designBrief }, { status: 202 });
}
