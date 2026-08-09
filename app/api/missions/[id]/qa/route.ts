import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped: doubles as the authorization check, same pattern as the other mission-scoped POST routes.
  const mission = await missionRepository.findById(supabase, params.id);
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

  // Fire-and-forget: intentionally not awaited (ADR-012).
  const backgroundDeps = createDesignQaServiceDeps(createServiceRoleClient());
  void runDesignQa(backgroundDeps, run.id).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[design-qa ${run!.id}] background run failed unexpectedly:`, err);
  });

  return NextResponse.json({ websiteDesign: run }, { status: 202 });
}
