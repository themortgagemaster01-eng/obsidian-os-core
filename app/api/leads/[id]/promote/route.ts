import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createLeadPromotionServiceDeps, promoteLeadToMission } from "@/lib/services/lead-promotion-service";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/leads/:id/promote — "Launch Makeover" (CTO Phase 2 directive
 * §6). Synchronous, not fire-and-forget: creating a mission row + linking
 * the Memory Vault company + writing the lead's promoted status back is
 * fast (no adapter/LLM work happens here — that's the existing, unchanged
 * Analyze/Design Brief steps a founder triggers next from the new mission's
 * own page), so unlike /api/missions/:id/analyze this returns the real
 * result directly rather than a 202.
 *
 * lib/services/lead-promotion-service.ts::promoteLeadToMission does the
 * actual eligibility validation (RLS-scoped findById on the lead doubles as
 * the authorization check, same precedent as every other :id route in this
 * app) — this route is deliberately thin.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { lead, mission } = await promoteLeadToMission(createLeadPromotionServiceDeps(supabase), {
      leadId: params.id,
      ownerId: user.id,
    });
    return NextResponse.json({ lead, mission }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to launch makeover from this lead";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
