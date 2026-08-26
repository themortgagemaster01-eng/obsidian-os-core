"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, LayoutTemplate, CheckCircle2, XCircle, Pencil } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ProposalRow } from "@/lib/repositories/proposal-repository";
import type { ProposalContent } from "@/lib/services/proposal-service";
import type { MissionState } from "@/lib/workflow/mission-state";

/**
 * Phase 8 Founder Approval panel (docs/PHASE_8_PROSPECT_TO_APPROVAL_AUDIT.md).
 * Client orchestrator covering Proposal -> Email Draft -> Founder Review ->
 * Approved/Rejected, the exact "QUALIFIED -> DEMO -> QA -> PROPOSAL -> EMAIL
 * DRAFT -> FOUNDER REVIEW -> APPROVED" sequence, mirroring
 * design-brief-panel.tsx's own established shape: every action here calls
 * an existing or newly-added backend route (POST proposal / POST
 * email-draft / PATCH proposal / POST approve / POST reject) — this
 * component sequences and displays those calls, it does not implement a
 * parallel workflow or a parallel QA experience (the existing QaReportView,
 * rendered by DesignBriefPanel just above this panel on the same page, is
 * reused as-is, never duplicated here).
 *
 * "Prepare for Outreach" auto-chains proposal assembly into email-draft
 * generation (mirroring DesignBriefPanel's own "approval auto-chains into
 * generation" precedent) — the mission lands directly in `approval` state,
 * ready for founder review, in one click.
 */
export function ApprovalPanel({
  missionId,
  initialMissionState,
  initialProposal,
  qaAvailable,
}: {
  missionId: string;
  initialMissionState: MissionState;
  initialProposal: ProposalRow | null;
  /** True once DesignBriefPanel's own qaResult exists — this panel never renders anything before Design QA has actually run. */
  qaAvailable: boolean;
}) {
  const [missionState, setMissionState] = useState(initialMissionState);
  const [proposal, setProposal] = useState(initialProposal);
  const [preparing, setPreparing] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftSubject, setDraftSubject] = useState(initialProposal?.email_subject ?? "");
  const [draftBody, setDraftBody] = useState(initialProposal?.email_body ?? "");

  const relevantStates: MissionState[] = ["qa", "proposal", "email", "approval", "sent"];
  if (!qaAvailable || !relevantStates.includes(missionState)) return null;

  async function handlePrepareForOutreach() {
    setPreparing(true);
    setActionError(null);
    try {
      const proposalRes = await fetch(`/api/missions/${missionId}/proposal`, { method: "POST" });
      const proposalBody = (await proposalRes.json().catch(() => null)) as { proposal?: ProposalRow; error?: string } | null;
      if (!proposalRes.ok || !proposalBody?.proposal) throw new Error(proposalBody?.error ?? "Failed to assemble proposal");
      setProposal(proposalBody.proposal);
      setMissionState("proposal");

      const draftRes = await fetch(`/api/missions/${missionId}/email-draft`, { method: "POST" });
      const draftBodyResult = (await draftRes.json().catch(() => null)) as { proposal?: ProposalRow; error?: string } | null;
      if (!draftRes.ok || !draftBodyResult?.proposal) throw new Error(draftBodyResult?.error ?? "Failed to generate email draft");
      setProposal(draftBodyResult.proposal);
      setDraftSubject(draftBodyResult.proposal.email_subject ?? "");
      setDraftBody(draftBodyResult.proposal.email_body ?? "");
      setMissionState("approval");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to prepare this mission for outreach");
    } finally {
      setPreparing(false);
    }
  }

  async function handleSaveEdits() {
    setActionError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/proposal`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emailSubject: draftSubject, emailBody: draftBody }),
      });
      const body = (await res.json().catch(() => null)) as { proposal?: ProposalRow; error?: string } | null;
      if (!res.ok || !body?.proposal) throw new Error(body?.error ?? "Failed to save edits");
      setProposal(body.proposal);
      setEditing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save edits");
    }
  }

  async function handleApprove() {
    setDeciding(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/approve`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { proposal?: ProposalRow; error?: string } | null;
      if (!res.ok || !body?.proposal) throw new Error(body?.error ?? "Failed to approve mission");
      setProposal(body.proposal);
      setMissionState("sent");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to approve mission");
    } finally {
      setDeciding(false);
    }
  }

  async function handleReject() {
    setDeciding(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/reject`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to reject mission");
      setMissionState("rejected");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reject mission");
    } finally {
      setDeciding(false);
    }
  }

  if (missionState === "qa" || !proposal?.content) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-sm font-medium text-foreground">Ready to prepare this mission for outreach</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Assembles a proposal and email draft from this mission&apos;s own real Opportunity Report, QA result, and
            qualification evidence — no new analysis, deterministic, draft only.
          </p>
          {actionError && <p className="text-sm text-red-400">{actionError}</p>}
          <Button onClick={handlePrepareForOutreach} disabled={preparing} className="gap-2">
            {preparing && <Loader2 className="h-4 w-4 animate-spin" />}
            Prepare for Outreach
          </Button>
        </CardContent>
      </Card>
    );
  }

  const content = proposal.content as unknown as ProposalContent;
  const isDecided = missionState === "sent";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Founder Review</span>
          {isDecided && <Badge variant="success">Approved — outreach ready</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{content.businessName}</p>
          <p className="text-sm text-muted-foreground">{content.websiteUrl}</p>
          <Link
            href={`/missions/${missionId}/preview`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors duration-200 ease-in-out hover:text-muted-foreground"
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            View Generated Demo
          </Link>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">QA Summary</p>
          <Badge variant={content.qaSummary.overallVerdict === "PASS" ? "success" : "warning"}>
            {content.qaSummary.overallVerdict} — {content.qaSummary.passedCategories}/{content.qaSummary.totalCategories} categories passed
          </Badge>
        </div>

        {content.whyQualified.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why This Business Qualified</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {content.whyQualified.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Key Opportunities</p>
          <ul className="space-y-2">
            {content.keyOpportunities.map((opp, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-foreground">{opp.title}</span>
                <span className="text-muted-foreground"> — {opp.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Value Proposition</p>
          <p className="text-sm text-muted-foreground">{content.valueProposition}</p>
        </div>

        <div className="space-y-2 rounded-md border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email Draft (not sent)</p>
            {!isDecided && !editing && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
          {editing ? (
            <div className="space-y-2">
              <input
                className="w-full rounded border border-border bg-transparent p-2 text-sm"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                placeholder="Subject"
              />
              <textarea
                className="h-40 w-full rounded border border-border bg-transparent p-2 text-sm"
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveEdits}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{proposal.email_subject}</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.email_body}</p>
            </div>
          )}
        </div>

        {actionError && <p className="text-sm text-red-400">{actionError}</p>}

        {!isDecided && missionState === "approval" && (
          <div className="flex gap-3">
            <Button onClick={handleApprove} disabled={deciding} className="gap-2">
              {deciding && <Loader2 className="h-4 w-4 animate-spin" />}
              <CheckCircle2 className="h-4 w-4" />
              Approve
            </Button>
            <Button onClick={handleReject} disabled={deciding} variant="destructive" className="gap-2">
              <XCircle className="h-4 w-4" />
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
