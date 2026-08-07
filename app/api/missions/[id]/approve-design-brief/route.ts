import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import {
  approveDesignBrief,
  createDesignBriefServiceDeps,
  type DesignBriefEdits,
} from "@/lib/services/design-brief-service";

interface RouteParams {
  params: { id: string };
}

interface ApproveDesignBriefBody {
  edits?: DesignBriefEdits;
}

/**
 * POST /api/missions/:id/approve-design-brief — the Founder Approval Gate's
 * one action (docs/ARCHITECTURE_SPECIFICATION_V1.md, item 2). Requires the
 * mission to be at `reviewing`; moves it to `designing` only after this
 * succeeds. Unlike the other mission-scoped POST routes in this pipeline,
 * this one is NOT fire-and-forget — approveDesignBrief() is a fast
 * DB read/merge/write with no adapter or model calls, so it runs
 * synchronously within the request and returns the final result directly.
 *
 * Body is optional: `{}` or no body approves the brief as generated;
 * `{ edits: { targetAudience?, positioning?, direction? } }` applies a
 * founder edit at the same time as approving. `citedInsights` and
 * `referencesConsidered` are deliberately not editable — see
 * design-brief-service.ts's DesignBriefEdits doc comment for why.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: doubles as the authorization check, same pattern as the
  // other mission-scoped routes.
  const mission = await missionRepository.findById(supabase, params.id);
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  let body: ApproveDesignBriefBody = {};
  const rawBody = await request.text();
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  try {
    const designBrief = await approveDesignBrief(createDesignBriefServiceDeps(supabase), mission.id, {
      approvedBy: user.id,
      edits: body.edits,
    });
    return NextResponse.json({ designBrief }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to approve Design Brief";
    // A mission not at `reviewing`, or with no completed brief, is a client
    // ordering error, not a server failure — 409 Conflict rather than 500.
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
