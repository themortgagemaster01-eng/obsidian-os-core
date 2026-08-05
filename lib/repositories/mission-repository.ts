import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { MissionState } from "@/lib/workflow/mission-state";

export type MissionRow = Database["public"]["Tables"]["missions"]["Row"];
export type MissionInsert = Database["public"]["Tables"]["missions"]["Insert"];
export type MissionUpdate = Database["public"]["Tables"]["missions"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `missions` table. Pure functions taking a
 * Supabase client + args, returning typed rows. No business rules here —
 * those live in lib/services and lib/workflow.
 *
 * Sprint 2: access is scoped by organization membership (RLS), not
 * owner_id directly, so listing now goes through listByOrganization rather
 * than the Sprint 1 listByOwner. owner_id is kept on the row (who created /
 * is assigned to the mission) but is no longer the query/RLS boundary.
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

  async listByOrganization(client: TypedClient, organizationId: string): Promise<MissionRow[]> {
    const { data, error } = await client
      .from("missions")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },
};

export interface MissionStateShape {
  state: MissionState;
}
