import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { profileRepository } from "@/lib/repositories/profile-repository";
import { runLeadHunterScan, createLeadHunterServiceDeps } from "@/lib/services/lead-hunter-service";
import type { IndustryBucket } from "@/lib/design-references/reference-library";

interface ScanBody {
  location?: string;
  industryBuckets?: string[];
  scanSize?: number;
}

const VALID_BUCKETS: IndustryBucket[] = [
  "restaurant",
  "lawFirm",
  "dentistMedical",
  "homeService",
  "realEstate",
  "fitness",
  "luxuryServices",
  "general",
];

/**
 * POST /api/leads/scan — triggers the AI Lead Hunter's Discovery + Qualify +
 * Score pipeline (lib/services/lead-hunter-service.ts::runLeadHunterScan)
 * for the current user's default organization. Fire-and-forget, same
 * pattern as POST /api/missions/:id/analyze: a scan of up to ~100 real
 * candidate sites (each qualified with a real crawl) can run well past a
 * synchronous request's reasonable timeout, so this returns 202 immediately
 * and the scan keeps running via a service-role client.
 *
 * No progress-tracking row exists yet (Phase 1 scope) — GET /api/leads
 * (or the Lead Hunter dashboard page) is how a caller checks the outcome,
 * by re-listing what's in the `leads` table once the scan has had time to
 * run. A future phase could add a `lead_scans` run-status row mirroring
 * website_analyses' own pending/running/complete/failed shape, if a real
 * need for live progress shows up.
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

  let body: ScanBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const location = body.location?.trim();
  if (!location) {
    return NextResponse.json({ error: "location is required — Robert's own target geographic area, not hardcoded." }, { status: 400 });
  }

  const industryBuckets = (body.industryBuckets ?? []).filter((b): b is IndustryBucket => VALID_BUCKETS.includes(b as IndustryBucket));
  if (industryBuckets.length === 0) {
    return NextResponse.json({ error: `industryBuckets must include at least one of: ${VALID_BUCKETS.join(", ")}` }, { status: 400 });
  }

  const scanSize = typeof body.scanSize === "number" && body.scanSize > 0 ? body.scanSize : undefined;

  // Fire-and-forget: intentionally not awaited, same "session/cookies are
  // gone before this finishes" reasoning as the Analysis Engine's own route.
  const backgroundDeps = createLeadHunterServiceDeps(createServiceRoleClient());
  void runLeadHunterScan(backgroundDeps, { organizationId, location, industryBuckets, scanSize }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[lead-hunter scan] organization ${organizationId}, location "${location}" failed:`, err);
  });

  return NextResponse.json({ status: "scan_started", location, industryBuckets, scanSize: scanSize ?? "default" }, { status: 202 });
}
