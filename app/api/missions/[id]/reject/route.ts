import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { createMissionWorkflowDeps, rejectMission } from "@/lib/workflow/mission-workflow";

interface RouteParams {
  params: { id: string };
}

interface RejectMissionBody {
  reason?: string;
}

/**
 * POST /api/missions/:id/reject — the Founder's "Request Changes / Reject"
 * counterpart to POST .../approve-design-brief. Wires the existing
 * `rejectMission()` (lib/workflow/mission-workflow.ts) — already built,
 * already using the sanctioned `transitionMissionState()` primitive and
 * publishing the schema-defined `MissionRejected` event, just never exposed
 * through an API route before this pass. No new state, no new event type,
 * no parallel approval mechanism — this is the same Mission Engine gate,
 * exercised from its other legitimate exit.
 *
 * Synchronous, like approve-design-brief: a fast DB read/write, no adapter
 * or model calls.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  let body: RejectMissionBody = {};
  const rawBody = await request.text();
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  try {
    const { mission: updated } = await rejectMission(createMissionWorkflowDeps(supabase), mission.id, body.reason);
    return NextResponse.json({ mission: updated }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reject mission";
    // A mission already terminal/rejected/sent is a client ordering error, not a server failure.
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
