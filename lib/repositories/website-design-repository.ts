import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, GenerationStatus } from "@/lib/supabase/database.types";

export type WebsiteDesignRow = Database["public"]["Tables"]["website_designs"]["Row"];
export type WebsiteDesignInsert = Database["public"]["Tables"]["website_designs"]["Insert"];
export type WebsiteDesignUpdate = Database["public"]["Tables"]["website_designs"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for `website_designs` (see
 * supabase/migrations/0010_design_engine.sql) — the Wireframe + Component
 * Assembly output of lib/services/design-generation-service.ts. Pure
 * functions only, no business rules, matching the convention set by
 * lib/repositories/website-analysis-repository.ts.
 */
export const websiteDesignRepository = {
  async insert(client: TypedClient, values: WebsiteDesignInsert): Promise<WebsiteDesignRow> {
    const { data, error } = await client
      .from("website_designs")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(client: TypedClient, id: string, values: WebsiteDesignUpdate): Promise<WebsiteDesignRow> {
    const { data, error } = await client
      .from("website_designs")
      .update(values)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<WebsiteDesignRow | null> {
    const { data, error } = await client
      .from("website_designs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async findLatestByMission(client: TypedClient, missionId: string): Promise<WebsiteDesignRow | null> {
    const { data, error } = await client
      .from("website_designs")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  },
};

export type { GenerationStatus };
