import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { MissionStage, MissionStatus } from "@/lib/workflow/types";

export type MissionRow = Database["public"]["Tables"]["missions"]["Row"];
export type MissionInsert = Database["public"]["Tables"]["missions"]["Insert"];
export type MissionUpdate = Database["public"]["Tables"]["missions"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `missions` table. Pure functions taking a
 * Supabase client + args, returning typed rows. No business rules here —
 * those live in lib/services and lib/workflow.
 */
export const missionRepository = {
  async insert(client: TypedClient, values: MissionInsert): Promise<MissionRow> {
    const { data, error } = await client
      .from("missions")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(
    client: TypedClient,
    id: string,
    values: MissionUpdate
  ): Promise<MissionRow> {
    const { data, error } = await client
      .from("missions")
      .update(values)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<MissionRow | null> {
    const { data, error } = await client
      .from("missions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async listByOwner(client: TypedClient, ownerId: string): Promise<MissionRow[]> {
    const { data, error } = await client
      .from("missions")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },
};

export interface MissionStageAndStatus {
  stage: MissionStage;
  status: MissionStatus;
}
