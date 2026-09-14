"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, CheckCircle2, XCircle, LayoutTemplate } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DesignBriefView } from "@/components/mission-detail/design-brief-view";
import { QaReportView } from "@/components/mission-detail/qa-report-view";
import { BeforeAfterPanel } from "@/components/mission-detail/before-after-panel";
import { RegenerateForComparison } from "@/components/mission-detail/regenerate-for-comparison";
import type { DesignBriefRow } from "@/lib/repositories/design-brief-repository";
import type { WebsiteDesignRow } from "@/lib/repositories/website-design-repository";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { DesignMemory, SelfCritique } from "@/lib/services/design-intelligence-service";
import type { DesignQaReport } from "@/lib/services/design-qa-service";
import type { MissionState } from "@/lib/workflow/mission-state";
import { isDesignSnapshotStale } from "@/lib/services/mission-service";

const POLL_INTERVAL_MS = 3000;

/**
 * Mirrors VALID_DESIGN_BRIEF_TRIGGER_STATES in
 * app/api/missions/[id]/design-brief/route.ts (Fix #11's guard) — every
 * state NOT in that route's own allow-list. Duplicated rather than
 * imported since that route isn't a shared module; kept as the exact
 * complement so RegenerateForComparison renders precisely when a normal,
 * unforced POST .../design-brief would be rejected by the guard it bypasses.
 */
const PAST_APPROVAL_GATE_STATES: readonly MissionState[] = [
  "designing",
  "qa",
  "proposal",
  "email",
  "approval",
  "sent",
  "archived",
];

/**
 * Founder Mission Experience (Product Surface Pass, Priorities 1–3). Client
 * orchestrator covering the whole Design Brief -> Approval -> Generation ->
 * Refinement -> QA sequence the founder needs to operate a mission without
 * ever making a raw API call. Every action here calls an existing,
 * unmodified backend route (POST design-brief / approve-design-brief /
 * reject / generate-design / qa) — this component sequences and displays
 * those calls, it does not implement a parallel approval or generation
 * mechanism.
 *
 * Approval auto-chains into Generation and QA (each still its own real,
 * separately-persisted, separately-displayed call) so the founder isn't
 * required to click three more buttons for steps that always follow
 * approval — but every phase still gets its own visible status line, per
 * the explicit instruction to show generation/refinement/QA status
 * distinctly rather than one opaque spinner.
 */
export function DesignBriefPanel({
  missionId,
  analysisComplete,
  initialMissionState,
  initialDesignBrief,
  initialWebsiteDesign,
  originalScreenshotUrl,
  initialPreviewScreenshotDesktopUrl,
  initialPreviewScreenshotMobileUrl,
}: {
  missionId: string;
  analysisComplete: boolean;
  initialMissionState: MissionState;
  initialDesignBrief: DesignBriefRow | null;
  initialWebsiteDesign: WebsiteDesignRow | null;
  originalScreenshotUrl: string | null;
  initialPreviewScreenshotDesktopUrl: string | null;
  initialPreviewScreenshotMobileUrl: string | null;
}) {
  const router = useRouter();
  const [missionState, setMissionState] = useState(initialMissionState);
  const [designBrief, setDesignBrief] = useState(initialDesignBrief);
  const [websiteDesign, setWebsiteDesign] = useState(initialWebsiteDesign);
  const [starting, setStarting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const generationTriggeredRef = useRef(false);
  const qaTriggeredRef = useRef(false);
  const [previewScreenshotDesktopUrl, setPreviewScreenshotDesktopUrl] = useState(initialPreviewScreenshotDesktopUrl);
  const [previewScreenshotMobileUrl, setPreviewScreenshotMobileUrl] = useState(initialPreviewScreenshotMobileUrl);
  const [captureTriggered, setCaptureTriggered] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const briefInFlight = designBrief?.status === "pending" || designBrief?.status === "running";
  const designInFlight = websiteDesign?.status === "pending" || websiteDesign?.status === "running";
  const awaitingReview = designBrief?.status === "complete" && missionState === "reviewing";

  // Poll the Design Brief while it's generating.
  useEffect(() => {
    if (!briefInFlight) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/missions/${missionId}/design-brief`);
      if (!res.ok) return;
      const body = (await res.json()) as { designBrief: DesignBriefRow | null };
      setDesignBrief(body.designBrief);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [missionId, briefInFlight]);

  // ==========================================================================
  // Stale-snapshot reconcile (preview-refresh bug, 2026-09-14).
  //
  // Real reported symptom (Robert, Joseph J. Smith Funeral Home Inc.): "It
  // wants me to refresh for the generate button to come up when I click on
  // preview." Confirmed against that mission's real data — the pipeline
  // genuinely succeeded end to end (WebsiteDesignReady 6 sections ->
  // DesignQaComplete PASS, mission at `qa`), but its website_designs row had
  // preview_screenshot_desktop_path: null with NO error: the Capture button
  // (components/mission-detail/before-after-panel.tsx, rendered only once
  // this panel's own client state carries a qa_result) was never reachable,
  // so capture was never triggered at all.
  //
  // Root cause, and why a manual refresh "fixed" it: every value here is
  // seeded ONCE from server props into useState, and the only thing that
  // ever refreshes them is the poll below — which is itself gated on the
  // client ALREADY believing something is in flight. Mount with a snapshot
  // where websiteDesign is null (designInFlight false, needsQaPoll false,
  // captureInFlight false) and the poll never starts, so the panel can only
  // ever go stale, never self-correct. Next's App Router client Router Cache
  // makes that the normal case rather than an edge case: navigating to the
  // preview route and back re-mounts this panel from a CACHED RSC payload
  // rendered before generation/QA finished. A hard refresh is the only thing
  // that bypasses that cache today — which is exactly the workaround Robert
  // found. Not specific to no-website missions; this affects every mission.
  //
  // Fix: reconcile with the server exactly once on mount, unconditionally,
  // regardless of what the (possibly cached) snapshot claimed — then let the
  // existing poll take over from real, current state. router.refresh() is
  // also issued when the reconcile proves the snapshot WAS stale, so the
  // server-rendered parts of the page (MissionHeader's state badge, the
  // Opportunity Report panel) and the Router Cache entry update too rather
  // than continuing to disagree with this panel.
  // ==========================================================================
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/missions/${missionId}/generate-design`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          websiteDesign: WebsiteDesignRow | null;
          previewScreenshotDesktopUrl: string | null;
          previewScreenshotMobileUrl: string | null;
        };
        if (cancelled) return;
        setWebsiteDesign(body.websiteDesign);
        setPreviewScreenshotDesktopUrl(body.previewScreenshotDesktopUrl);
        setPreviewScreenshotMobileUrl(body.previewScreenshotMobileUrl);
        if (isDesignSnapshotStale(initialWebsiteDesign, body.websiteDesign)) {
          // Server-rendered siblings (and the cached RSC payload this mount
          // may have come from) are stale too — re-run them. Safe against a
          // refresh loop: reconciledRef already prevents this effect running
          // again, and useState ignores the new props on re-render.
          router.refresh();
        }
      } catch {
        // Network hiccup on mount is not fatal — the poll below is the retry
        // path, and a settled mission simply keeps the snapshot it had.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId, initialWebsiteDesign, router]);

  // Poll Generation/Refinement/QA/Preview-Capture while the design run is in
  // flight, while QA hasn't been triggered/finished yet, or while a real
  // preview screenshot capture is in flight (Phase 4) — one endpoint, one
  // poll, since GET .../generate-design now also resolves the preview
  // screenshot signed URLs alongside the raw website_designs row.
  const qaComplete = !!websiteDesign?.qa_result;
  const needsQaPoll = websiteDesign?.status === "complete" && !qaComplete;
  const captureInFlight = captureTriggered && !previewScreenshotDesktopUrl && !websiteDesign?.preview_screenshot_error;
  useEffect(() => {
    if (!designInFlight && !needsQaPoll && !captureInFlight) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/missions/${missionId}/generate-design`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        websiteDesign: WebsiteDesignRow | null;
        previewScreenshotDesktopUrl: string | null;
        previewScreenshotMobileUrl: string | null;
      };
      setWebsiteDesign(body.websiteDesign);
      setPreviewScreenshotDesktopUrl(body.previewScreenshotDesktopUrl);
      setPreviewScreenshotMobileUrl(body.previewScreenshotMobileUrl);
      if (body.previewScreenshotDesktopUrl || body.websiteDesign?.preview_screenshot_error) {
        setCapturing(false);
        setCaptureError(body.websiteDesign?.preview_screenshot_error ?? null);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [missionId, designInFlight, needsQaPoll, captureInFlight]);

  async function handleCapturePreview() {
    setCapturing(true);
    setCaptureError(null);
    setCaptureTriggered(true);
    try {
      const res = await fetch(`/api/missions/${missionId}/capture-preview`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to start preview screenshot capture");
      // Polling (above) picks up the real result once the background run finishes.
    } catch (err) {
      setCapturing(false);
      setCaptureError(err instanceof Error ? err.message : "Failed to start preview screenshot capture");
    }
  }

  // Auto-chain: once approved and generation completes, trigger QA exactly once.
  useEffect(() => {
    if (websiteDesign?.status === "complete" && !websiteDesign.qa_result && !qaTriggeredRef.current) {
      qaTriggeredRef.current = true;
      fetch(`/api/missions/${missionId}/qa`, { method: "POST" }).catch(() => {
        qaTriggeredRef.current = false;
      });
    }
  }, [missionId, websiteDesign]);

  async function handleGenerateBrief() {
    setStarting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/design-brief`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { designBrief?: DesignBriefRow; error?: string } | null;
      if (!res.ok || !body?.designBrief) throw new Error(body?.error ?? "Failed to start Design Brief generation");
      setDesignBrief(body.designBrief);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to start Design Brief generation");
    } finally {
      setStarting(false);
    }
  }

  async function handleApprove() {
    setReviewing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/approve-design-brief`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { designBrief?: DesignBriefRow; error?: string } | null;
      if (!res.ok || !body?.designBrief) throw new Error(body?.error ?? "Failed to approve Design Brief");
      setDesignBrief(body.designBrief);
      setMissionState("designing");
      if (!generationTriggeredRef.current) {
        generationTriggeredRef.current = true;
        const genRes = await fetch(`/api/missions/${missionId}/generate-design`, { method: "POST" });
        const genBody = (await genRes.json().catch(() => null)) as { websiteDesign?: WebsiteDesignRow } | null;
        if (genRes.ok && genBody?.websiteDesign) setWebsiteDesign(genBody.websiteDesign);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to approve Design Brief");
    } finally {
      setReviewing(false);
    }
  }

  async function handleReject() {
    setReviewing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to reject mission");
      setMissionState("rejected");
      setShowRejectReason(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reject mission");
    } finally {
      setReviewing(false);
    }
  }

  if (!designBrief) {
    if (!analysisComplete) return null;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No Design Brief yet</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Generate a Design Brief from this mission&apos;s real analysis — real Design Intelligence, grounded in
              the evidence already gathered.
            </p>
          </div>
          {actionError && <p className="text-sm text-red-400">{actionError}</p>}
          <Button onClick={handleGenerateBrief} disabled={starting} className="gap-2">
            {starting && <Loader2 className="h-4 w-4 animate-spin" />}
            Generate Design Brief
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (briefInFlight) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating Design Brief — a real Anthropic call grounded in this mission&apos;s evidence…
        </CardContent>
      </Card>
    );
  }

  if (designBrief.status === "failed") {
    return (
      <Card>
        <CardContent className="space-y-3 py-8">
          <p className="text-sm font-medium text-red-400">Design Brief generation failed</p>
          <p className="text-sm text-muted-foreground">{designBrief.error_message}</p>
          <Button onClick={handleGenerateBrief} disabled={starting} variant="outline" size="sm" className="gap-2">
            {starting && <Loader2 className="h-4 w-4 animate-spin" />}
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!designBrief.brief) {
    return null;
  }

  const brief = designBrief.brief as unknown as DesignBrief;
  const designMemory = (designBrief.design_memory as unknown as DesignMemory | null) ?? null;

  return (
    <div className="space-y-6">
      <DesignBriefView
        brief={brief}
        designMemory={designMemory}
        reasoning={designBrief.reasoning}
        selfCritique={designBrief.self_critique as unknown as SelfCritique | null}
      />

      {missionState === "rejected" && (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-red-400">
            <XCircle className="h-4 w-4" />
            This mission was rejected. No further generation will run.
          </CardContent>
        </Card>
      )}

      {awaitingReview && (
        <Card>
          <CardContent className="space-y-4 py-6">
            <p className="text-sm font-medium text-foreground">What am I approving?</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Approving generates the actual website from this brief — the direction, audience, and evidence above,
              exactly as shown. Nothing customer-facing happens without this step.
            </p>
            {actionError && <p className="text-sm text-red-400">{actionError}</p>}
            <div className="flex items-center gap-3">
              <Button onClick={handleApprove} disabled={reviewing} className="gap-2">
                {reviewing && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve
              </Button>
              <Button
                onClick={() => setShowRejectReason((v) => !v)}
                disabled={reviewing}
                variant="outline"
              >
                Request Changes / Reject
              </Button>
            </div>
            {showRejectReason && (
              <div className="space-y-2">
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="What needs to change? (optional)"
                  className="w-full rounded-md border border-border bg-transparent p-2.5 text-sm text-foreground placeholder:text-muted-foreground"
                  rows={2}
                />
                <Button onClick={handleReject} disabled={reviewing} variant="destructive" size="sm">
                  Confirm Reject
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(missionState === "designing" || missionState === "qa" || websiteDesign) && (
        <GenerationStatus
          missionId={missionId}
          websiteDesign={websiteDesign}
          designInFlight={designInFlight}
          needsQaPoll={needsQaPoll}
          originalScreenshotUrl={originalScreenshotUrl}
          previewScreenshotDesktopUrl={previewScreenshotDesktopUrl}
          captureTriggered={captureTriggered}
          captureError={captureError}
          capturing={capturing}
          onCapture={handleCapturePreview}
        />
      )}

      {PAST_APPROVAL_GATE_STATES.includes(missionState) && <RegenerateForComparison missionId={missionId} />}
    </div>
  );
}

function GenerationStatus({
  missionId,
  websiteDesign,
  designInFlight,
  needsQaPoll,
  originalScreenshotUrl,
  previewScreenshotDesktopUrl,
  captureTriggered,
  captureError,
  capturing,
  onCapture,
}: {
  missionId: string;
  websiteDesign: WebsiteDesignRow | null;
  designInFlight: boolean;
  needsQaPoll: boolean;
  originalScreenshotUrl: string | null;
  previewScreenshotDesktopUrl: string | null;
  captureTriggered: boolean;
  captureError: string | null;
  capturing: boolean;
  onCapture: () => void;
}) {
  if (!websiteDesign) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Starting website generation…
        </CardContent>
      </Card>
    );
  }

  if (designInFlight) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating website structure and refining against real design rules…
        </CardContent>
      </Card>
    );
  }

  if (websiteDesign.status === "failed") {
    return (
      <Card>
        <CardContent className="space-y-2 py-6">
          <p className="text-sm font-medium text-red-400">Generation failed</p>
          <p className="text-sm text-muted-foreground">{websiteDesign.error_message}</p>
        </CardContent>
      </Card>
    );
  }

  const violations = (websiteDesign.refined_design as { violations?: unknown[] } | null)?.violations ?? [];
  const qaResult = websiteDesign.qa_result as unknown as DesignQaReport | null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2">
        <StatusRow
          label="Generation"
          done
          detail={`${(websiteDesign.components as unknown[] | null)?.length ?? 0} sections assembled`}
        />
        <StatusRow
          label="Refinement"
          done
          ok={violations.length === 0}
          detail={violations.length === 0 ? "No violations" : `${violations.length} violation(s) found`}
        />
      </div>

      {needsQaPoll && (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running quality checks — real accessibility scan, real performance measurement, AI-derived review…
          </CardContent>
        </Card>
      )}

      {qaResult && <QaReportView report={qaResult} />}

      {qaResult && (
        <Link
          href={`/missions/${missionId}/preview`}
          className="inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors duration-200 ease-in-out hover:text-muted-foreground"
        >
          <LayoutTemplate className="h-4 w-4" />
          View Preview
        </Link>
      )}

      {qaResult && (
        <BeforeAfterPanel
          missionId={missionId}
          originalScreenshotUrl={originalScreenshotUrl}
          previewScreenshotDesktopUrl={previewScreenshotDesktopUrl}
          captureTriggered={captureTriggered}
          captureError={captureError}
          capturing={capturing}
          onCapture={onCapture}
        />
      )}
    </div>
  );
}

function StatusRow({
  label,
  done,
  ok = true,
  detail,
}: {
  label: string;
  done: boolean;
  ok?: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-panel p-5">
      <div className="flex items-center gap-2.5">
        {done ? (
          <CheckCircle2 className={`h-4 w-4 ${ok ? "text-emerald-400" : "text-amber-400"}`} />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        <p className="text-sm font-medium text-foreground">{label}</p>
      </div>
      <Badge variant={ok ? "success" : "warning"}>{detail}</Badge>
    </div>
  );
}
