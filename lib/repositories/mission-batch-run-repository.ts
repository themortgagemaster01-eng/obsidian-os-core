import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type MissionBatchRunRow = Database["public"]["Tables"]["mission_batch_runs"]["Row"];
export type MissionBatchRunInsert = Database["public"]["Tables"]["mission_batch_runs"]["Insert"];
export type MissionBatchRunUpdate = Database["public"]["Tables"]["mission_batch_runs"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `mission_batch_runs` table
 * (supabase/migrations/0025_mission_batch_runs.sql) — pure functions taking
 * a Supabase client + args, returning typed rows. No business rules here
 * (candidate selection, stop conditions, what counts as success) — those
 * live in lib/services/mission-batch-service.ts, mirroring
 * lead-scan-repository.ts's own "no business rules here" discipline exactly.
 */
export const missionBatchRunRepository = {
  async insert(client: TypedClient, values: MissionBatchRunInsert): Promise<MissionBatchRunRow> {
    const { data, error } = await client.from("mission_batch_runs").insert(values).select().single();
    if (error) throw error;
    return data;
  },

  async update(client: TypedClient, id: string, values: MissionBatchRunUpdate): Promise<MissionBatchRunRow> {
    const { data, error } = await client.from("mission_batch_runs").update(values).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<MissionBatchRunRow | null> {
    const { data, error } = await client.from("mission_batch_runs").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** The founder-facing dashboard's own funnel display — the most recent run for this org, whatever its status, so a still-running or a failed batch is shown honestly rather than silently falling back to an older complete one. */
  async findLatestByOrganization(client: TypedClient, organizationId: string): Promise<MissionBatchRunRow | null> {
    const { data, error } = await client
      .from("mission_batch_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Phase 10's overlap guard needs "is a run currently in progress for this
   * organization," not "whatever run most recently started" — those two
   * questions only coincide when nothing has ever altered a row's
   * started_at after the fact. Deliberately a separate, direct query
   * (filtered on status, not derived from "most recent by started_at") so
   * the guard's correctness never depends on that coincidence holding.
   * At most one row can ever match, since the DB-level partial unique index
   * (mission_batch_runs_one_running_per_org) is the real authority that
   * guarantees it.
   */
  async findRunningByOrganization(client: TypedClient, organizationId: string): Promise<MissionBatchRunRow | null> {
    const { data, error } = await client
      .from("mission_batch_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "running")
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};
