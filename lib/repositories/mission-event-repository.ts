import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type MissionEventRow = Database["public"]["Tables"]["mission_events"]["Row"];
export type MissionEventInsert = Database["public"]["Tables"]["mission_events"]["Insert"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `mission_events` table. As of Sprint 2 this
 * is the persistence half of the formal event bus (lib/events/event-bus.ts)
 * — nothing else should insert into mission_events directly. Columns added
 * in Sprint 2 (see supabase/migrations/0004_event_bus.sql):
 *   - `actor`: who/what published the event — `system`, `user`, or
 *     `agent:<name>` for future Sprint 3+ agents.
 *   - `organization_id`: denormalized from the parent mission for RLS and
 *     analytics query simplicity (avoids a join on every check).
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
