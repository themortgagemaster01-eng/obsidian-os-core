import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/missions/:id/design-brief/history — Design Intelligence
 * regeneration-for-comparison feature (2026-09-12). Read-only: returns
 * every design_briefs and website_designs row this mission has ever
 * produced (newest first), so the founder can see every past regeneration
 * and jump to any one's real rendered preview via the mission preview
 * page's existing `?designId=` support — no new comparison/diff UI, no
 * new guard logic, no evidence-integrity surface. Client correlates a
 * website_designs row to the brief it was generated from via
 * website_designs.design_brief_id.
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
    console.error(`[GET /api/missions/${params.id}/design-brief/history] supabase.auth.getUser() threw:`, err);
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
    console.error(`[GET /api/missions/${params.id}/design-brief/history] mission lookup failed:`, err);
    return NextResponse.json({ error: "Could not look up this mission — please try again." }, { status: 500 });
  }
  if (!mission) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }

  let designBriefs, websiteDesigns;
  try {
    [designBriefs, websiteDesigns] = await Promise.all([
      designBriefRepository.findAllByMission(supabase, mission.id),
      websiteDesignRepository.findAllByMission(supabase, mission.id),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[GET /api/missions/${params.id}/design-brief/history] history lookup failed:`, err);
    return NextResponse.json({ error: "Could not look up this mission's regeneration history — please try again." }, { status: 500 });
  }

  return NextResponse.json({ designBriefs, websiteDesigns });
}
