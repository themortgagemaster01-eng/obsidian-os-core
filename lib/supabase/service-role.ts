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

/**
 * Service-role-equivalent Supabase client using Supabase's newer, independently
 * rotatable `secret` key type instead of the legacy `service_role` key.
 *
 * The legacy `service_role` key on this project shares its JWT signing secret
 * with the `anon` key used client-side by every page of the live app, so
 * rotating it would also invalidate `anon` and break the live site. The
 * `secret` key type is a separate credential that can be rotated independently
 * with no effect on `anon`/`publishable`, which makes it the safer choice for
 * any new server-only call site going forward.
 *
 * Currently used only by POST /api/leads/scan — every other server-only call
 * site still uses createServiceRoleClient() above with the legacy key.
 */
export function createSecretKeyClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_URL must be set to run the Lead Hunter scan.");
  }

  return createSupabaseClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
