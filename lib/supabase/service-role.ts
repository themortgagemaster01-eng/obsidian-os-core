import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Service-role Supabase client, for use ONLY by trusted server-side code
 * that has no user session to act as — specifically the §2 background
 * analysis worker (app/api/missions/[id]/analyze/background/route.ts),
 * which runs detached from the request that triggered it and therefore
 * has no cookie-based session to read.
 *
 * This bypasses RLS entirely (service_role key), so it must never be
 * exposed to the browser and every write it performs must be scoped
 * explicitly in application code (organization_id, mission_id) rather than
 * relying on RLS to do it — the background worker does this by only ever
 * writing rows it derives from a mission it already loaded by id.
 *
 * Deliberately a separate file from lib/supabase/server.ts (the
 * cookie-based, RLS-respecting client used by every user-facing route)
 * so the two are never confused at an import-site glance.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL must be set to run the background analysis worker."
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
