import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type LeadRow = Database["public"]["Tables"]["leads"]["Row"];
export type LeadInsert = Database["public"]["Tables"]["leads"]["Insert"];
export type LeadUpdate = Database["public"]["Tables"]["leads"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `leads` table (supabase/migrations/
 * 0018_lead_hunter.sql) — pure functions taking a Supabase client + args,
 * returning typed rows. No business rules here (scoring, ranking,
 * promotion eligibility) — those live in lib/services/lead-hunter-service.ts
 * and lib/services/lead-scoring-service.ts, mirroring mission-repository.ts's
 * own "no business rules here" discipline exactly.
 */
export const leadRepository = {
  async insert(client: TypedClient, values: LeadInsert): Promise<LeadRow> {
    const { data, error } = await client.from("leads").insert(values).select().single();
    if (error) throw error;
    return data;
  },

  async update(client: TypedClient, id: string, values: LeadUpdate): Promise<LeadRow> {
    const { data, error } = await client.from("leads").update(values).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<LeadRow | null> {
    const { data, error } = await client.from("leads").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Phase 8: the reverse of promoteLeadToMission's own leads.mission_id write — finds the original qualification evidence (main_weaknesses/main_opportunity/scores) for a mission that came from a promoted lead. Null for a mission created directly (the plain "new mission" dialog, never a lead), which callers must treat as a real, honest absence of qualification evidence, not an error. */
  async findByMission(client: TypedClient, missionId: string): Promise<LeadRow | null> {
    const { data, error } = await client.from("leads").select("*").eq("mission_id", missionId).maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Phase 9: the next eligible candidate for a mission batch run — real,
   * already-qualified leads for this org/location, never already-promoted
   * ones (leads.status = 'candidate' only — the same status
   * promoteLeadToMission itself already requires), ranked by the same
   * opportunity_score Lead Hunter itself already computed (no new ranking
   * logic). `excludeLeadIds` covers the one gap leads.status alone can't:
   * a lead whose PROMOTION ITSELF failed within this run stays 'candidate'
   * (nothing changed it), so without this exclusion the same failing lead
   * could be re-selected and re-attempted forever within one run — this
   * repository has no opinion on retries; the caller (mission-batch-
   * service.ts) is the one place that decides a lead is done with for this
   * run, and passes its id back here to exclude it going forward.
   */
  async findNextEligibleCandidate(
    client: TypedClient,
    organizationId: string,
    location: string,
    excludeLeadIds: string[]
  ): Promise<LeadRow | null> {
    let query = client
      .from("leads")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "candidate")
      .ilike("location", `%${location}%`)
      .order("opportunity_score", { ascending: false, nullsFirst: false })
      .limit(1);
    if (excludeLeadIds.length > 0) {
      query = query.not("id", "in", `(${excludeLeadIds.join(",")})`);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  },

  /** The real dedupe lookup a scan uses before inserting — keyed on the same (organization_id, discovery_source, discovery_external_id) uniqueness the migration's own index enforces, so a re-scan of the same area updates an existing candidate instead of duplicating it. */
  async findBySourceAndExternalId(
    client: TypedClient,
    organizationId: string,
    discoverySource: string,
    discoveryExternalId: string
  ): Promise<LeadRow | null> {
    const { data, error } = await client
      .from("leads")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("discovery_source", discoverySource)
      .eq("discovery_external_id", discoveryExternalId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listByOrganization(client: TypedClient, organizationId: string): Promise<LeadRow[]> {
    const { data, error } = await client
      .from("leads")
      .select("*")
      .eq("organization_id", organizationId)
      .order("opportunity_score", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data ?? [];
  },

  /** "Today's Opportunities" (CTO Lead Hunter directive §8) — the top-N ranked candidate leads, real ones only. */
  async listTopCandidates(client: TypedClient, organizationId: string, limit: number): Promise<LeadRow[]> {
    const { data, error } = await client
      .from("leads")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "candidate")
      .order("opportunity_score", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },
};
