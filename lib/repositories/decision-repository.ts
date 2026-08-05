import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type DecisionRow = Database["public"]["Tables"]["decisions"]["Row"];
export type DecisionInsert = Database["public"]["Tables"]["decisions"]["Insert"];

type TypedClient = SupabaseClient<Database>;

/**
 * The set of decision types a human can make in the (future) Approval
 * Queue, matching the `decisions.decision_type` CHECK constraint in
 * supabase/migrations/0005_decisions.sql exactly. Defined here rather than
 * in lib/services/decision-service.ts (the two are equally plausible
 * homes) because this is the type that mirrors a DB constraint, which is
 * the repository layer's job elsewhere in this codebase (see MissionState
 * mirroring the missions.state constraint) — decision-service.ts re-exports
 * it for convenience so callers don't need to know which layer owns it.
 */
export type DecisionType =
  | "approve"
  | "reject"
  | "not_a_fit"
  | "edit_subject"
  | "edit_email"
  | "edit_proposal"
  | "change_price"
  | "skip_industry"
  | "approve_immediately"
  | "wait_until_later"
  | "archive";

/**
 * Thin data-access layer for the `decisions` table — the Decision
 * Intelligence layer's storage. Nothing calls this yet in Sprint 2 (no
 * Approval Queue UI exists); lib/services/decision-service.ts is the
 * intended caller once that UI ships.
 */
export const decisionRepository = {
  async insert(client: TypedClient, values: DecisionInsert): Promise<DecisionRow> {
    const { data, error } = await client
      .from("decisions")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async listByMission(client: TypedClient, missionId: string): Promise<DecisionRow[]> {
    const { data, error } = await client
      .from("decisions")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data ?? [];
  },
};
