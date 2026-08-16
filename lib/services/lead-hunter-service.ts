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
  return { client, leadRepository, companyRepository, geocodeLocation, discoverBusinesses, runCrawlAdapter };
}

export interface RunLeadHunterScanInput {
  organizationId: string;
  /** A free-text place name, geocoded via lib/adapters/discovery-adapter.ts's geocodeLocation — Robert's own target area, not hardcoded to any one city. */
  location: string;
  industryBuckets: IndustryBucket[];
  /** CTO directive §1: "make scan size configurable" — clamped inside discoverBusinesses to a hard cap so a misconfigured huge scan can't run away. */
  scanSize?: number;
}

export interface LeadHunterScanResult {
  location: string;
  discoveredCount: number;
  /** Candidates already tracked as a real company in this org — skipped, never re-discovered as a "new" lead (a business already in the real pipeline isn't a Lead Hunter candidate anymore). */
  skippedExistingCompanyCount: number;
  qualifiedCount: number;
  rejectedCount: number;
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

/**
 * runLeadHunterScan — the real, end-to-end scan: geocode -> discover ->
 * dedupe against existing companies -> qualify each candidate with a real
 * crawl -> score -> persist every real outcome (candidate AND rejected —
 * a rejected row is itself honest evidence the scan worked, never silently
 * dropped). Sequential, not parallel, by design: real, rate-limited public
 * APIs (Nominatim/Overpass) and up to ~100 real target-site crawls in one
 * scan warrant the same "don't hammer" discipline lib/adapters/crawl-
 * adapter.ts already holds itself to per target site.
 */
export async function runLeadHunterScan(deps: LeadHunterServiceDeps, input: RunLeadHunterScanInput): Promise<LeadHunterScanResult> {
  const area: GeocodedArea | null = await deps.geocodeLocation(input.location);
  if (!area) {
    throw new Error(`Could not resolve "${input.location}" to a real geographic area (Nominatim geocoding found no match).`);
  }

  const discovered = await deps.discoverBusinesses({
    area,
    industryBuckets: input.industryBuckets,
    maxResults: input.scanSize,
  });

  let skippedExistingCompanyCount = 0;
  let qualifiedCount = 0;
  let rejectedCount = 0;
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
    const heroPattern = resolveHeroPattern(industryBucket, crawl.gallery.length > 0);

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
  }

  return {
    location: area.displayName,
    discoveredCount: discovered.length,
    skippedExistingCompanyCount,
    qualifiedCount,
    rejectedCount,
    leads,
  };
}
