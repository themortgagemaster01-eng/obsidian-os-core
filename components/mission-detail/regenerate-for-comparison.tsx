"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, History, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DesignBriefRow } from "@/lib/repositories/design-brief-repository";
import type { WebsiteDesignRow } from "@/lib/repositories/website-design-repository";

const POLL_INTERVAL_MS = 3000;

/**
 * Design Intelligence regeneration-for-comparison feature (2026-09-12).
 * Renders only on missions already past the Founder Approval Gate (Fix
 * #11's guard, see app/api/missions/[id]/design-brief/route.ts) — every
 * earlier-stage mission already has the normal Generate/Retry flow in
 * design-brief-panel.tsx. This component is purely additive: an explicit,
 * confirmation-gated escape hatch for the founder to run a fresh Design
 * Brief + generation for comparison against a mission's real,
 * already-approved baseline (e.g. the Fix #6-8 typography/color/composition
 * changes) — never a way to accidentally re-trigger generation, and never
 * a mutation of the panel's own displayed "current" brief/design state.
 */
export function RegenerateForComparison({ missionId }: { missionId: string }) {
  const [history, setHistory] = useState<{ designBriefs: DesignBriefRow[]; websiteDesigns: WebsiteDesignRow[] } | null>(
    null
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerateDone, setRegenerateDone] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/design-brief/history`);
      const body = (await res.json().catch(() => null)) as
        | { designBriefs: DesignBriefRow[]; websiteDesigns: WebsiteDesignRow[]; error?: undefined }
        | { error: string }
        | null;
      if (!res.ok || !body || body.error !== undefined) {
        throw new Error((body && "error" in body ? body.error : undefined) ?? "Failed to load regeneration history");
      }
      setHistory(body);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load regeneration history");
    } finally {
      setHistoryLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function handleConfirmRegenerate() {
    setRegenerating(true);
    setRegenerateError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/design-brief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ forceRegenerate: true }),
      });
      const body = (await res.json().catch(() => null)) as { designBrief?: DesignBriefRow; error?: string } | null;
      if (!res.ok || !body?.designBrief) throw new Error(body?.error ?? "Failed to start Design Brief regeneration");

      // Poll this one forced run to completion, then auto-chain into
      // generate-design — mirrors design-brief-panel.tsx's handleApprove
      // auto-chain, but scoped to this run's own id so it never reads or
      // writes the panel's separate polling state for the mission's
      // current, already-approved brief/design.
      const newBriefId = body.designBrief.id;
      let finished = body.designBrief;
      while (finished.status === "pending" || finished.status === "running") {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const pollRes = await fetch(`/api/missions/${missionId}/design-brief`);
        if (!pollRes.ok) break;
        const pollBody = (await pollRes.json()) as { designBrief: DesignBriefRow | null };
        if (!pollBody.designBrief || pollBody.designBrief.id !== newBriefId) break;
        finished = pollBody.designBrief;
      }

      if (finished.status === "complete") {
        const genRes = await fetch(`/api/missions/${missionId}/generate-design`, { method: "POST" });
        if (!genRes.ok) {
          const genBody = (await genRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(genBody?.error ?? "Design Brief regenerated, but starting website generation failed");
        }
      } else if (finished.status === "failed") {
        throw new Error(finished.error_message ?? "Design Brief regeneration failed");
      }

      setRegenerateDone(true);
      setConfirmOpen(false);
      await loadHistory();
    } catch (err) {
      setRegenerateError(err instanceof Error ? err.message : "Failed to start Design Brief regeneration");
    } finally {
      setRegenerating(false);
    }
  }

  const designBriefs = history?.designBriefs ?? [];
  const websiteDesigns = history?.websiteDesigns ?? [];

  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Regenerate for comparison</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Run a fresh Design Brief and website generation from this mission&apos;s real evidence, to compare
              against its current, already-approved design. This does not change the mission&apos;s approved state.
            </p>
          </div>
          <Button onClick={() => setConfirmOpen(true)} variant="outline" size="sm" className="shrink-0 gap-2">
            <History className="h-4 w-4" />
            Regenerate (Test)
          </Button>
        </div>

        {regenerateDone && !regenerating && (
          <p className="text-sm text-emerald-400">Regeneration started — see the updated list below.</p>
        )}
        {regenerateError && <p className="text-sm text-red-400">{regenerateError}</p>}

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Past regenerations</p>
          {historyLoading && !history && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading history…
            </p>
          )}
          {historyError && <p className="text-sm text-red-400">{historyError}</p>}
          {!historyLoading && designBriefs.length === 0 && !historyError && (
            <p className="text-sm text-muted-foreground">No regenerations yet.</p>
          )}
          <ul className="space-y-1.5">
            {designBriefs.map((brief) => {
              const matchingDesign = websiteDesigns.find((d) => d.design_brief_id === brief.id);
              return (
                <li key={brief.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {new Date(brief.created_at).toLocaleString()} — <span className="text-foreground">{brief.status}</span>
                    {matchingDesign ? ` · design: ${matchingDesign.status}` : " · no design generated"}
                  </span>
                  {matchingDesign && (
                    <Link
                      href={`/missions/${missionId}/preview?designId=${matchingDesign.id}`}
                      className="shrink-0 text-sm font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      View preview
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(open) => !regenerating && setConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Regenerate Design Brief for comparison?
            </DialogTitle>
            <DialogDescription>
              This makes a real Anthropic call and generates a new website design from scratch, grounded in this
              mission&apos;s real evidence — it costs real money and takes a few minutes. It will NOT change the
              mission&apos;s current state or its already-approved design; the result is only added to the list
              below for comparison.
            </DialogDescription>
          </DialogHeader>
          {regenerateError && <p className="text-sm text-red-400">{regenerateError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={regenerating}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRegenerate} disabled={regenerating} className="gap-2">
              {regenerating && <Loader2 className="h-4 w-4 animate-spin" />}
              Yes, regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
