import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, GenerationStatus } from "@/lib/supabase/database.types";

export type DesignBriefRow = Database["public"]["Tables"]["design_briefs"]["Row"];
export type DesignBriefInsert = Database["public"]["Tables"]["design_briefs"]["Insert"];
export type DesignBriefUpdate = Database["public"]["Tables"]["design_briefs"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for `design_briefs` (see
 * supabase/migrations/0010_design_engine.sql). Pure functions taking a
 * Supabase client + args, returning typed rows — no business rules here,
 * matching the convention set by lib/repositories/website-analysis-
 * repository.ts. Only lib/services/design-brief-service.ts should call
 * this directly.
 */
export const designBriefRepository = {
  async insert(client: TypedClient, values: DesignBriefInsert): Promise<DesignBriefRow> {
    const { data, error } = await client
      .from("design_briefs")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(client: TypedClient, id: string, values: DesignBriefUpdate): Promise<DesignBriefRow> {
    const { data, error } = await client
      .from("design_briefs")
      .update(values)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<DesignBriefRow | null> {
    const { data, error } = await client
      .from("design_briefs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async findLatestByMission(client: TypedClient, missionId: string): Promise<DesignBriefRow | null> {
    const { data, error } = await client
      .from("design_briefs")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /**
   * The overlap guard's own "is a design brief already in flight for this
   * mission" question — same shape and reasoning as
   * websiteAnalysisRepository.findInFlightByMission: 'pending' (set by
   * createDesignBriefRun) and 'running' (set later by runDesignBrief, in
   * the background job the route never awaits) both count as in-flight.
   * At most one row can ever match, since the DB-level partial unique
   * index (design_briefs_one_inflight_per_mission) is the real authority
   * that guarantees it.
   */
  async findInFlightByMission(client: TypedClient, missionId: string): Promise<DesignBriefRow | null> {
    const { data, error } = await client
      .from("design_briefs")
      .select("*")
      .eq("mission_id", missionId)
      .in("status", ["pending", "running"])
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /**
   * Every design_briefs row ever created for this mission, newest first —
   * for the Design Intelligence regeneration-for-comparison feature
   * (2026-09-12). Rows are never deleted (no delete() exists on this
   * repository), so this is a real, complete history, not a partial one —
   * a mission regenerated 3 times has all 3 real rows here, unmodified.
   */
  async findAllByMission(client: TypedClient, missionId: string): Promise<DesignBriefRow[]> {
    const { data, error } = await client
      .from("design_briefs")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  /** Mirrors websiteDesignRepository.listCompletedByOrganization — design-qa-service.ts's cross-mission genericity checks (heroThesis/signatureElement duplication) need every other completed mission's brief in this organization, the same way findDuplicateSectionStructures already needs every other mission's wireframe. */
  async listCompletedByOrganization(client: TypedClient, organizationId: string): Promise<DesignBriefRow[]> {
    const { data, error } = await client
      .from("design_briefs")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "complete");

    if (error) throw error;
    return data ?? [];
  },
};

export type { GenerationStatus };
