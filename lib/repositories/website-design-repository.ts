import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, GenerationStatus } from "@/lib/supabase/database.types";

export type WebsiteDesignRow = Database["public"]["Tables"]["website_designs"]["Row"];
export type WebsiteDesignInsert = Database["public"]["Tables"]["website_designs"]["Insert"];
export type WebsiteDesignUpdate = Database["public"]["Tables"]["website_designs"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for `website_designs` (see
 * supabase/migrations/0010_design_engine.sql) — the Wireframe + Component
 * Assembly output of lib/services/design-generation-service.ts. Pure
 * functions only, no business rules, matching the convention set by
 * lib/repositories/website-analysis-repository.ts.
 */
export const websiteDesignRepository = {
  async insert(client: TypedClient, values: WebsiteDesignInsert): Promise<WebsiteDesignRow> {
    const { data, error } = await client
      .from("website_designs")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(client: TypedClient, id: string, values: WebsiteDesignUpdate): Promise<WebsiteDesignRow> {
    const { data, error } = await client
      .from("website_designs")
      .update(values)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<WebsiteDesignRow | null> {
    const { data, error } = await client
      .from("website_designs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async findLatestByMission(client: TypedClient, missionId: string): Promise<WebsiteDesignRow | null> {
    const { data, error } = await client
      .from("website_designs")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /**
   * The overlap guard's own "is a generation already in flight for this
   * mission" question — same shape and reasoning as
   * designBriefRepository.findInFlightByMission: 'pending' (set by
   * createDesignGenerationRun) and 'running' (set later by
   * runDesignGeneration, in the background job the route never awaits)
   * both count as in-flight. At most one row can ever match, since the
   * DB-level partial unique index (website_designs_one_inflight_per_mission)
   * is the real authority that guarantees it.
   */
  async findInFlightByMission(client: TypedClient, missionId: string): Promise<WebsiteDesignRow | null> {
    const { data, error } = await client
      .from("website_designs")
      .select("*")
      .eq("mission_id", missionId)
      .in("status", ["pending", "running"])
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /**
   * Design QA's own overlap guard question (pipeline audit finding #7,
   * 2026-09-11) — mirrors findInFlightByMission's shape, but keyed on
   * qa_status rather than status, since QA writes onto an existing
   * website_designs row rather than inserting a new one (see
   * 0032_website_designs_qa_overlap_guard.sql). At most one row can ever
   * match, since the DB-level partial unique index
   * (website_designs_one_qa_inflight_per_mission) is the real authority
   * that guarantees it.
   */
  async findQaInFlightByMission(client: TypedClient, missionId: string): Promise<WebsiteDesignRow | null> {
    const { data, error } = await client
      .from("website_designs")
      .select("*")
      .eq("mission_id", missionId)
      .eq("qa_status", "running")
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /**
   * Every website_designs row ever created for this mission, newest first
   * — for the Design Intelligence regeneration-for-comparison feature
   * (2026-09-12). Rows are never deleted, so this is a real, complete
   * history; the mission preview page (app/missions/[id]/preview) already
   * supports viewing any one of them via `?designId=`, so this list is
   * the only new surface the comparison feature actually needs.
   */
  async findAllByMission(client: TypedClient, missionId: string): Promise<WebsiteDesignRow[]> {
    const { data, error } = await client
      .from("website_designs")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  /**
   * Every completed design run in an organization — design-qa-service.ts's
   * batch input for lib/design-intelligence/layout-rules.ts's
   * findDuplicateSectionStructures() (§4.3/§4.10/§4.11's cross-mission
   * "not a template" check, that function's first real caller) and for
   * Typography QA's "is this pairing becoming the de facto default" check.
   * Deliberately scoped to `status = 'complete'` only — a pending/failed run
   * has no wireframe/refined_design worth comparing against.
   */
  async listCompletedByOrganization(client: TypedClient, organizationId: string): Promise<WebsiteDesignRow[]> {
    const { data, error } = await client
      .from("website_designs")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "complete");

    if (error) throw error;
    return data ?? [];
  },
};

export type { GenerationStatus };
