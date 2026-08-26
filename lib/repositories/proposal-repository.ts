import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type ProposalRow = Database["public"]["Tables"]["proposals"]["Row"];
export type ProposalInsert = Database["public"]["Tables"]["proposals"]["Insert"];
export type ProposalUpdate = Database["public"]["Tables"]["proposals"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `proposals` table (supabase/migrations/
 * 0024_proposals.sql) — pure functions taking a Supabase client + args,
 * returning typed rows. No business rules here (proposal assembly, email
 * drafting, approval eligibility) — those live in
 * lib/services/proposal-service.ts, lib/services/email-draft-service.ts, and
 * lib/workflow/mission-workflow.ts, mirroring every other repository in this
 * codebase's own "no business rules here" discipline.
 */
export const proposalRepository = {
  async insert(client: TypedClient, values: ProposalInsert): Promise<ProposalRow> {
    const { data, error } = await client.from("proposals").insert(values).select().single();
    if (error) throw error;
    return data;
  },

  async update(client: TypedClient, id: string, values: ProposalUpdate): Promise<ProposalRow> {
    const { data, error } = await client.from("proposals").update(values).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<ProposalRow | null> {
    const { data, error } = await client.from("proposals").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** One current proposal per mission (proposals.mission_id is uniquely indexed) — the live, editable-until-decided value, never a history list. */
  async findByMission(client: TypedClient, missionId: string): Promise<ProposalRow | null> {
    const { data, error } = await client.from("proposals").select("*").eq("mission_id", missionId).maybeSingle();
    if (error) throw error;
    return data;
  },
};
