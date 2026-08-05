import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  companyRepository,
  type CompanyRow,
} from "@/lib/repositories/company-repository";

type TypedClient = SupabaseClient<Database>;

export interface CompanyServiceDeps {
  client: TypedClient;
  companyRepository: typeof companyRepository;
}

/** Builds the default deps object for a given Supabase client. */
export function createCompanyServiceDeps(client: TypedClient): CompanyServiceDeps {
  return { client, companyRepository };
}

/**
 * Normalizes a website URL for use as (part of) the companies table's
 * uniqueness key: strips the protocol and any trailing slash, lowercases
 * the host. This normalization happens here in the service layer, not in
 * SQL, per the architecture decision — the DB unique constraint is on the
 * already-normalized value.
 */
export function normalizeWebsiteUrl(rawUrl: string): string {
  let value = rawUrl.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/\/+$/, "");
  return value;
}

export interface FindOrCreateCompanyInput {
  organizationId: string;
  businessName: string;
  websiteUrl: string;
  industry?: string;
  businessCategory?: string;
}

/**
 * Looks up a company by (organization_id, normalized website_url); creates
 * it if missing, otherwise returns the existing record. When an existing
 * company is found and `missionId` is supplied (a new mission is linking
 * to it), bumps `total_missions_count` and `last_mission_id` — cheap and
 * obviously correct to do here, since this is the one call site that knows
 * a mission just started referencing this company.
 *
 * This is the one piece of real Sprint 2 integration wiring: without it,
 * the Memory Vault is a dead table nothing ever writes to. Wired into
 * lib/workflow/mission-workflow.ts::createMission.
 */
export async function findOrCreateCompany(
  deps: CompanyServiceDeps,
  input: FindOrCreateCompanyInput,
  missionId?: string
): Promise<CompanyRow> {
  const normalizedUrl = normalizeWebsiteUrl(input.websiteUrl);

  const existing = await deps.companyRepository.findByOrgAndUrl(
    deps.client,
    input.organizationId,
    normalizedUrl
  );

  if (existing) {
    if (!missionId) return existing;

    return deps.companyRepository.update(deps.client, existing.id, {
      last_mission_id: missionId,
      total_missions_count: existing.total_missions_count + 1,
    });
  }

  return deps.companyRepository.insert(deps.client, {
    organization_id: input.organizationId,
    business_name: input.businessName,
    website_url: normalizedUrl,
    industry: input.industry ?? null,
    business_category: input.businessCategory ?? null,
    last_mission_id: missionId ?? null,
    total_missions_count: missionId ? 1 : 0,
  });
}
