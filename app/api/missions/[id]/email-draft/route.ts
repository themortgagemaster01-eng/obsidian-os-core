import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { createEmailDraft, createEmailDraftServiceDeps } from "@/lib/services/email-draft-service";
import { createMissionWorkflowDeps } from "@/lib/workflow/mission-workflow";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/missions/:id/email-draft — Phase 8: generates the deterministic,
 * founder-editable email draft (lib/services/email-draft-service.ts) from
 * the mission's already-assembled proposal content. Requires the mission
 * to be at `proposal`; advances it through `email` to `approval` (both
 * already-defined NEXT_STATE moves — see email-draft-service.ts's own doc
 * comment for why these happen together). No provider is contacted, no
 * email is sent — this only ever creates a draft.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  try {
    const deps = createEmailDraftServiceDeps(supabase, createMissionWorkflowDeps(supabase));
    const proposal = await createEmailDraft(deps, mission.id);
    return NextResponse.json({ proposal }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate email draft";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
