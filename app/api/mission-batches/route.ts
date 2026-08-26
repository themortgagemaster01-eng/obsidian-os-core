import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { profileRepository } from "@/lib/repositories/profile-repository";
import { runMissionBatch, createMissionBatchServiceDeps } from "@/lib/services/mission-batch-service";

interface BatchBody {
  location?: string;
  requestedCount?: number;
  maxAttempts?: number;
}

/**
 * POST /api/mission-batches — Phase 9: "Prepare N approval-ready prospect
 * packages." Fire-and-forget, the exact same shape as POST /api/leads/scan:
 * a long-running, resource-heavy run (up to maxAttempts real missions, each
 * driven through the full existing generation/QA/proposal/email-draft
 * pipeline) can run well past a synchronous request's reasonable timeout,
 * so this returns 202 immediately and the batch keeps running via a
 * service-role client. GET /api/mission-batches (or the dashboard) is how a
 * caller checks progress/outcome, the same way GET /api/leads already is
 * for a scan.
 *
 * This is deliberately a manual action only — no scheduling, no cron, no
 * automatic trigger. A later phase can call this exact same route on a
 * timer without any change here.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await profileRepository.findById(supabase, user.id);
  const organizationId = profile?.default_organization_id;
  if (!organizationId) {
    return NextResponse.json({ error: "No default organization found for this user." }, { status: 400 });
  }

  let body: BatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const location = body.location?.trim();
  if (!location) {
    return NextResponse.json({ error: "location is required — the founder's own target area, not hardcoded." }, { status: 400 });
  }

  const requestedCount = typeof body.requestedCount === "number" && body.requestedCount > 0 ? Math.floor(body.requestedCount) : undefined;
  if (!requestedCount) {
    return NextResponse.json({ error: "requestedCount must be a positive integer." }, { status: 400 });
  }

  const maxAttempts = typeof body.maxAttempts === "number" && body.maxAttempts > 0 ? Math.floor(body.maxAttempts) : undefined;

  // Fire-and-forget: intentionally not awaited, same "session/cookies are
  // gone before this finishes" reasoning as POST /api/leads/scan and every
  // other long-running mission-pipeline route.
  const backgroundDeps = createMissionBatchServiceDeps(createServiceRoleClient());
  void runMissionBatch(backgroundDeps, { organizationId, location, requestedCount, maxAttempts, ownerId: user.id }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[mission-batch] organization ${organizationId}, location "${location}" failed:`, err);
  });

  return NextResponse.json({ status: "batch_started", location, requestedCount, maxAttempts: maxAttempts ?? requestedCount * 3 }, { status: 202 });
}
