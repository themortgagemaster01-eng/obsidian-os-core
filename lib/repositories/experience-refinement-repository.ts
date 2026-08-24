import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type ExperienceRefinementRow = Database["public"]["Tables"]["experience_refinements"]["Row"];
export type ExperienceRefinementInsert = Database["public"]["Tables"]["experience_refinements"]["Insert"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for `experience_refinements` (see
 * supabase/migrations/0023_experience_refinements.sql) — the insert-only
 * decision history lib/services/experience-refinement-service.ts writes for
 * every founder Experience Tone / Motion Intensity preference. Pure
 * functions only, no business rules, matching the convention set by
 * lib/repositories/website-design-repository.ts. Deliberately no `update`
 * export — the table's own RLS policies (select + insert only) make an
 * update call fail at the database regardless, so there is nothing here for
 * one to safely wrap.
 */
export const experienceRefinementRepository = {
  async insert(client: TypedClient, values: ExperienceRefinementInsert): Promise<ExperienceRefinementRow> {
    const { data, error } = await client
      .from("experience_refinements")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findLatestByWebsiteDesign(client: TypedClient, websiteDesignId: string): Promise<ExperienceRefinementRow | null> {
    const { data, error } = await client
      .from("experience_refinements")
      .select("*")
      .eq("website_design_id", websiteDesignId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /**
   * Most recent refinement for a mission across ALL of its website_design
   * runs, not just the current one — this is how the "evidence changed,
   * would you like to reapply your previous preference?" prompt (§6) finds a
   * founder's prior preference even after a fresh generation produced a new
   * website_design_id. The caller compares this row's website_design_id
   * against the mission's current one to decide whether to surface a
   * reapply prompt versus treat it as the current refinement.
   */
  async findLatestByMission(client: TypedClient, missionId: string): Promise<ExperienceRefinementRow | null> {
    const { data, error } = await client
      .from("experience_refinements")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async listByMission(client: TypedClient, missionId: string): Promise<ExperienceRefinementRow[]> {
    const { data, error } = await client
      .from("experience_refinements")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },
};
