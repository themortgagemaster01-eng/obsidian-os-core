import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type IdentityVerificationRow = Database["public"]["Tables"]["identity_verifications"]["Row"];
export type IdentityVerificationInsert = Database["public"]["Tables"]["identity_verifications"]["Insert"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for `identity_verifications`
 * (supabase/migrations/0027_identity_verification.sql) — one row per
 * identity check, insert-only, same "no business rules here" discipline
 * experience-refinement-repository.ts already models: what a verdict *means*
 * and what it does to a mission lives in
 * lib/services/identity-verification-service.ts (the pure decision) and
 * lib/services/design-brief-service.ts (the caller that acts on it), never
 * here.
 */
export const identityVerificationRepository = {
  async insert(client: TypedClient, values: IdentityVerificationInsert): Promise<IdentityVerificationRow> {
    const { data, error } = await client
      .from("identity_verifications")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findLatestByMission(client: TypedClient, missionId: string): Promise<IdentityVerificationRow | null> {
    const { data, error } = await client
      .from("identity_verifications")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  },
};
