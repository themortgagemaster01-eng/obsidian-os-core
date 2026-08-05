import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type MissionEventRow = Database["public"]["Tables"]["mission_events"]["Row"];
export type MissionEventInsert = Database["public"]["Tables"]["mission_events"]["Insert"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `mission_events` table — the seed of the
 * mission event bus. Pure query functions only; the workflow engine decides
 * what events to write and when.
 */
export const missionEventRepository = {
  async insert(client: TypedClient, values: MissionEventInsert): Promise<MissionEventRow> {
    const { data, error } = await client
      .from("mission_events")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async listByMission(client: TypedClient, missionId: string): Promise<MissionEventRow[]> {
    const { data, error } = await client
      .from("mission_events")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data ?? [];
  },
};
