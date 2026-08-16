import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { leadRepository } from "@/lib/repositories/lead-repository";
import { buildBusinessIntelligenceProfile } from "@/lib/services/business-intelligence-service";
import { Badge } from "@/components/ui/badge";
import { LaunchMakeoverButton } from "@/components/lead-hunter/launch-makeover-button";

interface PageParams {
  params: { id: string };
}

const MAKEOVER_POTENTIAL_LABEL: Record<string, string> = {
  very_high: "Very High",
  high: "High",
  medium: "Medium",
  low: "Low",
  reject: "Reject",
};

const MAKEOVER_POTENTIAL_VARIANT: Record<string, "success" | "warning" | "outline" | "destructive"> = {
  very_high: "success",
  high: "success",
  medium: "warning",
  low: "outline",
  reject: "destructive",
};

/**
 * Lead Detail (CTO Phase 2 directive §5) — Business Overview, all four
 * scores, categorized Website Analysis, a real evidence-cited "why this is
 * an opportunity" explanation, the recommended strategy, and available
 * assets, ending in the Launch Makeover action. Server Component: builds
 * lib/services/business-intelligence-service.ts's read-model profile
 * directly from the already-persisted lead row (RLS-scoped findById doubles
 * as the authorization check, same precedent as app/missions/[id]/page.tsx).
 * Deliberately plain — Phase 2 priority is functional correctness, not
 * visual polish.
 */
export default async function LeadDetailPage({ params }: PageParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const lead = await leadRepository.findById(supabase, params.id);
  if (!lead) {
    notFound();
  }

  const profile = buildBusinessIntelligenceProfile(lead);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container flex flex-col gap-3 py-6">
          <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 ease-in-out hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Lead Hunter
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{profile.businessName}</h1>
            {lead.status === "promoted" && <Badge variant="success">Promoted</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {profile.industry ?? "Industry unknown"} · {profile.location ?? "Location unknown"}
            {profile.websiteUrl && (
              <>
                {" · "}
                <a href={profile.websiteUrl} target="_blank" rel="noreferrer" className="underline">
                  {profile.websiteUrl}
                </a>
              </>
            )}
          </p>
        </div>
      </header>

      <div className="container flex max-w-3xl flex-col gap-8 py-8">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Business Overview</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="text-foreground">
              {profile.phoneDisplay ? <a href={`tel:${profile.phoneHref}`} className="underline">{profile.phoneDisplay}</a> : "—"}
            </dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="text-foreground">{profile.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Address</dt>
            <dd className="text-foreground">{profile.address ?? "—"}</dd>
            <dt className="text-muted-foreground">Hours</dt>
            <dd className="text-foreground">{profile.hours ?? "—"}</dd>
          </dl>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Scores</h2>
          <div className="flex flex-wrap gap-4">
            <ScoreTile label="Website" value={profile.websiteScore} />
            <ScoreTile label="Opportunity" value={profile.opportunityScore} />
            <ScoreTile label="Confidence" value={profile.confidenceScore} />
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase text-muted-foreground">Makeover Potential</span>
              <Badge variant={profile.makeoverPotential ? MAKEOVER_POTENTIAL_VARIANT[profile.makeoverPotential] : "outline"}>
                {profile.makeoverPotential ? MAKEOVER_POTENTIAL_LABEL[profile.makeoverPotential] : "—"}
              </Badge>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Why This Business Is An Opportunity</h2>
          {profile.makeoverPotential === "reject" ? (
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              {profile.opportunityReasons.map((reason, i) => (
                <p key={i}>{reason}</p>
              ))}
            </div>
          ) : profile.opportunityReasons.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-foreground">
              {profile.opportunityReasons.map((reason, i) => (
                <li key={i}>✓ {reason}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{profile.whyOpportunity}</p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Website Analysis</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <WeaknessColumn label="Design" items={profile.weaknesses.design} notAssessed={profile.notYetAssessed.includes("design")} />
            <WeaknessColumn label="Mobile" items={profile.weaknesses.mobile} notAssessed={profile.notYetAssessed.includes("mobile")} />
            <WeaknessColumn label="SEO" items={profile.weaknesses.seo} />
            <WeaknessColumn label="Performance" items={profile.weaknesses.performance} />
            <WeaknessColumn label="Conversion" items={profile.weaknesses.conversion} />
            <WeaknessColumn label="Trust" items={profile.weaknesses.trust} />
          </div>
          {profile.trustSignals.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-xs uppercase text-muted-foreground">Real trust signals found</h3>
              <ul className="flex flex-col gap-0.5 text-sm text-foreground">
                {profile.trustSignals.map((s, i) => (
                  <li key={i}>✓ {s}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Recommended Strategy</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Hero pattern</dt>
              <dd className="text-foreground">{profile.recommendedHeroPattern ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Visual strategy</dt>
              <dd className="text-foreground">{profile.recommendedVisualStrategy ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Primary conversion goal</dt>
              <dd className="text-foreground">{profile.recommendedConversionGoal ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Available Assets</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Real photography</dt>
            <dd className="text-foreground">{profile.availableImages.length} image{profile.availableImages.length === 1 ? "" : "s"}</dd>
            <dt className="text-muted-foreground">Services / offerings</dt>
            <dd className="text-foreground">{profile.services.length} captured</dd>
            <dt className="text-muted-foreground">Reviews</dt>
            <dd className="text-foreground">{profile.reviewSignals?.count ?? profile.reviewSignals?.averageRating ?? "—"}</dd>
            <dt className="text-muted-foreground">Video</dt>
            <dd className="text-foreground">Not yet captured by this crawl</dd>
          </dl>
        </section>

        <section>
          {lead.status === "promoted" && lead.mission_id ? (
            <Link href={`/missions/${lead.mission_id}`} className="text-sm text-foreground underline">
              View this lead&apos;s mission →
            </Link>
          ) : lead.status === "candidate" ? (
            <LaunchMakeoverButton leadId={lead.id} />
          ) : (
            <p className="text-sm text-muted-foreground">This lead is &quot;{lead.status}&quot; — only a qualified candidate can be launched into a makeover.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function ScoreTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <Badge variant={typeof value === "number" && value >= 50 ? "success" : "outline"}>{value ?? "—"}</Badge>
    </div>
  );
}

function WeaknessColumn({ label, items, notAssessed }: { label: string; items: string[]; notAssessed?: boolean }) {
  return (
    <div>
      <h3 className="mb-1 text-xs uppercase text-muted-foreground">{label}</h3>
      {notAssessed ? (
        <p className="text-xs text-muted-foreground">Not yet assessed — full analysis runs after this lead is promoted to a mission.</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No weaknesses found.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-foreground">
          {items.map((item, i) => (
            <li key={i}>· {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
