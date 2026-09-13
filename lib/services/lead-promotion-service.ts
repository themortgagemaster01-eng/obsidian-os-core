import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { leadRepository, type LeadRow } from "@/lib/repositories/lead-repository";
import type { MissionRow } from "@/lib/repositories/mission-repository";
import { createMission, type CreateMissionRequest } from "@/lib/services/mission-service";
import { evaluateNoWebsiteEvidence } from "@/lib/services/no-website-evidence-gate";

type TypedClient = SupabaseClient<Database>;

/**
 * lead-promotion-service.ts — the "Launch Makeover" handoff (CTO Phase 2
 * directive §6), Lead Hunter's one write path into the real pipeline. Does
 * NOT rebuild or duplicate the makeover engine: it calls the existing,
 * unchanged lib/services/mission-service.ts::createMission — the same
 * entry point the plain "new mission" dialog already uses — just seeded
 * with this lead's own real, already-qualified business_name/website_url/
 * industry/business_category instead of a bare URL, so the mission that
 * results is never a generic empty project (§6's own requirement).
 *
 * A separate service from lead-hunter-service.ts (discovery/qualification)
 * and business-intelligence-service.ts (read-model assembly for display) —
 * "services have one job each" (CLAUDE.md). This one's job is exactly the
 * promotion transaction: validate eligibility, create the mission, write
 * `leads.status/company_id/mission_id/promoted_at` back — the only place in
 * this codebase that ever sets a lead to `promoted` (0018_lead_hunter.sql's
 * own comment: "Set only once this lead is promoted into the real pipeline —
 * never populated speculatively").
 */

export interface LeadPromotionServiceDeps {
  client: TypedClient;
  leadRepository: Pick<typeof leadRepository, "findById" | "update">;
  createMission: (client: TypedClient, request: CreateMissionRequest) => Promise<MissionRow>;
}

export function createLeadPromotionServiceDeps(client: TypedClient): LeadPromotionServiceDeps {
  return { client, leadRepository, createMission };
}

export interface PromoteLeadInput {
  leadId: string;
  ownerId: string;
}

export interface PromoteLeadResult {
  lead: LeadRow;
  mission: MissionRow;
}

/**
 * promoteLeadToMission — only a `candidate` lead is eligible (a
 * `pending`/`rejected` lead was never qualified for this, and an
 * already-`promoted` lead already has a real mission — re-promoting it would
 * silently orphan or duplicate that mission, so this throws instead of
 * quietly creating a second one). Mirrors mission-workflow.ts's own
 * "validate eligibility, then act, then throw a clear error otherwise"
 * shape for consistency with the rest of this codebase's state-guarding
 * services.
 *
 * No-website evidence gate (Robert's locked spec, §1/§3): a candidate with
 * no captured website_url no longer throws for lacking one — a confirmed
 * no-website business is a real, legitimate opportunity (a brand-new build,
 * not a redesign), not a data gap. Instead it must clear the deterministic
 * evidence gate (lib/services/no-website-evidence-gate.ts) — at least one
 * verified business-specific phone number or a specific street address —
 * before a mission is created at all. An UNCERTAIN/FAILED verdict throws
 * here, as early in the funnel as possible, exactly like every other
 * eligibility check above: a founder never even gets a mission for a lead
 * this thin, per the explicit "do not generate customer-facing preview"
 * instruction. The same gate runs again, as the authoritative last-line
 * check, immediately before design-brief-service.ts's LLM call — this is
 * defense in depth (identical in spirit to how identity verification
 * re-checks a crawled business right before that same LLM call), not
 * redundant, since nothing else in this codebase currently prevents a
 * no-website mission from being created any other way.
 */
export async function promoteLeadToMission(deps: LeadPromotionServiceDeps, input: PromoteLeadInput): Promise<PromoteLeadResult> {
  const lead = await deps.leadRepository.findById(deps.client, input.leadId);
  if (!lead) {
    throw new Error(`Lead ${input.leadId} not found.`);
  }
  if (lead.status === "promoted") {
    throw new Error(`Lead ${input.leadId} has already been promoted (mission ${lead.mission_id ?? "unknown"}) — cannot promote it a second time.`);
  }
  if (lead.status !== "candidate") {
    throw new Error(`Lead ${input.leadId} is "${lead.status}", not "candidate" — only a qualified candidate can be launched into a makeover.`);
  }
  if (!lead.website_url) {
    const evidence = evaluateNoWebsiteEvidence({
      businessName: lead.business_name,
      phone: lead.discovery_phone,
      address: lead.discovery_address,
    });
    if (evidence.verdict !== "CONFIRMED") {
      throw new Error(
        `Lead ${input.leadId} has no website and does not clear the no-website evidence gate (${evidence.verdict}) — ${evidence.reason}`
      );
    }
  }

  const mission = await deps.createMission(deps.client, {
    ownerId: input.ownerId,
    organizationId: lead.organization_id,
    businessName: lead.business_name,
    websiteUrl: lead.website_url,
    industry: lead.industry ?? undefined,
    businessCategory: lead.business_category ?? undefined,
  });

  const updatedLead = await deps.leadRepository.update(deps.client, lead.id, {
    status: "promoted",
    company_id: mission.company_id,
    mission_id: mission.id,
    promoted_at: new Date().toISOString(),
  });

  return { lead: updatedLead, mission };
}
