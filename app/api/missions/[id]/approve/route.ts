import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { approveMission, createMissionApprovalServiceDeps } from "@/lib/services/mission-approval-service";
import { createMissionWorkflowDeps } from "@/lib/workflow/mission-workflow";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/missions/:id/approve — Phase 8's founder-approval action.
 * Mirrors POST .../reject exactly in shape and guarantee: requires the
 * mission to be at `approval` (the founder-review gate a real, complete
 * proposal + email draft already moved it into); records the decision
 * through the existing, previously-unconsumed Decision Memory write path
 * (lib/services/decision-service.ts), advances the mission through the
 * existing `approval -> sent` NEXT_STATE move, and publishes the existing
 * `MissionApproved` event. Never sends anything — `sent` here means
 * approved and outreach-ready, not actually emailed; no provider is ever
 * contacted by this route or anything it calls.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  try {
    const deps = createMissionApprovalServiceDeps(supabase, createMissionWorkflowDeps(supabase));
    const { mission: updated, proposal } = await approveMission(deps, mission.id, user.id);
    return NextResponse.json({ mission: updated, proposal }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to approve mission";
    // A mission not at "approval", or with an incomplete proposal/email draft, is a client ordering error, not a server failure.
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
