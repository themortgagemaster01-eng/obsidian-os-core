import { randomUUID } from "crypto";

import { normalizeWebsiteUrl } from "@/lib/services/company-service";
import { computeWebsiteScore, computeConfidenceScore, computeLeadOpportunityScore, computeMakeoverPotential } from "@/lib/services/lead-scoring-service";
import { resolveHeroPattern, HERO_PATTERN_VISUAL_STRATEGY_LABEL } from "@/lib/design-intelligence/section-patterns";
import { deriveConversionGoal } from "@/lib/services/business-intelligence-service";
import { industryBucketFromOsmTag, type DiscoveredBusiness, type GeocodedArea } from "@/lib/adapters/discovery-adapter";
import { qualifyCandidate, mainWeaknesses, upsertLead, type LeadHunterServiceDeps } from "@/lib/services/lead-hunter-service";
import type { LeadRow } from "@/lib/repositories/lead-repository";
import type { Json } from "@/lib/supabase/database.types";

/**
 * manual-lead-service.ts — "Add a Business" (2026-09-14): Robert's own
 * front door into the pipeline for a business he already knows about (a
 * referral, something he drove past) rather than waiting for a location
 * scan to surface it. Every real lead in production has
 * discovery_source: 'openstreetmap' today — this is the first, and only,
 * other entry point, deliberately additive: it never touches
 * lead-hunter-service.ts's own scan orchestration (runLeadHunterScan,
 * lead_scan_runs, DISCOVERY_POOL_SIZE), it only reuses that file's real,
 * already-tested per-candidate primitives (qualifyCandidate, upsertLead) —
 * the exact same crawl-then-score-then-persist pipeline an OSM-discovered
 * candidate already goes through, never a forked, parallel scoring path.
 */
export const MANUAL_DISCOVERY_SOURCE = "manual";

export interface CreateManualLeadInput {
  businessName: string;
  address: string;
  websiteUrl?: string | null;
  phone?: string | null;
}

export interface ManualLeadDuplicateMatch {
  matchedOn: "website_url" | "business_name";
  type: "company" | "lead";
  id: string;
  name: string;
}

export type CheckManualLeadDuplicateResult = { kind: "duplicate"; match: ManualLeadDuplicateMatch } | { kind: "new" };

type DuplicateCheckDeps = Pick<LeadHunterServiceDeps, "client" | "leadRepository" | "companyRepository">;

/**
 * Robert's own explicit requirement #1: check before creating anything,
 * never silently create a duplicate pipeline entry. Checked in this order:
 * (1) website URL, if supplied — the more precise signal, matched against
 * BOTH `companies` (already a real, tracked business) and `leads` (already
 * a candidate from an earlier scan or manual add); (2) business name,
 * case-insensitive, against both tables — name-only, not name+location,
 * since `location` is free text with no consistent format across sources
 * (a real, disclosed limitation, not a silent gap).
 */
export async function checkManualLeadDuplicate(
  deps: DuplicateCheckDeps,
  organizationId: string,
  input: Pick<CreateManualLeadInput, "businessName" | "websiteUrl">
): Promise<CheckManualLeadDuplicateResult> {
  if (input.websiteUrl && input.websiteUrl.trim()) {
    const normalized = normalizeWebsiteUrl(input.websiteUrl.trim());
    const existingCompany = await deps.companyRepository.findByOrgAndUrl(deps.client, organizationId, normalized);
    if (existingCompany) {
      return {
        kind: "duplicate",
        match: { matchedOn: "website_url", type: "company", id: existingCompany.id, name: existingCompany.business_name },
      };
    }
    const existingLead = await deps.leadRepository.findByOrgAndWebsiteUrl(deps.client, organizationId, normalized);
    if (existingLead) {
      return {
        kind: "duplicate",
        match: { matchedOn: "website_url", type: "lead", id: existingLead.id, name: existingLead.business_name },
      };
    }
  }

  const existingCompanyByName = await deps.companyRepository.findByOrgAndBusinessName(deps.client, organizationId, input.businessName);
  if (existingCompanyByName) {
    return {
      kind: "duplicate",
      match: { matchedOn: "business_name", type: "company", id: existingCompanyByName.id, name: existingCompanyByName.business_name },
    };
  }
  const existingLeadByName = await deps.leadRepository.findByOrgAndBusinessName(deps.client, organizationId, input.businessName);
  if (existingLeadByName) {
    return {
      kind: "duplicate",
      match: { matchedOn: "business_name", type: "lead", id: existingLeadByName.id, name: existingLeadByName.business_name },
    };
  }

  return { kind: "new" };
}

type QualifyDeps = Pick<LeadHunterServiceDeps, "client" | "leadRepository" | "runCrawlAdapter">;

/**
 * runManualLeadQualification — hands a founder-typed business straight to
 * the exact same qualifyCandidate + scoring + upsertLead pipeline an
 * OSM-discovered DiscoveredBusiness already goes through, including the
 * qualification overhaul's own three real outcomes (2026-09-14): no
 * website at all is a real, distinct "new_build" opportunity (Robert's own
 * business builds brand-new sites for exactly this case — never a
 * rejection), a website that exists but fails to load is still a genuine
 * rejection, and a website that loads gets scored — with status and
 * main_opportunity both deriving from the SAME makeoverPotentialResult
 * verdict, never two independently-checked fields that can drift apart.
 * No parallel logic is forked here; this function stays a thin adapter
 * from founder-typed input to the identical decision points the OSM scan
 * loop uses. `area` is the caller's already-geocoded result for
 * `input.address` (the same geocodeLocation Nominatim call the OSM path
 * already uses) — kept as a separate, explicit argument rather than
 * geocoding again here, so a geocode failure can be reported to the caller
 * before any background work starts, mirroring runLeadHunterScan's own
 * "resolve the area first" ordering.
 */
export async function runManualLeadQualification(
  deps: QualifyDeps,
  organizationId: string,
  input: CreateManualLeadInput,
  area: GeocodedArea
): Promise<LeadRow> {
  const candidate: DiscoveredBusiness = {
    externalId: randomUUID(),
    name: input.businessName.trim(),
    websiteUrl: input.websiteUrl?.trim() || null,
    phone: input.phone?.trim() || null,
    // No OSM tag for a manually-added business — industryBucketFromOsmTag's
    // own documented safe default ("general") applies here exactly as it
    // already does for any OSM tag it doesn't recognize; Robert's own form
    // deliberately doesn't ask for an industry (out of this feature's scope).
    osmTag: "",
    address: input.address,
    latitude: area.latitude,
    longitude: area.longitude,
    // A manually-typed business has no OSM data at all — never a chain
    // signal to check, by construction (Robert isn't going to type in an
    // OSM brand tag). Chain filtering only applies to the OSM scan path.
    brand: null,
  };

  const industryBucket = industryBucketFromOsmTag(candidate.osmTag);
  const qualification = await qualifyCandidate(deps, candidate);

  if (qualification.status === "no_website") {
    const heroPattern = resolveHeroPattern(industryBucket, false, 0);
    return upsertLead(deps, organizationId, MANUAL_DISCOVERY_SOURCE, {
      business_name: candidate.name,
      website_url: null,
      industry: industryBucket,
      location: area.displayName,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      discovery_external_id: candidate.externalId,
      discovery_phone: candidate.phone,
      discovery_address: input.address,
      status: "candidate",
      rejection_reason: null,
      website_score: null,
      opportunity_score: null,
      confidence_score: null,
      main_weaknesses: [] as unknown as Json,
      main_opportunity: "No website found for this business at all — the opportunity here is a brand-new site, not a redesign.",
      recommended_hero_pattern: heroPattern,
      recommended_design_strategy: HERO_PATTERN_VISUAL_STRATEGY_LABEL[heroPattern],
      recommended_conversion_goal: deriveConversionGoal(
        { phones: candidate.phone ? [candidate.phone] : [], emails: [], address: candidate.address, hours: null },
        []
      ),
      makeover_potential: "new_build",
      makeover_potential_reasons: [
        "No website found at all — nothing to critique or score structurally; this is a brand-new build, not a makeover.",
      ] as unknown as Json,
      contact_evidence: null,
      social_links: null,
      crawl_result: null,
      qualified_at: new Date().toISOString(),
    });
  }

  if (qualification.status === "rejected") {
    return upsertLead(deps, organizationId, MANUAL_DISCOVERY_SOURCE, {
      business_name: candidate.name,
      website_url: candidate.websiteUrl,
      location: area.displayName,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      discovery_external_id: candidate.externalId,
      discovery_phone: candidate.phone,
      discovery_address: input.address,
      status: "rejected",
      rejection_reason: qualification.rejectionReason,
      qualified_at: new Date().toISOString(),
    });
  }

  const { crawl } = qualification;
  const websiteScoreResult = computeWebsiteScore(crawl);
  const confidenceResult = computeConfidenceScore(crawl);
  const opportunityResult = computeLeadOpportunityScore(crawl);
  const makeoverPotentialResult = computeMakeoverPotential(websiteScoreResult, opportunityResult, confidenceResult);
  const heroPattern = resolveHeroPattern(industryBucket, crawl.gallery.length > 0, crawl.gallery.length);
  const isRealOpportunity = makeoverPotentialResult.potential !== "reject";

  return upsertLead(deps, organizationId, MANUAL_DISCOVERY_SOURCE, {
    business_name: candidate.name,
    website_url: candidate.websiteUrl,
    industry: industryBucket,
    location: area.displayName,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    discovery_external_id: candidate.externalId,
    discovery_phone: candidate.phone,
    discovery_address: input.address,
    status: isRealOpportunity ? "candidate" : "rejected",
    rejection_reason: isRealOpportunity ? null : makeoverPotentialResult.reasons[0],
    website_score: websiteScoreResult.score,
    opportunity_score: opportunityResult.score,
    confidence_score: confidenceResult.score,
    main_weaknesses: mainWeaknesses(websiteScoreResult.signals) as unknown as Json,
    main_opportunity: isRealOpportunity
      ? `Website scores ${websiteScoreResult.score}/100 on real structural signals with ${confidenceResult.evidenceFound.length}/8 real evidence categories captured — real upside for a redesign.`
      : makeoverPotentialResult.reasons[0],
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
}
