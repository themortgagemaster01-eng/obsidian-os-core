import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import {
  buildExperiencePlanInputs,
  type GenerateWireframeOptions,
  type Wireframe,
} from "@/lib/services/design-generation-service";
import { resolveExperiencePlan, computeMotionBudgetCeiling } from "@/lib/design-intelligence/experience-planner";
import type { HeroPatternId } from "@/lib/design-intelligence/section-patterns";
import type { ExperiencePlan, HumanExperiencePreference } from "@/shared/design-intelligence/types";
import {
  experienceRefinementRepository,
  type ExperienceRefinementRow,
} from "@/lib/repositories/experience-refinement-repository";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";

/**
 * experience-refinement-service.ts — Phase 6.4: Human-in-the-Loop
 * Experience Refinement. The founder's own non-negotiable: "human preference
 * may influence the final experience, but it must never be able to defeat
 * evidence constraints, experience-mode constraints, motion-budget
 * ceilings...". This file never re-derives evidence and never builds a
 * second decision path — it re-runs the SAME resolveExperiencePlan the
 * original generation used (via the SAME buildExperiencePlanInputs
 * construction, design-generation-service.ts), once without a human
 * preference (the baseline) and once with one (the resolved outcome), so
 * "what would the AI recommend right now" and "what does a founder's
 * preference actually change" are guaranteed to be computed by identical
 * logic, never two independently-maintained implementations that could
 * silently diverge.
 */

/**
 * resolveRefinement — pure, no DB access. Rebuilds the exact
 * GenerateWireframeOptions shape generateWebsiteStructure
 * (design-generation-service.ts) already constructs from a DesignBrief +
 * DesignMemory, so this recomputation only ever differs from the original
 * generation's own baseline when the brief/memory it's given actually
 * differs — never from a second, drifted evidence-reading implementation.
 * heroPattern is passed in rather than re-resolved, read back from the
 * ALREADY-PERSISTED wireframe of the website_design being refined — the
 * strongest anti-drift guarantee available, since it is literally the same
 * value the original run committed, not a recomputation that could
 * disagree with it.
 */
export interface ResolvedRefinement {
  baseline: ExperiencePlan;
  resolved: ExperiencePlan;
  /** The resolved plan's own rationale — already includes an honest account of whether the preference was fully honored or capped at the real ceiling (experience-planner.ts's describeHumanPreferenceOutcome). Persisted verbatim as experience_refinements.explanation. */
  explanation: string;
  /** True only when the founder asked for more energy/motion and the resolved plan landed exactly on the real evidence/mode ceiling — i.e. the request reached a hard limit it could not cross. "Calmer"/"less" requests are never constrained (the floor is always reachable), so this is always false for those. */
  wasConstrained: boolean;
}

export function resolveRefinement(
  brief: DesignBrief,
  designMemory: DesignMemory | null,
  heroPattern: HeroPatternId,
  preference: HumanExperiencePreference
): ResolvedRefinement {
  const options: GenerateWireframeOptions = {
    hasRealTestimonials: (brief.testimonials ?? []).length > 0,
    hasRealTeam: (brief.team ?? []).length > 0,
    hasRealImagery: !!brief.gallery && brief.gallery.length > 0,
    compositionEvidence: {
      services: brief.services?.length ?? 0,
      certifications: brief.certifications?.length ?? 0,
      hasReviews: !!brief.reviews && brief.reviews.count !== null,
      galleryCount: brief.gallery?.length ?? 0,
    },
    brandPersonality: designMemory?.brandPersonality,
    contentTone: designMemory?.contentTone,
  };

  const baselineInput = buildExperiencePlanInputs(brief, heroPattern, options);
  const baseline = resolveExperiencePlan(baselineInput);
  const resolved = resolveExperiencePlan(buildExperiencePlanInputs(brief, heroPattern, options, preference));

  const ceiling = computeMotionBudgetCeiling(baseline.mode, baselineInput.evidence, baselineInput.motionIntensity);
  const requestedMore = preference.energy === "more-energetic" || preference.motion === "more";
  const wasConstrained = requestedMore && resolved.motionBudget === ceiling;

  return { baseline, resolved, explanation: resolved.rationale, wasConstrained };
}

// ===========================================================================
// Orchestration — mirrors design-generation-service.ts's deps/run shape.
// ===========================================================================

type TypedClient = SupabaseClient<Database>;

export interface ExperienceRefinementServiceDeps {
  client: TypedClient;
  experienceRefinementRepository: typeof experienceRefinementRepository;
  websiteDesignRepository: typeof websiteDesignRepository;
  designBriefRepository: typeof designBriefRepository;
  missionRepository: typeof missionRepository;
  eventBus: EventBus;
}

export function createExperienceRefinementServiceDeps(client: TypedClient): ExperienceRefinementServiceDeps {
  return {
    client,
    experienceRefinementRepository,
    websiteDesignRepository,
    designBriefRepository,
    missionRepository,
    eventBus: createEventBus(client),
  };
}

/**
 * refineExperience — loads the mission's current (latest, complete)
 * website_design and its Design Brief, resolves the founder's preference
 * through resolveRefinement, and INSERTS a new experience_refinements row —
 * never updates one, matching the table's own insert-only RLS policy set
 * (supabase/migrations/0023_experience_refinements.sql). Always operates on
 * the mission's CURRENT website_design_id, never an older one — this is
 * what makes "evidence changed -> establish a new baseline" (§6) automatic
 * rather than a special case: a fresh generation produces a new
 * website_design row, and the very next refinement call naturally re-plans
 * from it instead of an old, possibly-stale evidence set.
 */
export async function refineExperience(
  deps: ExperienceRefinementServiceDeps,
  missionId: string,
  preference: HumanExperiencePreference,
  refinedBy: string
): Promise<ExperienceRefinementRow> {
  const mission = await deps.missionRepository.findById(deps.client, missionId);
  if (!mission) {
    throw new Error(`Mission ${missionId} not found.`);
  }

  const websiteDesign = await deps.websiteDesignRepository.findLatestByMission(deps.client, missionId);
  if (!websiteDesign || websiteDesign.status !== "complete" || !websiteDesign.wireframe) {
    throw new Error(`No completed website design found for mission ${missionId} — Experience Refinement requires one first.`);
  }

  const briefRow = await deps.designBriefRepository.findById(deps.client, websiteDesign.design_brief_id);
  if (!briefRow || briefRow.status !== "complete" || !briefRow.brief) {
    throw new Error("No completed Design Brief found for this mission — Experience Refinement requires one first.");
  }

  const brief = briefRow.brief as unknown as DesignBrief;
  const designMemory = briefRow.design_memory as unknown as DesignMemory | null;
  const wireframe = websiteDesign.wireframe as unknown as Wireframe;
  if (!wireframe.compositionVariant) {
    throw new Error(
      `Website design ${websiteDesign.id} has no compositionVariant on its stored wireframe (a pre-Phase-6.1 row) — Experience Refinement requires a heroPattern to re-derive the Experience Plan from and cannot safely guess one.`
    );
  }
  const heroPattern = wireframe.compositionVariant.heroPattern;

  const { baseline, resolved, explanation, wasConstrained } = resolveRefinement(brief, designMemory, heroPattern, preference);

  const inserted = await deps.experienceRefinementRepository.insert(deps.client, {
    mission_id: missionId,
    website_design_id: websiteDesign.id,
    organization_id: mission.organization_id,
    preference: preference as unknown as Json,
    baseline_plan: baseline as unknown as Json,
    resolved_plan: resolved as unknown as Json,
    explanation,
    was_constrained: wasConstrained,
    created_by: refinedBy,
  });

  await deps.eventBus.publish({
    type: "ExperienceRefined",
    missionId,
    organizationId: mission.organization_id,
    payload: {
      refinedBy,
      preference,
      baselinePlan: baseline,
      resolvedPlan: resolved,
    },
  });

  return inserted;
}
