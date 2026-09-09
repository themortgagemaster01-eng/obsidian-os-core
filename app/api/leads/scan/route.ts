import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

import { createClient } from "@/lib/supabase/server";
import { createSecretKeyClient } from "@/lib/supabase/service-role";
import { profileRepository } from "@/lib/repositories/profile-repository";
import { runLeadHunterScan, createLeadHunterServiceDeps } from "@/lib/services/lead-hunter-service";
import type { IndustryBucket } from "@/lib/design-references/reference-library";

interface ScanBody {
  location?: string;
  industryBuckets?: string[];
  scanSize?: number;
}

/**
 * Phase 5.2 fix: without this, Vercel is free to freeze/kill this function's
 * execution context the instant the 202 response below is sent, since the
 * scan promise is otherwise untracked background work — confirmed live via
 * lead_scan_runs rows (scan_size 1 and 4, seconds of real work) stuck at
 * "running" for 35+ minutes with no possible code path (success or the
 * catch block in lead-hunter-service.ts) able to run and mark them
 * complete/failed. waitUntil() below tells the platform to keep the
 * function alive until the scan settles; maxDuration raises the execution
 * budget to this Hobby-plan route's max so that extension has real time to
 * use. This does not fully close the gap for very large scans (~100
 * candidates, sequential real crawls) that could still exceed 60s — that
 * needs a real background job/queue, not a route-level change.
 */
export const maxDuration = 60;

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
 * runLeadHunterScan itself writes and updates the scan's own progress row
 * (lib/repositories/lead-scan-repository.ts, table `lead_scan_runs`) —
 * GET /api/leads (or the Lead Hunter dashboard page) is how a caller checks
 * the outcome, by re-listing what's in the `leads` table and/or reading
 * that run's row once the scan has had time to run.
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
    console.error("[POST /api/leads/scan] supabase.auth.getUser() threw:", err);
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
    console.error(`[POST /api/leads/scan] profile lookup failed for user ${user.id}:`, err);
    return NextResponse.json({ error: "Could not look up your profile — please try again." }, { status: 500 });
  }
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

  // Fire-and-forget from the request/response cycle's point of view — the
  // caller doesn't await this — but waitUntil() keeps the underlying
  // function alive until it settles, up to maxDuration above, rather than
  // leaving it to the platform's discretion. Same "session/cookies are gone
  // before this finishes" reasoning as the Analysis Engine's own route.
  const backgroundDeps = createLeadHunterServiceDeps(createSecretKeyClient());
  waitUntil(
    runLeadHunterScan(backgroundDeps, { organizationId, location, industryBuckets, scanSize }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[lead-hunter scan] organization ${organizationId}, location "${location}" failed:`, err);
    })
  );

  return NextResponse.json({ status: "scan_started", location, industryBuckets, scanSize: scanSize ?? "default" }, { status: 202 });
}
