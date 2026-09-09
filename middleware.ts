import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const publicPath = isPublicPath(pathname);

  if (!user && !publicPath) {
    const redirectUrl = new URL("/login", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/login") {
    const redirectUrl = new URL("/", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Phase 5.4 fix: the Lead Hunter dashboard (app/leads/page.tsx) renders
  // live `leads`/`lead_scan_runs` state that must reflect a just-completed
  // scan on a normal reload. The page is already forced dynamic (root
  // layout's `dynamic = "force-dynamic"`), but without an explicit header
  // this route still falls back to Vercel's own default Cache-Control for a
  // dynamic response (`public, max-age=0, must-revalidate`), which still
  // permits a shared/edge cache to serve a conditionally-revalidated copy on
  // a plain reload — the likely reason a normal reload showed stale results
  // and only Ctrl+Shift+R (which forces every intermediary to skip its
  // cache) reliably worked. no-store rules that out unconditionally.
  if (pathname === "/leads") {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
