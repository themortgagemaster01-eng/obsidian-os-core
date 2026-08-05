import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import {
  decisionRepository,
  type DecisionRow,
  type DecisionType,
} from "@/lib/repositories/decision-repository";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";

export type { DecisionType } from "@/lib/repositories/decision-repository";

type TypedClient = SupabaseClient<Database>;

export interface DecisionServiceDeps {
  client: TypedClient;
  decisionRepository: typeof decisionRepository;
  eventBus: EventBus;
}

/** Builds the default deps object for a given Supabase client. */
export function createDecisionServiceDeps(client: TypedClient): DecisionServiceDeps {
  return { client, decisionRepository, eventBus: createEventBus(client) };
}

export interface LogDecisionInput {
  missionId: string;
  organizationId: string;
  decisionType: DecisionType;
  aiRecommendation?: string;
  userAction?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  industry?: string;
  opportunityScore?: number;
  websiteScore?: number;
  proposalPrice?: number;
  emailSubject?: string;
  emailLength?: number;
  websiteTheme?: string;
  businessCategory?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Records a single human decision made in the (future) Approval Queue and
 * publishes a `DecisionLogged` event through the event bus. This is the
 * Decision Intelligence layer's write path — the goal is capturing perfect
 * training data from day one for every meaningful approve/reject/edit
 * decision, even though no UI calls this yet in Sprint 2.
 *
 * Architecture only: no ML/prediction happens here or anywhere else in
 * Sprint 2. `aiRecommendation` and `userAction` are plain text fields ready
 * to hold whatever a future recommendation engine and human operator
 * produce.
 */
export async function logDecision(
  deps: DecisionServiceDeps,
  input: LogDecisionInput
): Promise<DecisionRow> {
  const decision = await deps.decisionRepository.insert(deps.client, {
    mission_id: input.missionId,
    organization_id: input.organizationId,
    decision_type: input.decisionType,
    ai_recommendation: input.aiRecommendation ?? null,
    user_action: input.userAction ?? null,
    before_value: (input.beforeValue as Json | undefined) ?? null,
    after_value: (input.afterValue as Json | undefined) ?? null,
    industry: input.industry ?? null,
    opportunity_score: input.opportunityScore ?? null,
    website_score: input.websiteScore ?? null,
    proposal_price: input.proposalPrice ?? null,
    email_subject: input.emailSubject ?? null,
    email_length: input.emailLength ?? null,
    website_theme: input.websiteTheme ?? null,
    business_category: input.businessCategory ?? null,
    metadata: (input.metadata as Json | undefined) ?? {},
  });

  await deps.eventBus.publish({
    type: "DecisionLogged",
    missionId: input.missionId,
    organizationId: input.organizationId,
    payload: { decisionType: input.decisionType },
  });

  return decision;
}
