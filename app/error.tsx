"use client";

import { useEffect } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Root error boundary (Next.js App Router convention: app/error.tsx).
 * Resilience-sweep addition — before this, an unhandled exception anywhere
 * in a Server Component's render (e.g. a raw repository throw with no
 * try/catch, the same `if (error) throw error` class of bug already fixed
 * across the API routes) fell through to Next's generic, unstyled error
 * screen with no way back into the app except a manual URL edit. This is
 * purely a safety net — it doesn't change what can fail, only what the
 * founder sees when something does.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[app/error.tsx] unhandled render error:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This page hit an unexpected error. It&apos;s been logged — try again, or head back to Mission Control.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/">Mission Control</Link>
        </Button>
      </div>
    </main>
  );
}
