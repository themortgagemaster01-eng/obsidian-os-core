import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Creates a typed Supabase client for use in Server Components, Route
 * Handlers, and Server Actions. Reads/writes the auth session via cookies.
 *
 * Server Components can only read cookies, not write them, so `setAll` is
 * wrapped in try/catch: calling it from a Server Component throws, but the
 * session is still refreshed by middleware on every request, so the no-op
 * is safe there.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component — middleware handles refresh.
          }
        },
      },
    }
  );
}
