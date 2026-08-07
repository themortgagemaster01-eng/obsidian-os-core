import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
export type CompanyInsert = Database["public"]["Tables"]["companies"]["Insert"];
export type CompanyUpdate = Database["public"]["Tables"]["companies"]["Update"];

type TypedClient = SupabaseClient<Database>;

/**
 * Thin data-access layer for the `companies` table — the Memory Vault, the
 * anchor of the future CRM. Pure query functions only; the normalization
 * and find-or-create logic lives in lib/services/company-service.ts.
 */
export const companyRepository = {
  async insert(client: TypedClient, values: CompanyInsert): Promise<CompanyRow> {
    const { data, error } = await client
      .from("companies")
      .insert(values)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(client: TypedClient, id: string, values: CompanyUpdate): Promise<CompanyRow> {
    const { data, error } = await client
      .from("companies")
      .update(values)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findById(client: TypedClient, id: string): Promise<CompanyRow | null> {
    const { data, error } = await client
      .from("companies")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /** Looks up a company by its (organization_id, normalized website_url) unique key. */
  async findByOrgAndUrl(
    client: TypedClient,
    organizationId: string,
    normalizedWebsiteUrl: string
  ): Promise<CompanyRow | null> {
    const { data, error } = await client
      .from("companies")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("website_url", normalizedWebsiteUrl)
      .maybeSingle();

    if (error) throw error;
    return data;
  },
};
