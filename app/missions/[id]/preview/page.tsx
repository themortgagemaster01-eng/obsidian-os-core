import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import { websiteAnalysisRepository } from "@/lib/repositories/website-analysis-repository";
import type { Wireframe, ComponentNode } from "@/lib/services/design-generation-service";
import type { RefinedDesign } from "@/lib/services/design-refinement-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import { resolveScreenshotUrl } from "@/lib/presentation/resolve-screenshot-url";
import { DesignPreview } from "@/components/design-preview/design-preview";
import { Badge } from "@/components/ui/badge";

interface PageParams {
  params: { id: string };
  searchParams: { designId?: string };
}

/**
 * Design Preview route (rendering-capability addition ahead of Sprint 4
 * Phase 4 — see docs/SPRINT_STATUS.md). Turns a real, persisted
 * `website_designs` row into an actual rendered Next.js page: the seam
 * docs/SPRINT_4_PHASE_4_DESIGN_REVIEW.md §3 named as missing ("nothing in
 * this codebase today produces an actual rendered page"), so a future
 * design-qa-service.ts has a real URL to point Mobile/Accessibility/
 * Performance QA's rendered checks at.
 *
 * Server Component, same pattern as app/missions/[id]/page.tsx: the
 * standard RLS-scoped `createClient()`, no service-role client, no bypass.
 * `missionRepository.findById` doubles as the authorization check exactly
 * as it does on the mission detail page — a design belonging to a mission
 * outside the caller's organization is invisible here for the same reason
 * it's invisible everywhere else in this app (`is_org_member(organization_id)`
 * RLS on both `missions` and `website_designs`).
 *
 * Renders the Wireframe/ComponentNode/RefinedDesign JSON through
 * components/design-preview/design-preview.tsx's typed renderer — never an
 * LLM-generated HTML string, never a hardcoded sample. `?designId=` selects
 * a specific run; omitted, this shows the mission's latest.
 */
export default async function DesignPreviewPage({ params, searchParams }: PageParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const mission = await missionRepository.findById(supabase, params.id);
  if (!mission) {
    notFound();
  }

  const design = searchParams.designId
    ? await websiteDesignRepository.findById(supabase, searchParams.designId)
    : await websiteDesignRepository.findLatestByMission(supabase, mission.id);

  if (!design || design.mission_id !== mission.id) {
    notFound();
  }

  const brief = await designBriefRepository.findById(supabase, design.design_brief_id);

  // Real, already-captured evidence, resolved to a fresh signed URL at
  // request time — never persisted into website_designs.components, since
  // the signed URL itself expires in an hour (resolve-screenshot-url.ts)
  // and the wireframe/component JSON is meant to remain valid indefinitely.
  //
  // Deliberately the above-fold capture, not the full-page one the
  // Opportunity Report shows: lib/adapters/screenshot-adapter.ts has always
  // captured both, but only full-page was ever persisted. Using the
  // full-page image as a hero background produced a real, measured
  // Lighthouse performance regression (a full-page PNG runs ~5x the byte
  // size of a single-viewport one) — confirmed via a real Design QA run
  // during the Design Generation Richness Pass. The above-fold capture is
  // the correct asset for a hero-sized image; it just needed persisting
  // (supabase/migrations/0016_above_fold_screenshot.sql).
  const analysis = await websiteAnalysisRepository.findLatestByMission(supabase, mission.id);
  const heroImageUrl = await resolveScreenshotUrl(supabase, analysis?.above_fold_screenshot_url ?? null);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container max-w-5xl space-y-3 py-6">
          <Link
            href={`/missions/${mission.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 ease-in-out hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {mission.business_name}
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Design Preview</h1>
            <Badge variant={design.status === "complete" ? "success" : "outline"}>{design.status}</Badge>
          </div>
        </div>
      </header>

      <PreviewBody design={design} brief={brief} businessName={mission.business_name} heroImageUrl={heroImageUrl} />
    </main>
  );
}

function PreviewBody({
  design,
  brief,
  businessName,
  heroImageUrl,
}: {
  design: NonNullable<Awaited<ReturnType<typeof websiteDesignRepository.findById>>>;
  brief: Awaited<ReturnType<typeof designBriefRepository.findById>>;
  businessName: string;
  heroImageUrl: string | null;
}) {
  if (design.status !== "complete" || !design.wireframe || !design.components || !design.refined_design) {
    return (
      <div className="container max-w-5xl py-10">
        <p className="text-sm text-muted-foreground">
          This design run is <span className="font-medium text-foreground">{design.status}</span> — nothing to render
          yet. {design.error_message && <span>Error: {design.error_message}</span>}
        </p>
      </div>
    );
  }

  const wireframe = design.wireframe as unknown as Wireframe;
  const components = design.components as unknown as ComponentNode[];
  const refinedDesign = design.refined_design as unknown as RefinedDesign;
  const designMemory = (brief?.design_memory as unknown as DesignMemory | null) ?? null;

  return (
    <div className="border-t border-border">
      <DesignPreview
        businessName={businessName}
        wireframe={wireframe}
        components={components}
        refinedDesign={refinedDesign}
        designMemory={designMemory}
        heroImageUrl={heroImageUrl}
      />
    </div>
  );
}
