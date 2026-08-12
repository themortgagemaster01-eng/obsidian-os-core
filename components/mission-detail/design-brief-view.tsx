import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DesignBrief } from "@/lib/services/design-brief-service";
import type { DesignMemory, SelfCritique } from "@/lib/services/design-intelligence-service";
import type { AnalysisCategory } from "@/lib/services/analysis-types";

const CATEGORY_LABEL: Record<AnalysisCategory, string> = {
  performance: "Page speed",
  accessibility: "Accessibility",
  seo: "Search visibility",
  mobile: "Mobile experience",
  technicalHealth: "Technical health",
};

function humanize(value: string): string {
  return value
    .replace(/-/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Founder-facing Design Brief view (Product Surface Pass, Priority 1). Every
 * field rendered here reads directly from a real, persisted `DesignBrief`
 * (lib/services/design-brief-service.ts) and its companion `DesignMemory` —
 * nothing here is computed, summarized, or invented by this component. The
 * "Primary Action" and "Content Direction" sections read from DesignMemory
 * because that's genuinely where that information lives (design-intelligence-
 * service.ts's own output), not because this view infers them.
 *
 * Deliberately keeps this codebase's real terminology visible (industry
 * bucket, layout family) — this is the Founder's own operational view of
 * what the system decided and why, not the customer-facing preview Priority
 * 3 cleans up separately.
 */
export function DesignBriefView({
  brief,
  designMemory,
  reasoning,
  selfCritique,
}: {
  brief: DesignBrief;
  designMemory: DesignMemory | null;
  reasoning: string | null;
  selfCritique?: SelfCritique | null;
}) {
  return (
    <div className="space-y-6">
      <div className="glass-panel space-y-4 p-8">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Executive Direction</p>
        <p className="text-xl font-medium leading-relaxed tracking-tight text-foreground">{brief.positioning}</p>
        {brief.heroThesis && (
          <div className="border-t border-border pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Hero thesis — why this site belongs to this business
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground">{brief.heroThesis}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2">
        <div className="space-y-2 bg-panel p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Audience</p>
          <p className="text-sm leading-relaxed text-foreground">{brief.targetAudience}</p>
        </div>
        <div className="space-y-2 bg-panel p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primary Action</p>
          {designMemory?.ctaHierarchy?.primary ? (
            <p className="text-sm leading-relaxed text-foreground">{designMemory.ctaHierarchy.primary}</p>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">Not yet determined.</p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Creative Direction</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="navy">{humanize(brief.direction.layoutFamily)}</Badge>
            <Badge variant="outline">{humanize(brief.industryBucket)}</Badge>
            <Badge variant={brief.direction.motionIntensity === "energetic" ? "warning" : "outline"}>
              {humanize(brief.direction.motionIntensity)} motion
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Typographic mood</p>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{brief.direction.typographicMood}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Color direction</p>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{brief.direction.colorDirection}</p>
            </div>
          </div>
          {brief.signatureElement && (
            <div className="border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Signature element</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="navy">{humanize(brief.signatureElement.element)}</Badge>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{brief.signatureElement.justification}</p>
            </div>
          )}
          {brief.contentEmphasis && brief.contentEmphasis.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Content emphasis (ranked)</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {brief.contentEmphasis.map((item, i) => (
                  <Badge key={item} variant="outline">
                    {i + 1}. {humanize(item)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {designMemory && (
        <Card>
          <CardHeader>
            <CardTitle>Content Direction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tone</p>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{designMemory.contentTone}</p>
            </div>
            {designMemory.brandPersonality?.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Brand personality</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {designMemory.brandPersonality.map((trait) => (
                    <Badge key={trait} variant="outline">
                      {trait}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {designMemory.seoPriorities?.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Content priorities</p>
                <ul className="mt-1.5 space-y-1">
                  {designMemory.seoPriorities.map((item, i) => (
                    <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                      — {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Evidence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cited from the real business analysis
            </p>
            <ul className="mt-2 space-y-2">
              {brief.citedInsights.map((citation, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground">
                  <Badge variant="outline" className="mt-0.5 shrink-0">
                    {CATEGORY_LABEL[citation.category]}
                  </Badge>
                  <span className="text-muted-foreground">{citation.statement}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Verified contact evidence
            </p>
            <ContactEvidenceList contactEvidence={brief.contactEvidence} />
          </div>

          {reasoning && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Why this direction
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{reasoning}</p>
            </div>
          )}

          {selfCritique && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Self-critique (AI-derived assessment)
              </p>
              <div className="mt-2 flex items-start gap-2.5">
                <Badge variant={selfCritique.wasRevised ? "warning" : "success"} className="mt-0.5 shrink-0">
                  {selfCritique.wasRevised ? "Revised after critique" : "Passed on first pass"}
                </Badge>
                <span className="text-sm leading-relaxed text-muted-foreground">{selfCritique.reasoning}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ContactEvidenceList({ contactEvidence }: { contactEvidence: DesignBrief["contactEvidence"] }) {
  const rows: { label: string; verified: boolean; value?: string }[] = [
    { label: "Phone", verified: contactEvidence.phones.length > 0, value: contactEvidence.phones[0] },
    { label: "Address", verified: !!contactEvidence.address, value: contactEvidence.address ?? undefined },
    { label: "Hours", verified: !!contactEvidence.hours, value: contactEvidence.hours ?? undefined },
  ];

  return (
    <ul className="mt-2 space-y-1.5">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-2.5 text-sm">
          <Badge variant={row.verified ? "success" : "outline"} className="w-20 shrink-0 justify-center">
            {row.verified ? "Verified" : "Not found"}
          </Badge>
          <span className="text-foreground">{row.label}</span>
          {row.verified && row.value && <span className="text-muted-foreground">— {row.value}</span>}
        </li>
      ))}
    </ul>
  );
}
