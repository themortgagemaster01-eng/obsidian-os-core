import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { profileRepository } from "@/lib/repositories/profile-repository";
import { leadRepository, type LeadRow } from "@/lib/repositories/lead-repository";
import { leadScanRepository } from "@/lib/repositories/lead-scan-repository";
import { rankLeads } from "@/lib/services/lead-scoring-service";
import { Badge } from "@/components/ui/badge";
import { ScanForm } from "@/components/lead-hunter/scan-form";

/**
 * Lead Hunter — "Today's Top Opportunities" (CTO Lead Hunter directive §8,
 * extended by the Phase 3 Opportunity Intelligence directive). Server
 * component: fetches real leads through lib/repositories/lead-repository.ts,
 * then applies Rank (lib/services/lead-scoring-service.ts::rankLeads) as its
 * own explicit step — opportunity first, confidence as the tie-break — per
 * the Phase 3 directive's "Rank is a distinct, identifiable pipeline stage,
 * not implicit." Deliberately plain — directive §15: visual polish comes
 * after the workflow works.
 */
export default async function LeadHunterPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const profile = await profileRepository.findById(supabase, user.id);
  const organizationId = profile?.default_organization_id;
  const leads = organizationId ? await leadRepository.listByOrganization(supabase, organizationId) : [];
  const latestScan = organizationId ? await leadScanRepository.findLatestByOrganization(supabase, organizationId) : null;

  const rejected = leads.filter((l) => l.status === "rejected");
  // Rank: an explicit step, not an implicit database ORDER BY — highest
  // opportunity first, confidence as the tie-break (CTO Phase 3 directive).
  const candidates = rankLeads(
    leads
      .filter((l) => l.status === "candidate")
      .map((lead) => ({ id: lead.id, opportunityScore: lead.opportunity_score, confidenceScore: lead.confidence_score, lead }))
  ).map((ranked) => ranked.lead);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container flex flex-col gap-3 py-6">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 ease-in-out hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Mission Control
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Lead Hunter</h1>
          <p className="text-sm text-muted-foreground">
            Real businesses discovered, qualified, and ranked by opportunity — not the first five results, the best five out of a real scanned pool.
          </p>
        </div>
      </header>

      <div className="container flex flex-col gap-8 py-8">
        <ScanForm />

        {latestScan && (
          <section className="rounded-md border border-border p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">Last Scan Funnel</h2>
            {latestScan.status === "running" && <p className="text-sm text-muted-foreground">Scan for &quot;{latestScan.location}&quot; is still running — funnel counts will appear once it completes.</p>}
            {latestScan.status === "failed" && <p className="text-sm text-destructive">Scan for &quot;{latestScan.location}&quot; failed: {latestScan.error_message}</p>}
            {latestScan.status === "complete" && (
              <p className="text-sm text-foreground">
                {latestScan.discovered_count} businesses scanned → {latestScan.qualified_count} usable websites → {latestScan.meaningful_opportunity_count} meaningful website opportunities → {latestScan.high_confidence_count} high-confidence prospects → {latestScan.queued_count} selected for today&apos;s queue
              </p>
            )}
          </section>
        )}

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Today&apos;s Top Opportunities ({candidates.length})</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No qualified candidates yet — run a scan above. A real scan takes a few minutes (real geocoding + real per-candidate site crawls).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4">#</th>
                    <th className="py-2 pr-4">Business</th>
                    <th className="py-2 pr-4">Industry</th>
                    <th className="py-2 pr-4">Location</th>
                    <th className="py-2 pr-4">Website Score</th>
                    <th className="py-2 pr-4">Opportunity</th>
                    <th className="py-2 pr-4">Confidence</th>
                    <th className="py-2 pr-4">Makeover Potential</th>
                    <th className="py-2 pr-4">Main Weakness</th>
                    <th className="py-2 pr-4">Hero Pattern</th>
                    <th className="py-2 pr-4">Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((lead, index) => (
                    <LeadRowView key={lead.id} lead={lead} rank={index + 1} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {rejected.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">Rejected this scan ({rejected.length})</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Real evidence the scan worked, not silently dropped — each was found, evaluated, and honestly ruled out.
            </p>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {rejected.map((lead) => (
                <li key={lead.id}>
                  {lead.business_name} — {lead.rejection_reason}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

const MAKEOVER_POTENTIAL_LABEL: Record<string, string> = {
  very_high: "Very High",
  high: "High",
  medium: "Medium",
  low: "Low",
  reject: "Reject",
};

function LeadRowView({ lead, rank }: { lead: LeadRow; rank: number }) {
  const contact = (lead.contact_evidence as { phones?: string[]; emails?: string[] } | null) ?? null;
  const weaknesses = (lead.main_weaknesses as string[] | null) ?? [];

  return (
    <tr className="border-b border-border/60">
      <td className="py-2 pr-4 text-muted-foreground">{String(rank).padStart(2, "0")}</td>
      <td className="py-2 pr-4 font-medium text-foreground">
        <Link href={`/leads/${lead.id}`} className="hover:underline">
          {lead.business_name}
        </Link>
        {lead.website_url && (
          <a href={lead.website_url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-muted-foreground underline">
            site
          </a>
        )}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">{lead.industry ?? "—"}</td>
      <td className="py-2 pr-4 text-muted-foreground">{lead.location ?? "—"}</td>
      <td className="py-2 pr-4">
        <Badge variant="outline">{lead.website_score ?? "—"}</Badge>
      </td>
      <td className="py-2 pr-4">
        <Badge variant={typeof lead.opportunity_score === "number" && lead.opportunity_score >= 50 ? "success" : "outline"}>
          {lead.opportunity_score ?? "—"}
        </Badge>
      </td>
      <td className="py-2 pr-4 text-muted-foreground">{lead.confidence_score ?? "—"}</td>
      <td className="py-2 pr-4 text-muted-foreground">{lead.makeover_potential ? MAKEOVER_POTENTIAL_LABEL[lead.makeover_potential] : "—"}</td>
      <td className="py-2 pr-4 text-muted-foreground">{weaknesses[0] ?? "—"}</td>
      <td className="py-2 pr-4 text-muted-foreground">{lead.recommended_hero_pattern ?? "—"}</td>
      <td className="py-2 pr-4 text-muted-foreground">{contact?.phones?.[0] ?? contact?.emails?.[0] ?? "—"}</td>
    </tr>
  );
}
