"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Launch Makeover (CTO Phase 2 directive §6) — the one button that hands a
 * qualified lead's already-gathered business intelligence to the real
 * makeover engine via POST /api/leads/:id/promote
 * (lib/services/lead-promotion-service.ts). On success, redirects straight
 * to the new mission's own page — that mission is real, already linked to
 * this lead via mission_id/company_id, not a placeholder to click into
 * later.
 */
export function LaunchMakeoverButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/leads/${leadId}/promote`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { mission?: { id: string }; error?: string } | null;
      if (!response.ok || !body?.mission) {
        throw new Error(body?.error ?? "Failed to launch makeover");
      }
      router.push(`/missions/${body.mission.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch makeover");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={handleClick} disabled={submitting}>
        {submitting ? "Launching makeover…" : "Launch Makeover"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
