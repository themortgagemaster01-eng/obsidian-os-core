import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { proposalRepository } from "@/lib/repositories/proposal-repository";
import { createProposal, createProposalServiceDeps } from "@/lib/services/proposal-service";
import { createMissionWorkflowDeps } from "@/lib/workflow/mission-workflow";
import { createMissionApprovalServiceDeps, recordEmailEdit } from "@/lib/services/mission-approval-service";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/missions/:id/proposal — Phase 8: assembles the deterministic
 * proposal (lib/services/proposal-service.ts) from already-authoritative
 * data (OpportunityReport, DesignQaReport, and — when this mission
 * originated from a promoted lead — its own qualification evidence).
 * Requires the mission to be at `qa`; moves it to `proposal` only after
 * this succeeds. Synchronous, like approve-design-brief: no adapter or
 * model calls, a fast DB read/compose/write.
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
    const deps = createProposalServiceDeps(supabase, createMissionWorkflowDeps(supabase));
    const proposal = await createProposal(deps, mission.id);
    return NextResponse.json({ proposal }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to assemble proposal";
    // A mission not at "qa", or with no completed analysis/QA result, is a client ordering error, not a server failure.
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

interface PatchProposalBody {
  emailSubject?: string;
  emailBody?: string;
}

/**
 * PATCH /api/missions/:id/proposal — Phase 8's one, minimal founder-editing
 * path: the email draft's plain subject/body text (never the structured
 * proposal content, which stays system-generated). Every edit is logged
 * through the existing Decision Memory (`decision_type: "edit_email"`)
 * with real before/after values.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mission = await missionRepository.findById(supabase, params.id);
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  let body: PatchProposalBody;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.emailSubject !== "string" || typeof body.emailBody !== "string") {
    return NextResponse.json({ error: "emailSubject and emailBody (strings) are required" }, { status: 400 });
  }

  try {
    const deps = createMissionApprovalServiceDeps(supabase, createMissionWorkflowDeps(supabase));
    const proposal = await recordEmailEdit(deps, mission.id, { emailSubject: body.emailSubject, emailBody: body.emailBody }, user.id);
    return NextResponse.json({ proposal }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to edit email draft";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mission = await missionRepository.findById(supabase, params.id);
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  const proposal = await proposalRepository.findByMission(supabase, mission.id);
  return NextResponse.json({ proposal });
}
