import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import { experienceRefinementRepository } from "@/lib/repositories/experience-refinement-repository";
import { resolveRefinement, refineExperience, createExperienceRefinementServiceDeps } from "@/lib/services/experience-refinement-service";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import type { Wireframe } from "@/lib/services/design-generation-service";
import {
  ENERGY_PREFERENCE_VOCABULARY,
  MOTION_PREFERENCE_VOCABULARY,
  NEUTRAL_EXPERIENCE_PREFERENCE,
  type HumanExperiencePreference,
} from "@/shared/design-intelligence/types";

interface RouteParams {
  params: { id: string };
}

function isValidPreference(value: unknown): value is HumanExperiencePreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    ENERGY_PREFERENCE_VOCABULARY.includes(candidate.energy as never) &&
    MOTION_PREFERENCE_VOCABULARY.includes(candidate.motion as never)
  );
}

/**
 * GET /api/missions/:id/experience-refinement — Phase 6.4 §1's prerequisite:
 * exposes the currently resolved Experience Plan (the AI baseline — no
 * founder preference applied) before any refinement control is shown, plus
 * the current website_design's latest refinement (if the founder already
 * refined this run) and a reapply prompt when a PREVIOUS refinement exists
 * on an OLDER website_design_id (§6 — evidence changed, a fresh generation
 * produced a new website_design row, and the founder's earlier preference
 * needs an explicit yes/no before it's reapplied to anything).
 *
 * Returns `{ baselinePlan: null, ... }` (200, not an error) when no
 * completed website design exists yet — the panel simply stays hidden until
 * Generation has produced something to refine.
 */
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

  const websiteDesign = await websiteDesignRepository.findLatestByMission(supabase, mission.id);
  if (!websiteDesign || websiteDesign.status !== "complete" || !websiteDesign.wireframe) {
    return NextResponse.json({ baselinePlan: null, currentRefinement: null, reapplyPrompt: null });
  }

  const wireframe = websiteDesign.wireframe as unknown as Wireframe;
  if (!wireframe.compositionVariant) {
    return NextResponse.json({ baselinePlan: null, currentRefinement: null, reapplyPrompt: null });
  }

  const briefRow = await designBriefRepository.findById(supabase, websiteDesign.design_brief_id);
  if (!briefRow || briefRow.status !== "complete" || !briefRow.brief) {
    return NextResponse.json({ baselinePlan: null, currentRefinement: null, reapplyPrompt: null });
  }

  const brief = briefRow.brief as unknown as DesignBrief;
  const designMemory = briefRow.design_memory as unknown as DesignMemory | null;
  const { baseline } = resolveRefinement(brief, designMemory, wireframe.compositionVariant.heroPattern, NEUTRAL_EXPERIENCE_PREFERENCE);

  const currentRefinement = await experienceRefinementRepository.findLatestByWebsiteDesign(supabase, websiteDesign.id);
  const latestMissionRefinement = await experienceRefinementRepository.findLatestByMission(supabase, mission.id);

  // A reapply prompt only makes sense when the founder's most recent
  // refinement, anywhere on this mission, belongs to an OLDER website_design
  // run than the one we just resolved a fresh baseline for — i.e. evidence
  // changed underneath them (§6). If the latest mission-wide refinement IS
  // already the current run's own refinement, there's nothing to "reapply".
  const reapplyPrompt =
    latestMissionRefinement && latestMissionRefinement.website_design_id !== websiteDesign.id
      ? { preference: latestMissionRefinement.preference as unknown as HumanExperiencePreference, fromWebsiteDesignId: latestMissionRefinement.website_design_id }
      : null;

  return NextResponse.json({ baselinePlan: baseline, currentRefinement, reapplyPrompt });
}

interface RefineExperienceBody {
  preference?: unknown;
}

/**
 * POST /api/missions/:id/experience-refinement — submits a founder's bounded
 * Experience Tone / Motion Intensity preference (§2). Always inserts a new
 * experience_refinements row (§5) — this is also how "Reset to AI
 * Recommendation" works: the client posts NEUTRAL_EXPERIENCE_PREFERENCE,
 * which is itself a real, loggable refinement, not a delete/special case.
 * Synchronous, like approve-design-brief — resolveRefinement is pure
 * computation with no adapter/model calls, so there's no reason to defer it
 * to a background run.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  let body: RefineExperienceBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidPreference(body.preference)) {
    return NextResponse.json(
      {
        error: `Body must include a preference with energy in [${ENERGY_PREFERENCE_VOCABULARY.join(", ")}] and motion in [${MOTION_PREFERENCE_VOCABULARY.join(", ")}].`,
      },
      { status: 400 }
    );
  }

  try {
    const refinement = await refineExperience(createExperienceRefinementServiceDeps(supabase), mission.id, body.preference, user.id);
    return NextResponse.json({ refinement }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refine Experience Plan";
    // No completed website design/brief yet is a client ordering error, not a server failure.
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
