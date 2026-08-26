import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import { proposalRepository, type ProposalRow } from "@/lib/repositories/proposal-repository";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { leadRepository } from "@/lib/repositories/lead-repository";
import { websiteAnalysisRepository } from "@/lib/repositories/website-analysis-repository";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import { normalizedAnalysisFromRow } from "@/lib/services/analysis-types";
import { generateInsights } from "@/lib/services/insight-service";
import { computeOpportunityScore } from "@/lib/services/opportunity-scoring-service";
import { assembleOpportunityReport, type OpportunityReport } from "@/lib/services/opportunity-report-service";
import { buildBusinessIntelligenceProfile } from "@/lib/services/business-intelligence-service";
import type { InsightSeverity } from "@/lib/services/insight-service";
import type { DesignQaReport } from "@/lib/services/design-qa-service";
import { transitionMissionState, type MissionWorkflowDeps } from "@/lib/workflow/mission-workflow";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";

/**
 * lib/services/proposal-service.ts — Phase 8's first real proposal
 * assembly. Deterministic, no LLM call: composes a structured
 * ProposalContent object entirely from already-authoritative, already-
 * computed data this pipeline produces upstream —
 * lib/services/opportunity-report-service.ts's own OpportunityReport (the
 * same object already shown to a founder on the mission detail page,
 * recomputed here the identical way app/api/missions/[id]/analysis/
 * route.ts already does, never a second scoring pass), the already-
 * persisted DesignQaReport (lib/services/design-qa-service.ts, extended by
 * Phases 6.8/6.9/7), and — when this mission originated from a promoted
 * lead — lib/services/business-intelligence-service.ts's own
 * BusinessIntelligenceProfile, which already carries the itemized "why
 * pursue this business" evidence (opportunityReasons/whyOpportunity) a
 * proposal needs. Never re-derives evidence independently; a mission
 * created directly (never a lead) simply gets an honestly empty
 * `whyQualified`, never fabricated.
 */

type TypedClient = SupabaseClient<Database>;

export interface ProposalContent {
  businessName: string;
  websiteUrl: string;
  /** Relative path — this demo is only ever opened by the founder inside the app in Phase 8; the existing preview route sits behind the app's own auth middleware (see docs/PHASE_8_PROSPECT_TO_APPROVAL_AUDIT.md §A5/§H) — a real, disclosed, deliberately out-of-scope limitation for this phase, not solved here. */
  demoUrl: string;
  generatedAt: string;
  currentWebsiteObservations: string[];
  /** Empty (never fabricated) when this mission did not originate from a promoted lead. */
  whyQualified: string[];
  keyOpportunities: { title: string; detail: string; severity: InsightSeverity }[];
  valueProposition: string;
  proposedNextStep: string;
  qaSummary: { overallVerdict: string; passedCategories: number; totalCategories: number };
}

export interface AssembleProposalContentInput {
  businessName: string;
  websiteUrl: string;
  missionId: string;
  report: OpportunityReport;
  qaReport: DesignQaReport;
  /** buildBusinessIntelligenceProfile's own output when this mission came from a promoted lead — null otherwise, never guessed. */
  businessIntelligence: { opportunityReasons: string[] } | null;
}

const PROPOSED_NEXT_STEP =
  "Review the attached demo and QA results, then reply to schedule a short call to discuss next steps.";

/** Pure — no I/O. Independently testable against hand-built fixtures, matching this codebase's own established pattern for every other assembly function upstream. */
export function assembleProposalContent(input: AssembleProposalContentInput): ProposalContent {
  const categories = Object.values(input.qaReport.categories);
  const passedCategories = categories.filter((c) => c.deterministic.verdict === "PASS").length;

  return {
    businessName: input.businessName,
    websiteUrl: input.websiteUrl,
    demoUrl: `/missions/${input.missionId}/preview`,
    generatedAt: new Date().toISOString(),
    currentWebsiteObservations: [input.report.executiveSummary, ...input.report.findings.flatMap((f) => f.statements)],
    whyQualified: input.businessIntelligence?.opportunityReasons ?? [],
    keyOpportunities: input.report.recommendations,
    valueProposition: [input.report.executiveConclusion, input.report.businessOpportunity.potentialBusinessValue]
      .filter((s) => s && s.trim().length > 0)
      .join(" "),
    proposedNextStep: PROPOSED_NEXT_STEP,
    qaSummary: {
      overallVerdict: input.qaReport.overallVerdict,
      passedCategories,
      totalCategories: categories.length,
    },
  };
}

export interface ProposalServiceDeps {
  client: TypedClient;
  missionRepository: typeof missionRepository;
  leadRepository: Pick<typeof leadRepository, "findByMission">;
  websiteAnalysisRepository: typeof websiteAnalysisRepository;
  websiteDesignRepository: typeof websiteDesignRepository;
  proposalRepository: typeof proposalRepository;
  workflowDeps: MissionWorkflowDeps;
  eventBus: EventBus;
}

export function createProposalServiceDeps(client: TypedClient, workflowDeps: MissionWorkflowDeps): ProposalServiceDeps {
  return {
    client,
    missionRepository,
    leadRepository,
    websiteAnalysisRepository,
    websiteDesignRepository,
    proposalRepository,
    workflowDeps,
    eventBus: createEventBus(client),
  };
}

/**
 * createProposal — the orchestration entry point. Requires the mission to
 * be at `state === "qa"` (Design QA has already run — a PASS/WARN/FAIL/
 * INCOMPLETE verdict is not itself gated on here, mirroring how
 * runDesignQa itself transitions to "qa" regardless of verdict; this phase
 * never adds a new, stricter QA gate). Upserts a single `proposals` row per
 * mission (a re-run overwrites the same row rather than accumulating
 * duplicates — the live, editable-until-decided value this table exists
 * to hold, never permanent history), transitions the mission
 * `qa -> proposal` (the existing, already-defined NEXT_STATE move), and
 * publishes the existing `ProposalReady` event.
 */
export async function createProposal(deps: ProposalServiceDeps, missionId: string): Promise<ProposalRow> {
  const mission = await deps.missionRepository.findById(deps.client, missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found.`);
  if (mission.state !== "qa") {
    throw new Error(`Mission ${missionId} is at state "${mission.state}", not "qa" — proposal assembly requires a completed Design QA run first.`);
  }

  const analysis = await deps.websiteAnalysisRepository.findLatestByMission(deps.client, missionId);
  if (!analysis || analysis.status !== "complete") {
    throw new Error(`Mission ${missionId} has no completed website analysis — cannot assemble an OpportunityReport without it.`);
  }
  const normalized = normalizedAnalysisFromRow(analysis, mission.website_url);
  const insights = generateInsights(normalized);
  const scoreResult = computeOpportunityScore(normalized);
  const report = assembleOpportunityReport(normalized, insights, scoreResult);

  const websiteDesign = await deps.websiteDesignRepository.findLatestByMission(deps.client, missionId);
  if (!websiteDesign || !websiteDesign.qa_result) {
    throw new Error(`Mission ${missionId} has no persisted Design QA result — cannot assemble a proposal without it.`);
  }
  const qaReport = websiteDesign.qa_result as unknown as DesignQaReport;

  const lead = await deps.leadRepository.findByMission(deps.client, missionId);
  const businessIntelligence = lead ? buildBusinessIntelligenceProfile(lead) : null;

  const content = assembleProposalContent({
    businessName: mission.business_name,
    websiteUrl: mission.website_url,
    missionId,
    report,
    qaReport,
    businessIntelligence: businessIntelligence ? { opportunityReasons: businessIntelligence.opportunityReasons } : null,
  });

  const existing = await deps.proposalRepository.findByMission(deps.client, missionId);
  const proposal = existing
    ? await deps.proposalRepository.update(deps.client, existing.id, { content: content as unknown as Json })
    : await deps.proposalRepository.insert(deps.client, {
        mission_id: missionId,
        organization_id: mission.organization_id,
        content: content as unknown as Json,
      });

  await transitionMissionState(deps.workflowDeps, missionId, "proposal");

  await deps.eventBus.publish({
    type: "ProposalReady",
    missionId,
    organizationId: mission.organization_id,
    payload: { proposalId: proposal.id },
  });

  return proposal;
}
