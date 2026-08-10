import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import {
  createDesignBriefRun,
  createDesignBriefServiceDeps,
  runDesignBrief,
} from "@/lib/services/design-brief-service";

interface RouteParams {
  params: { id: string };
}

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: doubles as the authorization check, same pattern as every other mission-scoped route.
  const mission = await missionRepository.findById(supabase, params.id);
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: doubles as the authorization check, same pattern as the
  // POST .../analyze route.
  const mission = await missionRepository.findById(supabase, params.id);
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
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

  // Fire-and-forget: intentionally not awaited (ADR-012).
  const backgroundDeps = createDesignBriefServiceDeps(createServiceRoleClient());
  void runDesignBrief(backgroundDeps, designBrief.id).catch((err) => {
    // Last-resort log: runDesignBrief already persists failures to the
    // design_briefs row itself (status: 'failed' + error_message) and
    // publishes DesignBriefFailed, so reaching this catch means something
    // failed even more fundamentally than a normal build error.
    // eslint-disable-next-line no-console
    console.error(`[design-brief ${designBrief!.id}] background run failed unexpectedly:`, err);
  });

  return NextResponse.json({ designBrief }, { status: 202 });
}
