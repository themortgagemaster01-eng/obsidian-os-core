import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Shared fallback for a Server Component page whose own data-fetching threw
 * (the same raw-throw repository convention already guarded across every
 * API route this week) — rendered from that page's own try/catch instead of
 * letting the error fall through to app/error.tsx uncaught. A local, honest
 * message beats the generic root boundary here since the page already knows
 * which specific fetch failed.
 */
export function PageLoadError({ message, backHref = "/", backLabel = "Mission Control" }: { message: string; backHref?: string; backLabel?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" asChild>
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </main>
  );
}
