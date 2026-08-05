import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `profiles` table. Profile rows are created
 * automatically by the `handle_new_user()` trigger on `auth.users` insert
 * (see supabase/migrations/0001_init.sql), so this repository is read-only
 * in Sprint 1.
 */
export const profileRepository = {
  async findById(client: TypedClient, id: string): Promise<ProfileRow | null> {
    const { data, error } = await client
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data;
  },
};
