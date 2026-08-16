import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type LeadScanRunRow = Database["public"]["Tables"]["lead_scan_runs"]["Row"];
export type LeadScanRunInsert = Database["public"]["Tables"]["lead_scan_runs"]["Insert"];
export type LeadScanRunUpdate = Database["public"]["Tables"]["lead_scan_runs"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `lead_scan_runs` table (supabase/migrations/
 * 0021_lead_scan_runs.sql) — pure functions taking a Supabase client + args,
 * returning typed rows. No business rules here (funnel-count computation,
 * what counts as "meaningful opportunity" or "high confidence") — those live
 * in lib/services/lead-hunter-service.ts, mirroring lead-repository.ts's own
 * "no business rules here" discipline exactly.
 */
export const leadScanRepository = {
  async insert(client: TypedClient, values: LeadScanRunInsert): Promise<LeadScanRunRow> {
    const { data, error } = await client.from("lead_scan_runs").insert(values).select().single();
    if (error) throw error;
    return data;
  },

  async update(client: TypedClient, id: string, values: LeadScanRunUpdate): Promise<LeadScanRunRow> {
    const { data, error } = await client.from("lead_scan_runs").update(values).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<LeadScanRunRow | null> {
    const { data, error } = await client.from("lead_scan_runs").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** The Lead Hunter dashboard's own funnel display — the most recent run for this org, whatever its status, so a still-running or a failed scan is shown honestly rather than silently falling back to an older complete one. */
  async findLatestByOrganization(client: TypedClient, organizationId: string): Promise<LeadScanRunRow | null> {
    const { data, error } = await client
      .from("lead_scan_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};
