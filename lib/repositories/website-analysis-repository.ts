import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, AnalysisStatus } from "@/lib/supabase/database.types";

export type WebsiteAnalysisRow = Database["public"]["Tables"]["website_analyses"]["Row"];
export type WebsiteAnalysisInsert = Database["public"]["Tables"]["website_analyses"]["Insert"];
export type WebsiteAnalysisUpdate = Database["public"]["Tables"]["website_analyses"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `website_analyses` table (see
 * supabase/migrations/0007_website_analysis.sql). Pure functions taking a
 * Supabase client + args, returning typed rows — no business rules here,
 * matching the convention set by lib/repositories/mission-repository.ts.
 * Only lib/services/analysis-service.ts should call this directly.
 */
export const websiteAnalysisRepository = {
  async insert(client: TypedClient, values: WebsiteAnalysisInsert): Promise<WebsiteAnalysisRow> {
    const { data, error } = await client
      .from("website_analyses")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(
    client: TypedClient,
    id: string,
    values: WebsiteAnalysisUpdate
  ): Promise<WebsiteAnalysisRow> {
    const { data, error } = await client
      .from("website_analyses")
      .update(values)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<WebsiteAnalysisRow | null> {
    const { data, error } = await client
      .from("website_analyses")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /**
   * Every run for a mission, most recent first. Which row is "current"
   * when several exist is Open Question 4 in the design doc — callers that
   * just want the latest can take result[0]; this deliberately doesn't
   * bake in a resolution.
   */
  async listByMission(client: TypedClient, missionId: string): Promise<WebsiteAnalysisRow[]> {
    const { data, error } = await client
      .from("website_analyses")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  async findLatestByMission(
    client: TypedClient,
    missionId: string
  ): Promise<WebsiteAnalysisRow | null> {
    const { data, error } = await client
      .from("website_analyses")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  },
};

export type { AnalysisStatus };
