import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

import { createClient } from "@/lib/supabase/server";
import { createSecretKeyClient } from "@/lib/supabase/service-role";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import type { MissionState } from "@/lib/workflow/mission-state";
import {
  createDesignBriefRun,
  createDesignBriefServiceDeps,
  runDesignBrief,
  checkDesignBriefOverlap,
} from "@/lib/services/design-brief-service";

/**
 * Pipeline audit fix #11 (2026-09-11): a Design Brief can only be
 * (re)generated while the mission hasn't moved past the Founder Approval
 * Gate yet — "analyzing"/"researching" (first-time generation) or
 * "reviewing" (a founder regenerating before approving, a real, intended
 * use case confirmed live — Station Plaza Wine's own 15:06 regeneration).
 * Real audit finding: nothing blocked a POST here once a mission had
 * already moved on to "designing" or later — one fired 7 hours after a
 * mission had already reached "qa", silently burning a real LLM call and
 * writing an orphaned design_briefs row with no relationship to the
 * mission's actual, already-further-along state.
 */
const VALID_DESIGN_BRIEF_TRIGGER_STATES: readonly MissionState[] = ["analyzing", "researching", "reviewing"];

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

  // Pipeline audit fix #8 (2026-09-11): findLatestByMission can throw (a
  // real DB/network exception, not just "no row found") — guarded the same
  // way missionRepository.findById already is above.
  let designBrief;
  try {
    designBrief = await designBriefRepository.findLatestByMission(supabase, mission.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[GET /api/missions/${params.id}/design-brief] design brief lookup failed:`, err);
    return NextResponse.json({ error: "Could not look up this mission's Design Brief — please try again." }, { status: 500 });
  }
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
 *
 * `forceRegenerate` (Design Intelligence regeneration-for-comparison
 * feature, 2026-09-12): an explicit, named, opt-in escape hatch past the
 * Fix #11 stage gate above — mirrors transitionMissionState's own
 * `allowNonSequential` spirit (an explicit override, never a loosening of
 * the default guard). Only reachable from a dedicated, confirmation-gated
 * UI control (components/mission-detail/regenerate-for-comparison.tsx),
 * never the normal Generate/Retry button, which never sends this flag and
 * gets today's guard behavior unchanged. Bypasses ONLY the stage-gate
 * check — auth, the overlap guard, and every other check below still run
 * exactly as they do for a normal request. Does not touch mission state:
 * runDesignBrief's own internal transition guard (`mission.state ===
 * "analyzing" || "researching"`) already only ever advances a mission
 * that's this early in the pipeline, so a forced run on a mission already
 * at qa/approval creates new design_briefs/website_designs rows without
 * moving the mission's real, already-approved state at all.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  // An absent or unparseable body is exactly today's behavior (no flag,
  // normal guarded request) — never a 400, since the normal Generate/Retry
  // button sends no body at all.
  let forceRegenerate = false;
  try {
    const body = (await request.json()) as { forceRegenerate?: boolean };
    forceRegenerate = body?.forceRegenerate === true;
  } catch {
    forceRegenerate = false;
  }

  // Pipeline audit fix #11 (2026-09-11): reject a regeneration attempt on a
  // mission that has already moved past the Founder Approval Gate — see
  // VALID_DESIGN_BRIEF_TRIGGER_STATES's own doc comment above. `forceRegenerate`
  // (see this route's own POST doc comment) is the one explicit, named
  // escape hatch — every other request still hits this exact guard.
  if (!VALID_DESIGN_BRIEF_TRIGGER_STATES.includes(mission.state) && !forceRegenerate) {
    return NextResponse.json(
      {
        error: `Mission ${mission.id} is at state "${mission.state}" — a Design Brief can only be generated while the mission is at analyzing, researching, or reviewing. This mission has already moved past that stage.`,
      },
      { status: 409 }
    );
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
  // Pipeline audit fix #4 (2026-09-11): createSecretKeyClient() throws
  // synchronously if SUPABASE_SECRET_KEY is missing/misconfigured — by this
  // point createDesignBriefRun above has already inserted a real
  // design_briefs row, so simply returning an error here would leave it
  // stuck at 'pending' forever (the exact "stuck row" symptom this whole
  // audit went looking for). Marked 'failed' via the same request-scoped
  // client that created it — createSecretKeyClient() failing doesn't affect
  // that earlier client's validity.
  let backgroundDeps;
  try {
    backgroundDeps = createDesignBriefServiceDeps(createSecretKeyClient());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[POST /api/missions/${params.id}/design-brief] createSecretKeyClient() threw:`, err);
    const message = "Could not start the Design Brief background worker.";
    await designBriefRepository.update(supabase, designBrief.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
