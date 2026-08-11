import { createClient } from "@/lib/supabase/server";
import {
  computeMissionControlStats,
  computeMissionsWithPreview,
  computeProductionLineCounts,
  listMissionsForOrganization,
} from "@/lib/services/mission-service";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import { MissionList } from "@/components/mission-control/mission-list";
import { NewMissionDialog } from "@/components/mission-control/new-mission-dialog";
import { ProductionLine } from "@/components/mission-control/production-line";
import { SignOutButton } from "@/components/mission-control/sign-out-button";
import { profileRepository } from "@/lib/repositories/profile-repository";

/**
 * Mission Control — the authenticated home. Server component: fetches real
 * data through lib/services/mission-service.ts (which goes through the
 * mission repository). No direct Supabase calls happen here.
 */
export default async function MissionControlPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // middleware.ts already guards this route, but guard again defensively
  // for direct server-side rendering / type-narrowing.
  if (!user) {
    return null;
  }

  const profile = await profileRepository.findById(supabase, user.id);
  const organizationId = profile?.default_organization_id;

  // Every user gets a default organization at signup (see
  // handle_new_user() in supabase/migrations/0002_organizations.sql), so
  // this should never be null in practice — guarded defensively.
  const missions = organizationId
    ? await listMissionsForOrganization(supabase, organizationId)
    : [];
  const completedDesigns = organizationId
    ? await websiteDesignRepository.listCompletedByOrganization(supabase, organizationId)
    : [];
  const missionsWithPreview = computeMissionsWithPreview(completedDesigns);
  const stats = computeMissionControlStats(missions, missionsWithPreview);
  const lineCounts = computeProductionLineCounts(missions);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container flex flex-col gap-6 py-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Obsidian OS
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              Mission Control
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Signed in as {user.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <NewMissionDialog />
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="container space-y-10 py-10">
        <section aria-labelledby="pipeline-heading">
          <h2 id="pipeline-heading" className="sr-only">
            Production pipeline
          </h2>
          <ProductionLine counts={lineCounts} previewReady={stats.previewReady} />
        </section>

        <section className="space-y-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Missions
          </h2>
          <MissionList missions={missions} missionsWithPreview={missionsWithPreview} />
        </section>
      </div>
    </main>
  );
}
