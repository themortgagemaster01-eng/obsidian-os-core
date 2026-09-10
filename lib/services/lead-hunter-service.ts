import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import type { CrawlRawResult } from "@/lib/adapters/types";
import type { IndustryBucket } from "@/lib/design-references/reference-library";
import {
  geocodeLocation,
  discoverBusinesses,
  industryBucketFromOsmTag,
  type DiscoveredBusiness,
  type GeocodedArea,
} from "@/lib/adapters/discovery-adapter";
import { runCrawlAdapter } from "@/lib/adapters/crawl-adapter";
import { normalizeWebsiteUrl } from "@/lib/services/company-service";
import { computeWebsiteScore, computeConfidenceScore, computeLeadOpportunityScore, computeMakeoverPotential } from "@/lib/services/lead-scoring-service";
import { resolveHeroPattern, HERO_PATTERN_VISUAL_STRATEGY_LABEL } from "@/lib/design-intelligence/section-patterns";
import { deriveConversionGoal } from "@/lib/services/business-intelligence-service";
import { leadRepository, type LeadRow } from "@/lib/repositories/lead-repository";
import { companyRepository } from "@/lib/repositories/company-repository";
import { leadScanRepository, type LeadScanRunRow } from "@/lib/repositories/lead-scan-repository";

const DISCOVERY_SOURCE = "openstreetmap";

/**
 * lead-hunter-service.ts — the AI Lead Hunter's orchestration layer:
 * Discovery Engine + Opportunity Scoring Agent composed into one real,
 * end-to-end scan (docs/MASTER_BLUEPRINT.md's long-named-but-never-built
 * Discovery/Qualification stages). Mirrors this codebase's existing
 * orchestration shape (design-brief-service.ts's runDesignBrief): gather
 * real facts deterministically, call exactly one specialized real-data
 * step per candidate, persist honestly. No LLM call anywhere in this file
 * — Design Intelligence (the one LLM layer) is reserved for a PROMOTED
 * lead's actual Design Brief, never spent scoring 50-100 unqualified
 * candidates (real API cost this pass deliberately avoids).
 *
 * Pipeline (CTO Lead Hunter directive §1): scan a larger pool -> evaluate
 * every business -> score opportunities -> rank them -> persist the
 * ranked candidates. "Present the best 5" is the caller's own slice of
 * leadRepository.listTopCandidates — this function scores and ranks the
 * WHOLE scanned pool, honestly, rather than deciding "top 5" for itself.
 */

type TypedClient = SupabaseClient<Database>;

export interface LeadHunterServiceDeps {
  client: TypedClient;
  /** Narrowed to exactly what this orchestration calls — a smaller, more honest test-mock surface than the full repository. */
  leadRepository: Pick<typeof leadRepository, "insert" | "update" | "findBySourceAndExternalId">;
  companyRepository: Pick<typeof companyRepository, "findByOrgAndUrl">;
  /** Phase 3: the scan's own funnel-progress record (supabase/migrations/0021_lead_scan_runs.sql) — narrowed the same way; findRunningByOrganization added for the overlap guard (checkScanOverlap). */
  leadScanRepository: Pick<typeof leadScanRepository, "insert" | "update" | "findRunningByOrganization">;
  /**
   * Real network calls, injected rather than imported-and-called directly —
   * the same "the LLM provider is a port, injected via deps" precedent
   * design-brief-service.ts already follows for its own external
   * dependency. Lets lead-hunter-service.test.ts exercise the real
   * orchestration logic (dedupe, qualify/reject branching, scoring, upsert)
   * with fast, deterministic fakes instead of hitting Nominatim/Overpass/a
   * real target site on every test run — real, live validation of these
   * three functions themselves happens in lib/adapters/discovery-
   * adapter.test.ts and via the manual live run this pass's own report
   * documents, not by re-hitting the network from the unit-test suite.
   */
  geocodeLocation: typeof geocodeLocation;
  discoverBusinesses: typeof discoverBusinesses;
  runCrawlAdapter: typeof runCrawlAdapter;
}

export function createLeadHunterServiceDeps(client: TypedClient): LeadHunterServiceDeps {
  return { client, leadRepository, companyRepository, leadScanRepository, geocodeLocation, discoverBusinesses, runCrawlAdapter };
}

export interface RunLeadHunterScanInput {
  organizationId: string;
  /** A free-text place name, geocoded via lib/adapters/discovery-adapter.ts's geocodeLocation — Robert's own target area, not hardcoded to any one city. */
  location: string;
  industryBuckets: IndustryBucket[];
  /** CTO directive §1: "make scan size configurable" — clamped inside discoverBusinesses to a hard cap so a misconfigured huge scan can't run away. */
  scanSize?: number;
  /** Phase 3: how many of this scan's own high-confidence prospects count as "selected for today's queue" in the funnel report below. Defaults to 5 — the standing "Top 5" convention lib/repositories/lead-repository.ts::listTopCandidates and docs/... "Today's Opportunities" already use. */
  queueSize?: number;
}

/** CTO Phase 3 directive: "ranking-by-opportunity-then-confidence." A qualified lead counts as a real confidence prospect once its confidence score clears this bar — a v1 threshold (see lead-scoring-service.ts's own "v1, not a final answer" disclosure), not a researched final cutoff. */
const HIGH_CONFIDENCE_MIN_SCORE = 50;
const DEFAULT_QUEUE_SIZE = 5;

/**
 * How long a "running" scan is trusted before it's treated as abandoned (a
 * killed/crashed process — never a thrown error, which runLeadHunterScan's
 * own catch already turns into a real "failed" status). Real scans complete
 * in well under a minute (scanSize is capped at 5 — app/api/leads/scan/
 * route.ts's own MAX_SCAN_SIZE — and each candidate is one sequential
 * crawl), so 15 minutes is comfortably generous while still catching a
 * genuinely stuck scan quickly, unlike mission_batch_runs' 4-hour window,
 * which covers several full mission pipelines per run.
 */
const DEFAULT_MAX_SCAN_RUNNING_DURATION_MS = 15 * 60 * 1000;

export type ScanOverlapGuardAction =
  | { kind: "proceed" }
  | { kind: "reap_stale_then_proceed"; staleRunId: string }
  | { kind: "already_running"; runningRun: LeadScanRunRow };

/**
 * decideScanOverlapGuardAction — "is it safe to start a new scan for this
 * organization," mirroring mission-batch-service.ts's own
 * decideOverlapGuardAction exactly (same three-way decision, same pure/
 * directly-unit-testable shape). The caller must resolve currentlyRunningRun
 * via a direct status-filtered query (findRunningByOrganization), never
 * findLatestByOrganization's "most recently started regardless of status."
 */
export function decideScanOverlapGuardAction(
  currentlyRunningRun: LeadScanRunRow | null,
  nowMs: number,
  maxRunningDurationMs: number
): ScanOverlapGuardAction {
  if (!currentlyRunningRun || currentlyRunningRun.status !== "running") {
    return { kind: "proceed" };
  }
  const startedAtMs = new Date(currentlyRunningRun.started_at).getTime();
  const ageMs = nowMs - startedAtMs;
  if (ageMs > maxRunningDurationMs) {
    return { kind: "reap_stale_then_proceed", staleRunId: currentlyRunningRun.id };
  }
  return { kind: "already_running", runningRun: currentlyRunningRun };
}

/**
 * checkScanOverlap — the route-facing half of the guard: resolves the
 * organization's currently-running scan (if any), decides what to do, and
 * — unlike mission-batch-service.ts's own guard, which lives inside its
 * fire-and-forget function and is invisible to the HTTP caller — performs
 * this check BEFORE the route responds, so a caller gets a real, distinct
 * 409 instead of an always-"scan_started" 202 that silently did nothing.
 * A stale run is reaped (marked failed) here, synchronously, before
 * returning "proceed" — the caller never needs to know reaping happened.
 */
export async function checkScanOverlap(
  deps: Pick<LeadHunterServiceDeps, "client" | "leadScanRepository">,
  organizationId: string
): Promise<{ kind: "proceed" } | { kind: "already_running"; runningRun: LeadScanRunRow }> {
  const runningRun = await deps.leadScanRepository.findRunningByOrganization(deps.client, organizationId);
  const action = decideScanOverlapGuardAction(runningRun, Date.now(), DEFAULT_MAX_SCAN_RUNNING_DURATION_MS);

  if (action.kind === "reap_stale_then_proceed") {
    await deps.leadScanRepository.update(deps.client, action.staleRunId, {
      status: "failed",
      error_message:
        "Scan considered abandoned — exceeded its maximum expected duration, likely due to a process restart, cancellation, or crash before it could reach a real terminal status.",
      completed_at: new Date().toISOString(),
    });
    return { kind: "proceed" };
  }

  return action;
}

export interface LeadHunterScanResult {
  location: string;
  discoveredCount: number;
  /** Candidates already tracked as a real company in this org — skipped, never re-discovered as a "new" lead (a business already in the real pipeline isn't a Lead Hunter candidate anymore). */
  skippedExistingCompanyCount: number;
  qualifiedCount: number;
  rejectedCount: number;
  /**
   * Phase 3 funnel (CTO Opportunity Intelligence directive): qualified
   * leads whose makeover_potential isn't 'reject' — a real, non-zero
   * upside, not just "the crawl succeeded."
   */
  meaningfulOpportunityCount: number;
  /** meaningfulOpportunityCount further gated on confidence_score >= HIGH_CONFIDENCE_MIN_SCORE — real opportunity AND real, reasonably rich evidence behind it. */
  highConfidenceCount: number;
  /** min(queueSize, highConfidenceCount) — the real slice of this scan that would make today's queue, never a fabricated "5" regardless of how few (or many) real high-confidence prospects this scan actually found. */
  queuedCount: number;
  /** The CTO's own funnel-report format, built from the real counts above — e.g. "87 businesses scanned → 32 usable websites → 18 meaningful website opportunities → 11 high-confidence prospects → 5 selected for today's queue." */
  funnelSummary: string;
  /** The persisted lib/repositories/lead-scan-repository.ts row this scan wrote to (supabase/migrations/0021_lead_scan_runs.sql) — lets a caller (the scan API route) hand the id back to the client, and lets the dashboard find this exact run later even after a fire-and-forget POST returns before the scan finishes. */
  scanRunId: string;
  leads: LeadRow[];
}

/** A lead this scan already has a row for (same discovery_source + discovery_external_id) gets its existing row updated in place, never duplicated — the migration's own unique index is the hard backstop; this is the same-intent application-level check. */
async function upsertLead(deps: LeadHunterServiceDeps, organizationId: string, values: Record<string, unknown>): Promise<LeadRow> {
  const existing = await deps.leadRepository.findBySourceAndExternalId(
    deps.client,
    organizationId,
    DISCOVERY_SOURCE,
    values.discovery_external_id as string
  );
  if (existing) {
    return deps.leadRepository.update(deps.client, existing.id, values);
  }
  return deps.leadRepository.insert(deps.client, { organization_id: organizationId, discovery_source: DISCOVERY_SOURCE, ...values } as never);
}

/**
 * qualifyCandidate — the cheap, per-candidate real-evidence pass (CTO
 * directive §3's Website Analysis / §4's Business Research, scoped to what
 * a single crawl-adapter.ts run can cheaply produce for up to ~100
 * candidates — never the full, expensive Lighthouse/accessibility Analysis
 * Engine run, which stays reserved for a PROMOTED lead's real mission).
 * Rejects a candidate with no website at all, or whose site never
 * successfully loaded — "a real operating business, a real website" (CTO
 * directive §1) is the floor, not just a website that merely exists.
 */
async function qualifyCandidate(
  deps: Pick<LeadHunterServiceDeps, "runCrawlAdapter">,
  candidate: DiscoveredBusiness
): Promise<{ status: "rejected"; rejectionReason: string; crawl?: CrawlRawResult } | { status: "candidate"; crawl: CrawlRawResult }> {
  if (!candidate.websiteUrl) {
    return { status: "rejected" as const, rejectionReason: "No website found for this business." };
  }

  const crawl = await deps.runCrawlAdapter(candidate.websiteUrl);
  if (crawl.fetchError || crawl.statusCode === null || crawl.statusCode >= 400) {
    return {
      status: "rejected" as const,
      rejectionReason: crawl.fetchError ? `Website did not load: ${crawl.fetchError}` : `Website returned HTTP ${crawl.statusCode}.`,
      crawl,
    };
  }

  return { status: "candidate" as const, crawl };
}

function mainWeaknesses(websiteSignals: { label: string; passed: boolean }[]): string[] {
  return websiteSignals.filter((s) => !s.passed).map((s) => s.label);
}

function formatFunnelSummary(counts: {
  discoveredCount: number;
  qualifiedCount: number;
  meaningfulOpportunityCount: number;
  highConfidenceCount: number;
  queuedCount: number;
}): string {
  return (
    `${counts.discoveredCount} businesses scanned → ${counts.qualifiedCount} usable websites → ` +
    `${counts.meaningfulOpportunityCount} meaningful website opportunities → ${counts.highConfidenceCount} high-confidence prospects → ` +
    `${counts.queuedCount} selected for today's queue`
  );
}

/**
 * runLeadHunterScan — the real, end-to-end scan: geocode -> discover ->
 * dedupe against existing companies -> qualify each candidate with a real
 * crawl -> score -> persist every real outcome (candidate AND rejected —
 * a rejected row is itself honest evidence the scan worked, never silently
 * dropped) -> Rank -> report the real funnel. Sequential, not parallel, by
 * design: real, rate-limited public APIs (Nominatim/Overpass) and up to
 * ~100 real target-site crawls in one scan warrant the same "don't hammer"
 * discipline lib/adapters/crawl-adapter.ts already holds itself to per
 * target site.
 *
 * Phase 3: writes a lead_scan_runs row (lib/repositories/lead-scan-
 * repository.ts) for this run BEFORE geocoding even starts, so a geocode
 * failure — a real failure mode, exercised by this file's own test suite —
 * is itself recorded as a real `failed` run with a real error_message,
 * never silently thrown away past POST /api/leads/scan's fire-and-forget
 * boundary. The row is updated to `complete` with the real funnel counts on
 * success, mirroring website_analyses' own pending/running/complete/failed
 * shape.
 */
/**
 * Phase 5.1 fix: every real failure mode after `scanRun` is created —
 * geocoding, discovery (the real bug this closes: a real Overpass 504
 * thrown from discoverBusinesses() propagated straight past the old
 * geocode-only try/catch, leaving the row stuck at "running" forever,
 * confirmed live during the Phase 5.0 Kitchener validation), the per-
 * candidate crawl, or any other exception in the loop below — is now
 * caught by ONE handler, generic over the failure's stage or cause (never
 * a special HTTP-504 case). The original error is always rethrown
 * unchanged after being recorded, never swallowed; the scan run row
 * always reaches a real terminal `failed` state with a real
 * error_message, never left orphaned at "running".
 */
export async function runLeadHunterScan(deps: LeadHunterServiceDeps, input: RunLeadHunterScanInput): Promise<LeadHunterScanResult> {
  const queueSize = input.queueSize ?? DEFAULT_QUEUE_SIZE;

  const scanRun: LeadScanRunRow = await deps.leadScanRepository.insert(deps.client, {
    organization_id: input.organizationId,
    location: input.location,
    industry_buckets: input.industryBuckets as unknown as Json,
    scan_size: input.scanSize ?? null,
    status: "running",
  });

  try {
    const area: GeocodedArea | null = await deps.geocodeLocation(input.location);
    if (!area) {
      throw new Error(`Could not resolve "${input.location}" to a real geographic area (Nominatim geocoding found no match).`);
    }

    const discovered = await deps.discoverBusinesses({
      area,
      industryBuckets: input.industryBuckets,
      maxResults: input.scanSize,
    });

    const result = await runScanAgainstDiscovered(deps, input, scanRun, area, discovered, queueSize);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lead Hunter scan failed for an unknown reason.";
    await deps.leadScanRepository.update(deps.client, scanRun.id, {
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    });
    throw err;
  }
}

/** Split out of runLeadHunterScan purely so the try/catch above wraps a single call rather than needing to re-indent this whole block — no behavior change, same deps/inputs, still throws real errors for the same outer handler to catch. */
async function runScanAgainstDiscovered(
  deps: LeadHunterServiceDeps,
  input: RunLeadHunterScanInput,
  scanRun: LeadScanRunRow,
  area: GeocodedArea,
  discovered: DiscoveredBusiness[],
  queueSize: number
): Promise<LeadHunterScanResult> {
  let skippedExistingCompanyCount = 0;
  let qualifiedCount = 0;
  let rejectedCount = 0;
  let meaningfulOpportunityCount = 0;
  let highConfidenceCount = 0;
  const leads: LeadRow[] = [];

  for (const candidate of discovered) {
    if (candidate.websiteUrl) {
      const existingCompany = await deps.companyRepository.findByOrgAndUrl(
        deps.client,
        input.organizationId,
        normalizeWebsiteUrl(candidate.websiteUrl)
      );
      if (existingCompany) {
        skippedExistingCompanyCount += 1;
        continue;
      }
    }

    const industryBucket = industryBucketFromOsmTag(candidate.osmTag);
    const qualification = await qualifyCandidate(deps, candidate);

    if (qualification.status === "rejected") {
      rejectedCount += 1;
      const lead = await upsertLead(deps, input.organizationId, {
        business_name: candidate.name,
        website_url: candidate.websiteUrl,
        business_category: candidate.osmTag,
        location: area.displayName,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        discovery_external_id: candidate.externalId,
        // Phase 14 (docs/PHASE_14_IMPLEMENTATION_PLAN.md §4): OSM's own
        // phone/address, independent of anything the crawl itself reports —
        // previously extracted by discovery-adapter.ts and then silently
        // dropped here, confirmed a real gap by the Phase 14 audit.
        discovery_phone: candidate.phone,
        discovery_address: candidate.address,
        status: "rejected",
        rejection_reason: qualification.rejectionReason,
        qualified_at: new Date().toISOString(),
      });
      leads.push(lead);
      continue;
    }

    const { crawl } = qualification;
    const websiteScoreResult = computeWebsiteScore(crawl);
    const confidenceResult = computeConfidenceScore(crawl);
    const opportunityResult = computeLeadOpportunityScore(crawl);
    const makeoverPotentialResult = computeMakeoverPotential(websiteScoreResult, opportunityResult, confidenceResult);
    const heroPattern = resolveHeroPattern(industryBucket, crawl.gallery.length > 0, crawl.gallery.length);

    qualifiedCount += 1;
    const lead = await upsertLead(deps, input.organizationId, {
      business_name: candidate.name,
      website_url: candidate.websiteUrl,
      industry: industryBucket,
      business_category: candidate.osmTag,
      location: area.displayName,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      discovery_external_id: candidate.externalId,
      // Phase 14 — see the matching comment at the rejected-lead call site above.
      discovery_phone: candidate.phone,
      discovery_address: candidate.address,
      status: "candidate",
      website_score: websiteScoreResult.score,
      opportunity_score: opportunityResult.score,
      confidence_score: confidenceResult.score,
      main_weaknesses: mainWeaknesses(websiteScoreResult.signals) as unknown as Json,
      main_opportunity:
        opportunityResult.legitimacyScore > 0
          ? `Website scores ${websiteScoreResult.score}/100 on real structural signals with ${confidenceResult.evidenceFound.length}/8 real evidence categories captured — real upside for a redesign.`
          : "Thin evidence captured — needs manual review before this is a credible prospect.",
      recommended_hero_pattern: heroPattern,
      recommended_design_strategy: HERO_PATTERN_VISUAL_STRATEGY_LABEL[heroPattern],
      recommended_conversion_goal: deriveConversionGoal(crawl.contact, crawl.forms),
      makeover_potential: makeoverPotentialResult.potential,
      makeover_potential_reasons: makeoverPotentialResult.reasons as unknown as Json,
      contact_evidence: crawl.contact as unknown as Json,
      social_links: crawl.socials as unknown as Json,
      crawl_result: crawl as unknown as Json,
      qualified_at: new Date().toISOString(),
    });
    leads.push(lead);

    if (makeoverPotentialResult.potential !== "reject") {
      meaningfulOpportunityCount += 1;
      if (confidenceResult.score >= HIGH_CONFIDENCE_MIN_SCORE) {
        highConfidenceCount += 1;
      }
    }
  }

  const queuedCount = Math.min(queueSize, highConfidenceCount);
  const funnelCounts = { discoveredCount: discovered.length, qualifiedCount, meaningfulOpportunityCount, highConfidenceCount, queuedCount };

  await deps.leadScanRepository.update(deps.client, scanRun.id, {
    status: "complete",
    discovered_count: funnelCounts.discoveredCount,
    qualified_count: qualifiedCount,
    rejected_count: rejectedCount,
    meaningful_opportunity_count: meaningfulOpportunityCount,
    high_confidence_count: highConfidenceCount,
    queued_count: queuedCount,
    completed_at: new Date().toISOString(),
  });

  return {
    location: area.displayName,
    discoveredCount: discovered.length,
    skippedExistingCompanyCount,
    qualifiedCount,
    rejectedCount,
    meaningfulOpportunityCount,
    highConfidenceCount,
    queuedCount,
    funnelSummary: formatFunnelSummary(funnelCounts),
    scanRunId: scanRun.id,
    leads,
  };
}
