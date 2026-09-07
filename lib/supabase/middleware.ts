import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Refreshes the Supabase auth session for a given request and returns the
 * response that carries the (possibly updated) session cookies, plus the
 * resolved user (or null). Used by the root middleware.ts to gate routes.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // A genuine Supabase Auth/network failure here must not throw past this
  // function — middleware.ts's own caller has no try/catch around
  // updateSession(), so an uncaught throw here would produce Next.js's
  // generic, non-JSON error response for EVERY request (not just one route)
  // rather than a real, legible outcome (the same unguarded-throw shape
  // 797bcaf fixed one layer downstream, in app/api/leads/scan/route.ts).
  // Treated identically to "no user" — middleware.ts's existing
  // `if (!user && !publicPath)` redirect-to-login path already handles that
  // case correctly; this never invents a new response shape for the
  // thrown-error case.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const {
      data: { user: resolvedUser },
    } = await supabase.auth.getUser();
    user = resolvedUser;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[updateSession] supabase.auth.getUser() threw:", err);
  }

  return { response, user };
}
