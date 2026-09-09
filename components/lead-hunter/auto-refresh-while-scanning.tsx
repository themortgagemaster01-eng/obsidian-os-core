"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 5000;

/**
 * Phase 5.4: while the org's latest scan is still "running", periodically
 * calls router.refresh() so app/leads/page.tsx's funnel and candidates
 * update on their own once the scan completes — Robert doesn't have to
 * manually reload to see it. Renders nothing; stops polling as soon as the
 * server-rendered isRunning prop turns false (the scan reached a real
 * terminal state) or this component unmounts.
 */
export function AutoRefreshWhileScanning({ isRunning }: { isRunning: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isRunning, router]);

  return null;
}
