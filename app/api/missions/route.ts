import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createMission } from "@/lib/services/mission-service";
import { profileRepository } from "@/lib/repositories/profile-repository";

interface CreateMissionBody {
  businessName?: string;
  websiteUrl?: string;
}

/**
 * POST /api/missions — creates a new mission for the current user's default
 * organization.
 *
 * Kept thin on purpose: auth check + input validation, then delegates the
 * actual work to lib/services/mission-service.ts. Does NOT run any
 * analysis/discovery/scraping — that's Sprint 3+. The mission is created at
 * the `discovered` state and just waits there until a future agent picks
 * it up.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();

  let user;
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/missions] supabase.auth.getUser() threw:", err);
    return NextResponse.json({ error: "Could not verify your session — please try again." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let profile;
  try {
    profile = await profileRepository.findById(supabase, user.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[POST /api/missions] profile lookup failed for user ${user.id}:`, err);
    return NextResponse.json({ error: "Could not look up your profile — please try again." }, { status: 500 });
  }
  const organizationId = profile?.default_organization_id;

  if (!organizationId) {
    return NextResponse.json(
      { error: "No default organization found for this user." },
      { status: 400 }
    );
  }

  let body: CreateMissionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const websiteUrl = body.websiteUrl?.trim();
  if (!websiteUrl) {
    return NextResponse.json({ error: "websiteUrl is required" }, { status: 400 });
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(
      websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`
    ).toString();
  } catch {
    return NextResponse.json({ error: "websiteUrl must be a valid URL" }, { status: 400 });
  }

  const businessName = body.businessName?.trim() || new URL(normalizedUrl).hostname;

  try {
    const mission = await createMission(supabase, {
      ownerId: user.id,
      organizationId,
      businessName,
      websiteUrl: normalizedUrl,
    });

    return NextResponse.json({ mission }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create mission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
