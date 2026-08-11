import { Activity, CheckCircle2, Clock, Eye, ShieldCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  computeMissionControlStats,
  computeMissionsWithPreview,
  listMissionsForOrganization,
} from "@/lib/services/mission-service";
import { websiteDesignRepository } from "@/lib/repositories/website-design-repository";
import { StatCard } from "@/components/mission-control/stat-card";
import { MissionList } from "@/components/mission-control/mission-list";
import { NewMissionDialog } from "@/components/mission-control/new-mission-dialog";
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

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container flex items-center justify-between py-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Mission Control
            </h1>
            <p className="text-sm text-muted-foreground">
              Signed in as {user.email}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <NewMissionDialog />
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="container space-y-8 py-8">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Active Missions" value={stats.runningMissions} icon={Activity} />
          <StatCard label="Waiting Approval" value={stats.waitingApproval} icon={Clock} />
          <StatCard label="QA Ready" value={stats.qaReady} icon={ShieldCheck} />
          <StatCard label="Preview Ready" value={stats.previewReady} icon={Eye} />
          <StatCard label="Completed Today" value={stats.completedToday} icon={CheckCircle2} />
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">Missions</h2>
          <MissionList missions={missions} missionsWithPreview={missionsWithPreview} />
        </section>
      </div>
    </main>
  );
}
