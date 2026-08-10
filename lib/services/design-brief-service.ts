import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import type { AnalysisCategory, NormalizedAnalysis } from "@/lib/services/analysis-types";
import type { ContactInfo, ContentSection } from "@/lib/adapters/types";
import { normalizedAnalysisFromRow } from "@/lib/services/analysis-types";
import { generateInsights, type Insight } from "@/lib/services/insight-service";
import type { LayoutFamily } from "@/lib/design-intelligence/layout-rules";
import { resolveIndustryBucket, selectReferenceDirections, type IndustryBucket } from "@/lib/design-references/reference-library";
import { generateDesignIntelligence, type DesignMemory } from "@/lib/services/design-intelligence-service";
import type { LlmProvider } from "@/lib/llm/provider";
import { createAnthropicProviderFromEnv } from "@/lib/llm/anthropic-provider";
import { MetricsLlmProvider } from "@/lib/llm/metrics";

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
 * design-brief-service.ts — the Design Engine's first service. Per
 * docs/ARCHITECTURE_SPECIFICATION_V1.md §2, the actual creative-decision
 * making (target audience, positioning, direction, Design Memory) is
 * delegated entirely to lib/services/design-intelligence-service.ts's LLM
 * call — this file's own job is deterministic fact-gathering: reading
 * Analysis Engine output (Insights and Normalized Analysis directly, never
 * the aggregate opportunity_score — docs/SPRINT_3_REVIEW.md flagged its
 * category weighting as an unresolved founder decision this stage
 * shouldn't depend on), citing what's real, classifying the industry
 * bucket, and selecting candidate reference directions — then handing
 * those facts to Design Intelligence and persisting what comes back.
 *
 * This is the concrete split the founder's "strict separation of
 * responsibilities" principle demands: this file gathers and cites facts
 * (Analysis-adjacent, mechanical); design-intelligence-service.ts makes the
 * creative call (the ONLY layer that does, and the only one that talks to
 * an LLM). Neither judges output (that's a future design-qa-service.ts) nor
 * builds the actual site (that's design-generation-service.ts, which only
 * ever reads a completed, founder-approved DesignBrief — never
 * lib/design-references/ or an LLM directly).
 */

// ===========================================================================
// The Design Brief data shape (unchanged from Sprint 4 Phase 2 — only how
// its creative fields get populated changed, see runDesignBrief below)
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
  /** §12 AC1 (docs/SPRINT_4_DESIGN_REVIEW.md): at least one citation is required — runDesignBrief() throws rather than producing an uncitable brief. */
  citedInsights: DesignBriefCitation[];
  /**
   * Real, mechanically-extracted contact facts (NormalizedAnalysis.contactEvidence,
   * itself a pass-through of the crawl's own ContactInfo) — deterministic
   * evidence, gathered here like citedInsights/referencesConsidered, never
   * decided by the LLM. This is what design-generation-service.ts's contact
   * slots and design-intelligence-service.ts's prompt both ground themselves
   * in, so neither ever has to guess or imply contact evidence that was
   * never actually captured (§8's zero-fabrication rule).
   */
  contactEvidence: ContactInfo;
  /** Passed through from NormalizedAnalysis.metaDescription unchanged — the business's own real published homepage description, when the crawl captured one (see analysis-types.ts's field doc). */
  metaDescription?: string | null;
  /** Passed through from NormalizedAnalysis.services unchanged — real service/offering descriptions merged across the homepage and already-fetched sub-pages, each with real provenance. */
  services?: ContentSection[];
  /** Passed through from NormalizedAnalysis.testimonials unchanged — real, already-published client testimonials, verbatim, each with real provenance. */
  testimonials?: ContentSection[];
  targetAudience: string;
  positioning: string;
  direction: {
    layoutFamily: LayoutFamily;
    typographicMood: string;
    colorDirection: string;
    /** "energetic" only when Design Intelligence made a deliberate, disclosed decision to deviate from the general restraint default — never a silent default. */
    motionIntensity: "restrained" | "energetic";
  };
  /** Every reference direction considered for this bucket, cited as reasoning input to Design Intelligence — never a structure to copy (§8's hard line). */
  referencesConsidered: { referenceId: string; reasoning: string }[];
}

const CATEGORY_LABEL: Record<AnalysisCategory, string> = {
  performance: "Page speed",
  accessibility: "Accessibility",
  seo: "Search visibility",
  mobile: "Mobile experience",
  technicalHealth: "Technical health",
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
 * insight-service.ts itself reads, never an invented finding. Exported:
 * this is exactly the kind of mechanical, Analysis-adjacent fact-gathering
 * design-intelligence-service.ts's LLM call receives as input, per §2's
 * "Analysis only gathers facts" principle.
 */
export function buildCitations(analysis: NormalizedAnalysis, insights: Insight[]): DesignBriefCitation[] {
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

/** The business's single most pressing measured gap, or null if nothing was measurable — passed to Design Intelligence as a fact, never computed or guessed by it. */
export function findWeakestMeasuredCategory(
  analysis: NormalizedAnalysis
): { category: AnalysisCategory; score: number } | null {
  const measured = measuredCategories(analysis).filter(
    (c): c is { category: AnalysisCategory; score: number } => c.score !== null
  );
  if (measured.length === 0) return null;
  return measured.reduce((weakest, current) => (current.score < weakest.score ? current : weakest));
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
  /** Design Intelligence's LLM dependency — injected, never a specific vendor imported directly by this file's own logic (docs/ARCHITECTURE_SPECIFICATION_V1.md §3). Defaults to Anthropic via createDesignBriefServiceDeps, but construction never throws for a missing API key — only an actual call inside runDesignBrief does (see lib/llm/anthropic-provider.ts). */
  llmProvider: LlmProvider;
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
    // The production Design Brief path must emit operational metrics for
    // every LLM call, so wrap the concrete provider at this boundary.
    llmProvider: new MetricsLlmProvider(createAnthropicProviderFromEnv()),
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
 * hasn't already (the Design Brief step genuinely IS the researching
 * stage's work, not a state to skip), gathers the deterministic facts
 * (citations, industry bucket, candidate references), delegates the actual
 * creative decision to design-intelligence-service.ts's LLM call, persists
 * the result (brief + Design Memory + reasoning), and transitions the
 * mission to `reviewing` — the Founder Approval Gate. On failure, marks the
 * row 'failed' and publishes DesignBriefFailed instead of throwing back to
 * the caller — same failure-handling shape as
 * analysis-service.ts::runAnalysis.
 *
 * This step now genuinely depends on a working ANTHROPIC_API_KEY
 * (docs/ARCHITECTURE_SPECIFICATION_V1.md's "Design Intelligence is the
 * ONLY creative layer and should use an LLM" — not a fallback-when-
 * available option). Without one, deps.llmProvider.complete() throws a
 * clear, actionable error, this function catches it like any other
 * failure, and the row reads 'failed' with that message — an honest
 * failure, not a silent revert to the old deterministic behavior.
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

    // --- Deterministic fact-gathering (this file's job, §2's "Analysis
    // only gathers facts" principle applied to what Design Intelligence
    // consumes) ---
    const citedInsights = buildCitations(normalized, insights);
    if (citedInsights.length === 0) {
      throw new Error(
        "Cannot build a Design Brief with no citable Insight or Normalized Analysis finding — " +
          "a brief that can't point to what it's addressing shouldn't generate anything (docs/SPRINT_4_DESIGN_REVIEW.md §10)."
      );
    }
    const industryBucket = resolveIndustryBucket(company?.industry ?? null, company?.business_category ?? null);
    const candidateReferences = selectReferenceDirections(industryBucket);
    const weakestCategory = findWeakestMeasuredCategory(normalized);

    // --- The one creative decision, delegated entirely to Design
    // Intelligence's LLM call (§2: "Design Intelligence is the ONLY
    // creative layer") ---
    const { designBrief: creative, designMemory, reasoning } = await generateDesignIntelligence(
      deps.llmProvider,
      {
        businessName: mission.business_name,
        industry: company?.industry ?? null,
        industryBucket,
        citedInsights,
        weakestCategory,
        candidateReferences,
        contactEvidence: normalized.contactEvidence,
      },
      // Real spend once a live key is configured — logged per run so cost
      // is visible in server logs rather than invisible until a bill
      // arrives. Not persisted to a table; no cost-tracking feature has
      // been requested beyond visibility.
      (usage) => {
        // eslint-disable-next-line no-console
        console.log(
          `[design-brief ${designBriefId}] Anthropic usage: ${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens`
        );
      }
    );

    const brief: DesignBrief = {
      missionId: mission.id,
      businessName: mission.business_name,
      websiteUrl: mission.website_url,
      industry: company?.industry ?? null,
      industryBucket,
      citedInsights,
      contactEvidence: normalized.contactEvidence,
      metaDescription: normalized.metaDescription,
      services: normalized.services,
      testimonials: normalized.testimonials,
      targetAudience: creative.targetAudience,
      positioning: creative.positioning,
      direction: creative.direction,
      referencesConsidered: candidateReferences.map((reference) => ({
        referenceId: reference.id,
        reasoning: `Informed by ${reference.description} — direction only, not structurally copied (§8).`,
      })),
    };

    const updated = await deps.designBriefRepository.update(deps.client, designBriefId, {
      status: "complete",
      completed_at: new Date().toISOString(),
      industry_bucket: brief.industryBucket,
      brief: brief as unknown as Json,
      design_memory: designMemory as unknown as Json,
      reasoning,
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
 * testable without a Supabase client. `wasEdited` is true only when a
 * non-empty edits object was actually supplied, not merely present.
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

export type { DesignMemory };
