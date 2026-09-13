import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

import { createClient } from "@/lib/supabase/server";
import { createSecretKeyClient } from "@/lib/supabase/service-role";
import { profileRepository } from "@/lib/repositories/profile-repository";
import { leadRepository } from "@/lib/repositories/lead-repository";
import { companyRepository } from "@/lib/repositories/company-repository";
import { geocodeLocation } from "@/lib/adapters/discovery-adapter";
import { runCrawlAdapter } from "@/lib/adapters/crawl-adapter";
import { checkManualLeadDuplicate, runManualLeadQualification, type CreateManualLeadInput } from "@/lib/services/manual-lead-service";

interface ManualLeadBody {
  businessName?: string;
  address?: string;
  websiteUrl?: string;
  phone?: string;
}

/**
 * Same reasoning as POST /api/leads/scan's own maxDuration: qualifyCandidate's
 * real crawl (lib/adapters/crawl-adapter.ts) can retry/take real time against
 * a real, unpredictable target site, and Vercel is free to freeze this
 * function's execution context the instant the 202 response below is sent —
 * waitUntil() below keeps it alive until the real background work settles.
 */
export const maxDuration = 60;

/**
 * POST /api/leads/manual — "Add a Business" (2026-09-14): the founder's own
 * front door into the pipeline for a business he already knows about,
 * instead of waiting for a location scan to surface it. Additive only:
 * never touches lead-hunter-service.ts's own scan orchestration
 * (runLeadHunterScan, lead_scan_runs) — only reuses its real per-candidate
 * primitives via lib/services/manual-lead-service.ts, so a manually-added
 * business goes through the exact same crawl -> score -> qualify/reject
 * pipeline an OSM-discovered one already does.
 *
 * Dedup check and geocoding both happen synchronously, before the 202
 * response — a founder typing in a business he already tracks should see
 * that immediately, not find out a minute later that it silently no-opped;
 * mirrors runLeadHunterScan's own "resolve the real area before doing
 * anything else" ordering. Only the real crawl + scoring work (the
 * expensive, unpredictable part) is fire-and-forget.
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
    console.error("[POST /api/leads/manual] supabase.auth.getUser() threw:", err);
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
    console.error(`[POST /api/leads/manual] profile lookup failed for user ${user.id}:`, err);
    return NextResponse.json({ error: "Could not look up your profile — please try again." }, { status: 500 });
  }
  const organizationId = profile?.default_organization_id;
  if (!organizationId) {
    return NextResponse.json({ error: "No default organization found for this user." }, { status: 400 });
  }

  let body: ManualLeadBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const businessName = body.businessName?.trim();
  const address = body.address?.trim();
  if (!businessName) {
    return NextResponse.json({ error: "businessName is required." }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }

  const input: CreateManualLeadInput = {
    businessName,
    address,
    websiteUrl: body.websiteUrl?.trim() || null,
    phone: body.phone?.trim() || null,
  };

  // Dedup check first, per the feature's own explicit requirement — never
  // silently create a duplicate pipeline entry. Real DB reads only, on the
  // request-scoped client (RLS already scopes these to the user's own org).
  let duplicate;
  try {
    duplicate = await checkManualLeadDuplicate({ client: supabase, leadRepository, companyRepository }, organizationId, input);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[POST /api/leads/manual] duplicate check failed for organization ${organizationId}:`, err);
    return NextResponse.json({ error: "Could not check for an existing match — please try again." }, { status: 500 });
  }
  if (duplicate.kind === "duplicate") {
    return NextResponse.json(
      {
        error: `"${duplicate.match.name}" already appears to be tracked (matched on ${duplicate.match.matchedOn === "website_url" ? "website" : "business name"}, as a ${duplicate.match.type === "company" ? "real company" : "lead"}) — not adding a duplicate.`,
        existingMatch: duplicate.match,
      },
      { status: 409 }
    );
  }

  // Real geocoding, synchronous — a bad/unresolvable address should fail
  // the request honestly, before any background work starts, mirroring
  // runLeadHunterScan's own "could not resolve to a real geographic area"
  // failure for the OSM path.
  const area = await geocodeLocation(address);
  if (!area) {
    return NextResponse.json({ error: `Could not resolve "${address}" to a real geographic area (Nominatim geocoding found no match).` }, { status: 400 });
  }

  let secretKeyClient;
  try {
    secretKeyClient = createSecretKeyClient();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/leads/manual] createSecretKeyClient() threw:", err);
    return NextResponse.json({ error: "Could not start processing this business — please try again." }, { status: 500 });
  }

  waitUntil(
    runManualLeadQualification(
      { client: secretKeyClient, leadRepository, runCrawlAdapter },
      organizationId,
      input,
      area
    ).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[manual lead] organization ${organizationId}, "${businessName}" failed:`, err);
    })
  );

  return NextResponse.json({ status: "processing", businessName, location: area.displayName }, { status: 202 });
}
