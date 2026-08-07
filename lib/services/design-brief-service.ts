import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import type { AnalysisCategory, NormalizedAnalysis } from "@/lib/services/analysis-types";
import { normalizedAnalysisFromRow } from "@/lib/services/analysis-types";
import { generateInsights, type Insight } from "@/lib/services/insight-service";
import type { LayoutFamily } from "@/lib/design-intelligence/layout-rules";
import {
  resolveIndustryBucket,
  selectReferenceDirections,
  selectPrimaryReferenceDirection,
  type IndustryBucket,
  type ReferenceDirection,
} from "@/lib/design-references/reference-library";

import {
  designBriefRepository,
  type DesignBriefRow,
} from "@/lib/repositories/design-brief-repository";
import { websiteAnalysisRepository } from "@/lib/repositories/website-analysis-repository";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { companyRepository } from "@/lib/repositories/company-repository";
import {
  createMissionWorkflowDeps,
  transitionMissionState,
  type MissionWorkflowDeps,
} from "@/lib/workflow/mission-workflow";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";

/**
 * design-brief-service.ts — the Design Engine's first service (docs/
 * SPRINT_4_ARCHITECTURE_RECOMMENDATION.md §1). Reads Analysis Engine output
 * (Insights and Normalized Analysis directly, per §2's resolution of Design
 * Review Open Question 7 — NOT the aggregate opportunity_score, since
 * docs/SPRINT_3_REVIEW.md already flagged its category weighting as an
 * unresolved founder decision this stage shouldn't quietly start depending
 * on), selects a reference direction (lib/design-references/), and produces
 * a Design Brief: a structured, citable artifact naming the target
 * audience, positioning, and a proposed direction with its reasoning.
 *
 * Per the founder's Phase 2 guidance: this service defines and cites
 * direction — it does not judge output (that's design-qa-service.ts,
 * Phase 3) and it does not build the actual site (that's
 * design-generation-service.ts, which only ever reads this service's
 * output, never lib/design-references/ directly).
 */

// ===========================================================================
// The Design Brief (pure data shape + pure builder function)
// ===========================================================================

export interface DesignBriefCitation {
  category: AnalysisCategory;
  /** The Insight this cites, when a real Insight exists for the category — absent when there were no insights and the citation instead points directly at a measured Normalized Analysis score (still real, never-fabricated data). */
  insightId?: string;
  statement: string;
}

export interface DesignBrief {
  missionId: string;
  businessName: string;
  websiteUrl: string;
  /** As recorded on the company record — may be null; never guessed. */
  industry: string | null;
  industryBucket: IndustryBucket;
  /** §12 AC1 (docs/SPRINT_4_DESIGN_REVIEW.md): at least one citation is required. buildDesignBrief() throws rather than producing an uncitable brief. */
  citedInsights: DesignBriefCitation[];
  targetAudience: string;
  positioning: string;
  direction: {
    layoutFamily: LayoutFamily;
    typographicMood: string;
    colorDirection: string;
    /** "energetic" only for buckets where §6/§10 name a deliberate, disclosed deviation from the general restraint default (fitness) — never a silent default. */
    motionIntensity: "restrained" | "energetic";
  };
  /** Every reference direction considered for this bucket, cited as reasoning input — never a structure to copy (§8's hard line). */
  referencesConsidered: { referenceId: string; reasoning: string }[];
}

const CATEGORY_LABEL: Record<AnalysisCategory, string> = {
  performance: "Page speed",
  accessibility: "Accessibility",
  seo: "Search visibility",
  mobile: "Mobile experience",
  technicalHealth: "Technical health",
};

/**
 * §10-derived audience framing per industry bucket — paraphrased directly
 * from docs/DESIGN_INTELLIGENCE.md §10's "what shifts" column, never
 * fabricated detail about a specific business. "general" is deliberately
 * generic rather than guessing an unconfirmed industry.
 */
const AUDIENCE_BY_BUCKET: Record<IndustryBucket, string> = {
  restaurant:
    "Local diners and visitors deciding where to eat, often on mobile, close to a decision moment (tonight, this weekend).",
  lawFirm:
    "Prospective clients evaluating credibility and outcomes before ever making contact, often during a stressful, high-stakes moment.",
  dentistMedical:
    "Patients choosing a provider based on trust, cleanliness, and approachability, frequently comfort-sensitive.",
  homeService:
    "Homeowners with an urgent or time-sensitive need, searching from a phone, comparing reliability and response time.",
  realEstate:
    "Buyers and sellers evaluating an individual agent's credibility and local-market expertise as much as the brokerage brand.",
  fitness:
    "Prospective members deciding based on energy and community, with an easy first step (a class, a trial) mattering more than a long-form pitch.",
  luxuryServices:
    "A discerning, high-trust audience for whom understatement and consultation-first framing signal credibility better than visible selling.",
  general:
    "Prospective customers evaluating whether this business looks credible and current enough to trust with their business.",
};

function measuredCategories(
  analysis: NormalizedAnalysis
): { category: AnalysisCategory; score: number | null }[] {
  return [
    { category: "performance", score: analysis.lighthouse.performance },
    { category: "accessibility", score: analysis.accessibilityScore },
    { category: "seo", score: analysis.seoScore },
    { category: "mobile", score: analysis.mobileScore },
    { category: "technicalHealth", score: analysis.technicalHealthScore },
  ];
}

/**
 * §12 AC1's citation source: real Insights when any exist; when the site is
 * clean enough that insight-service.ts produced none, falls back to citing
 * the measured Normalized Analysis scores directly — still real data
 * insight-service.ts itself reads, never an invented finding.
 */
function buildCitations(analysis: NormalizedAnalysis, insights: Insight[]): DesignBriefCitation[] {
  if (insights.length > 0) {
    return insights.map((insight) => ({
      category: insight.category,
      insightId: insight.id,
      statement: insight.statement,
    }));
  }

  return measuredCategories(analysis)
    .filter((c): c is { category: AnalysisCategory; score: number } => c.score !== null)
    .map((c) => ({
      category: c.category,
      statement: `${CATEGORY_LABEL[c.category]} measured ${c.score}/100 — no significant issues found.`,
    }));
}

function findWeakestMeasuredCategory(
  analysis: NormalizedAnalysis
): { category: AnalysisCategory; score: number } | null {
  const measured = measuredCategories(analysis).filter(
    (c): c is { category: AnalysisCategory; score: number } => c.score !== null
  );
  if (measured.length === 0) return null;
  return measured.reduce((weakest, current) => (current.score < weakest.score ? current : weakest));
}

function buildPositioning(
  reference: ReferenceDirection,
  weakest: { category: AnalysisCategory; score: number } | null
): string {
  const base = `Positioning should lead with ${reference.positioningEmphasis}.`;
  if (!weakest) return base;
  return `${base} The redesign should directly address ${CATEGORY_LABEL[
    weakest.category
  ].toLowerCase()} (currently measured at ${weakest.score}/100), the business's most pressing measured gap.`;
}

export interface BuildDesignBriefInput {
  missionId: string;
  businessName: string;
  websiteUrl: string;
  industry: string | null;
  businessCategory: string | null;
  analysis: NormalizedAnalysis;
  insights: Insight[];
}

/**
 * buildDesignBrief — the single pure entry point this module exposes for
 * brief construction. NormalizedAnalysis + Insight[] + business identity in,
 * DesignBrief out. No database, no adapters, no Mission Engine — matching
 * insight-service.ts's and opportunity-scoring-service.ts's own precedent
 * of a pure, independently-testable core wrapped by a thin orchestration
 * layer (runDesignBrief, below) for the actual pipeline.
 *
 * Throws if there is nothing to cite (§10, docs/SPRINT_4_DESIGN_REVIEW.md:
 * "A brief that can't point to what it's addressing shouldn't generate
 * anything") — in practice this should be unreachable, since every
 * NormalizedAnalysis carries at least one measured category, but the guard
 * documents the requirement rather than silently trusting it.
 */
export function buildDesignBrief(input: BuildDesignBriefInput): DesignBrief {
  const citedInsights = buildCitations(input.analysis, input.insights);
  if (citedInsights.length === 0) {
    throw new Error(
      "Cannot build a Design Brief with no citable Insight or Normalized Analysis finding — " +
        "a brief that can't point to what it's addressing shouldn't generate anything (docs/SPRINT_4_DESIGN_REVIEW.md §10)."
    );
  }

  const industryBucket = resolveIndustryBucket(input.industry, input.businessCategory);
  const references = selectReferenceDirections(industryBucket);
  const primaryReference = selectPrimaryReferenceDirection(industryBucket);
  if (!primaryReference) {
    throw new Error(
      `No reference direction available for industry bucket "${industryBucket}" — the in-house reference library must cover every bucket, including "general".`
    );
  }

  const weakest = findWeakestMeasuredCategory(input.analysis);

  return {
    missionId: input.missionId,
    businessName: input.businessName,
    websiteUrl: input.websiteUrl,
    industry: input.industry,
    industryBucket,
    citedInsights,
    targetAudience: AUDIENCE_BY_BUCKET[industryBucket],
    positioning: buildPositioning(primaryReference, weakest),
    direction: {
      layoutFamily: primaryReference.layoutFamily,
      typographicMood: primaryReference.typographicMood,
      colorDirection: primaryReference.colorDirection,
      motionIntensity: industryBucket === "fitness" ? "energetic" : "restrained",
    },
    referencesConsidered: references.map((reference) => ({
      referenceId: reference.id,
      reasoning: `Informed by ${reference.description} — direction only, not structurally copied (§8).`,
    })),
  };
}

// ===========================================================================
// Orchestration — the fire-and-forget pipeline run, mirroring
// analysis-service.ts's createAnalysisRun/runAnalysis split (ADR-012).
// ===========================================================================

type TypedClient = SupabaseClient<Database>;

export interface DesignBriefServiceDeps {
  client: TypedClient;
  designBriefRepository: typeof designBriefRepository;
  websiteAnalysisRepository: typeof websiteAnalysisRepository;
  missionRepository: typeof missionRepository;
  companyRepository: typeof companyRepository;
  workflowDeps: MissionWorkflowDeps;
  eventBus: EventBus;
}

export function createDesignBriefServiceDeps(client: TypedClient): DesignBriefServiceDeps {
  return {
    client,
    designBriefRepository,
    websiteAnalysisRepository,
    missionRepository,
    companyRepository,
    workflowDeps: createMissionWorkflowDeps(client),
    eventBus: createEventBus(client),
  };
}

export interface CreateDesignBriefRunInput {
  missionId: string;
  organizationId: string;
  companyId?: string | null;
}

/**
 * The fast, synchronous half: creates the `design_briefs` row at
 * `status: 'pending'` and returns immediately, exactly mirroring
 * createAnalysisRun. Called by POST /api/missions/:id/design-brief; the
 * actual brief-building work (runDesignBrief, below) is invoked separately
 * and NOT awaited by that route handler.
 */
export async function createDesignBriefRun(
  deps: DesignBriefServiceDeps,
  input: CreateDesignBriefRunInput
): Promise<DesignBriefRow> {
  return deps.designBriefRepository.insert(deps.client, {
    mission_id: input.missionId,
    organization_id: input.organizationId,
    company_id: input.companyId ?? null,
    status: "pending",
  });
}

/**
 * Runs the Design Brief step for an existing `design_briefs` row: flips it
 * to 'running', transitions the mission analyzing -> researching if it
 * hasn't already (per docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md §2's
 * resolution of Design Review Open Question 1 — the Design Brief step
 * genuinely IS the researching stage's work, not a state to skip), builds
 * the brief from the mission's latest completed analysis, persists it, and
 * transitions the mission to `reviewing` — the Founder Approval Gate
 * (docs/ARCHITECTURE_SPECIFICATION_V1.md, item 2). The mission waits there
 * until a human calls approveDesignBrief() below; this function never
 * itself advances a mission into `designing`. On failure, marks the row
 * 'failed' and publishes DesignBriefFailed instead of throwing back to the
 * caller — same failure-handling shape as analysis-service.ts::runAnalysis.
 *
 * Deliberately synchronous work today (buildDesignBrief is a fast,
 * deterministic function — no adapter calls, no model calls), but kept in
 * the same fire-and-forget shape as runAnalysis per the founder's explicit
 * instruction to reuse that pattern, so the calling contract doesn't need
 * to change if a future pass adds a slower step (e.g. a model call) here.
 */
export async function runDesignBrief(
  deps: DesignBriefServiceDeps,
  designBriefId: string
): Promise<DesignBriefRow> {
  const run = await deps.designBriefRepository.findById(deps.client, designBriefId);
  if (!run) {
    throw new Error(`Design brief run ${designBriefId} not found.`);
  }

  const mission = await deps.missionRepository.findById(deps.client, run.mission_id);
  if (!mission) {
    throw new Error(`Mission ${run.mission_id} not found.`);
  }

  await deps.designBriefRepository.update(deps.client, designBriefId, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  // Only advance analyzing -> researching; a re-run on a mission already
  // past `researching` shouldn't attempt a second, now-invalid transition.
  if (mission.state === "analyzing") {
    await transitionMissionState(deps.workflowDeps, mission.id, "researching");
  }

  try {
    const analysisRow = await deps.websiteAnalysisRepository.findLatestByMission(deps.client, mission.id);
    if (!analysisRow || analysisRow.status !== "complete") {
      throw new Error(
        "No completed website analysis found for this mission — the Design Brief step requires the Analysis Engine to have completed first."
      );
    }

    const company = mission.company_id
      ? await deps.companyRepository.findById(deps.client, mission.company_id)
      : null;

    const normalized = normalizedAnalysisFromRow(analysisRow, mission.website_url);
    const insights = generateInsights(normalized);

    const brief = buildDesignBrief({
      missionId: mission.id,
      businessName: mission.business_name,
      websiteUrl: mission.website_url,
      industry: company?.industry ?? null,
      businessCategory: company?.business_category ?? null,
      analysis: normalized,
      insights,
    });

    const updated = await deps.designBriefRepository.update(deps.client, designBriefId, {
      status: "complete",
      completed_at: new Date().toISOString(),
      industry_bucket: brief.industryBucket,
      brief: brief as unknown as Json,
    });

    await deps.eventBus.publish({
      type: "DesignBriefReady",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: { industryBucket: brief.industryBucket, citationCount: brief.citedInsights.length },
    });

    await transitionMissionState(deps.workflowDeps, mission.id, "reviewing");

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Design Brief generation failed for an unknown reason.";

    const failed = await deps.designBriefRepository.update(deps.client, designBriefId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
    });

    await deps.eventBus.publish({
      type: "DesignBriefFailed",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: { errorMessage: message },
    });

    return failed;
  }
}

// ===========================================================================
// The Founder Approval Gate (docs/ARCHITECTURE_SPECIFICATION_V1.md, item 2)
// ===========================================================================

/**
 * The subset of a Design Brief a founder may edit before approving it.
 * Deliberately narrow: `citedInsights` and `referencesConsidered` are NOT
 * editable here — they're the brief's evidence trail (§12 AC1's
 * traceability guarantee), and letting an approval action silently rewrite
 * them would undermine the same evidence-first discipline ADR-013
 * established for the Opportunity Report. `industryBucket` is also not
 * editable through this path — changing it would invalidate the
 * `referencesConsidered` set it was resolved from; a genuinely wrong
 * industry classification should go back through a fresh Design Brief run,
 * not a patch.
 */
export interface DesignBriefEdits {
  targetAudience?: string;
  positioning?: string;
  direction?: Partial<DesignBrief["direction"]>;
}

export interface ApproveDesignBriefInput {
  /** The founder/user id performing the approval — becomes design_briefs.reviewed_by and the DesignBriefApproved event's approvedBy. */
  approvedBy: string;
  edits?: DesignBriefEdits;
}

/**
 * applyDesignBriefEdits — pure merge function, separated out of
 * approveDesignBrief so the actual edit-application logic is independently
 * testable without a Supabase client, mirroring buildDesignBrief's own
 * separation from its orchestration wrapper. `wasEdited` is true only when
 * a non-empty edits object was actually supplied, not merely present.
 */
export function applyDesignBriefEdits(
  brief: DesignBrief,
  edits?: DesignBriefEdits
): { brief: DesignBrief; wasEdited: boolean } {
  const wasEdited = !!edits && Object.keys(edits).length > 0;
  if (!wasEdited) return { brief, wasEdited: false };

  return {
    brief: {
      ...brief,
      targetAudience: edits?.targetAudience ?? brief.targetAudience,
      positioning: edits?.positioning ?? brief.positioning,
      direction: { ...brief.direction, ...edits?.direction },
    },
    wasEdited: true,
  };
}

/**
 * approveDesignBrief — the Founder Approval Gate's one action. Requires the
 * mission to be at `reviewing` (design-brief-service.ts's own
 * runDesignBrief is the only thing that puts it there); moves it to
 * `designing` only after this call succeeds. This is the only path by
 * which a mission ever leaves `reviewing` toward generation — nothing else
 * in this codebase transitions that edge, per ADR-000's non-negotiable
 * human-approval-before-anything-customer-facing commitment applied to the
 * cheapest, highest-leverage review point in the pipeline (docs/
 * SPRINT_4_DESIGN_REVIEW.md §11, Human Approval Point #2).
 */
export async function approveDesignBrief(
  deps: DesignBriefServiceDeps,
  missionId: string,
  input: ApproveDesignBriefInput
): Promise<DesignBriefRow> {
  const mission = await deps.missionRepository.findById(deps.client, missionId);
  if (!mission) {
    throw new Error(`Mission ${missionId} not found.`);
  }
  if (mission.state !== "reviewing") {
    throw new Error(
      `Mission ${missionId} is at state "${mission.state}", not "reviewing" — there is nothing to approve.`
    );
  }

  const briefRow = await deps.designBriefRepository.findLatestByMission(deps.client, missionId);
  if (!briefRow || briefRow.status !== "complete" || !briefRow.brief) {
    throw new Error(`Mission ${missionId} has no completed Design Brief to approve.`);
  }

  const currentBrief = briefRow.brief as unknown as DesignBrief;
  const { brief: approvedBrief, wasEdited } = applyDesignBriefEdits(currentBrief, input.edits);

  const updated = await deps.designBriefRepository.update(deps.client, briefRow.id, {
    brief: approvedBrief as unknown as Json,
    reviewed_at: new Date().toISOString(),
    reviewed_by: input.approvedBy,
  });

  await deps.eventBus.publish({
    type: "DesignBriefApproved",
    missionId: mission.id,
    organizationId: mission.organization_id,
    payload: { approvedBy: input.approvedBy, wasEdited },
  });

  await transitionMissionState(deps.workflowDeps, mission.id, "designing");

  return updated;
}
