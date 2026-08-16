import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { profileRepository } from "@/lib/repositories/profile-repository";
import { leadRepository, type LeadRow } from "@/lib/repositories/lead-repository";
import { Badge } from "@/components/ui/badge";
import { ScanForm } from "@/components/lead-hunter/scan-form";

/**
 * Lead Hunter — "Today's Opportunities" (CTO Lead Hunter directive §8).
 * Server component: fetches real leads through lib/repositories/lead-
 * repository.ts, already ranked by opportunity_score. Deliberately plain —
 * directive §15: visual polish comes after the workflow works. Real
 * mission-state-style progress (§11) and a proper Lead Detail view (§9)
 * are named, disclosed Phase 2 scope, not built here.
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

  const candidates = leads.filter((l) => l.status === "candidate");
  const rejected = leads.filter((l) => l.status === "rejected");

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

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Today&apos;s Opportunities ({candidates.length})</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No qualified candidates yet — run a scan above. A real scan takes a few minutes (real geocoding + real per-candidate site crawls).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
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
                  {candidates.map((lead) => (
                    <LeadRowView key={lead.id} lead={lead} />
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

function LeadRowView({ lead }: { lead: LeadRow }) {
  const contact = (lead.contact_evidence as { phones?: string[]; emails?: string[] } | null) ?? null;
  const weaknesses = (lead.main_weaknesses as string[] | null) ?? [];

  return (
    <tr className="border-b border-border/60">
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
