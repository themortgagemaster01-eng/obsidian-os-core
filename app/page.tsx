import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Globe,
  Mail,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { computeMissionControlStats, listMissionsForOwner } from "@/lib/services/mission-service";
import { StatCard } from "@/components/mission-control/stat-card";
import { MissionList } from "@/components/mission-control/mission-list";
import { NewMissionDialog } from "@/components/mission-control/new-mission-dialog";
import { SignOutButton } from "@/components/mission-control/sign-out-button";

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

  const missions = await listMissionsForOwner(supabase, user.id);
  const stats = computeMissionControlStats(missions);

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
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Running Missions" value={stats.runningMissions} icon={Activity} />
          <StatCard label="Completed Today" value={stats.completedToday} icon={CheckCircle2} />
          <StatCard label="Waiting Approval" value={stats.waitingApproval} icon={Clock} />
          <StatCard
            label="Revenue Pipeline"
            value="$0"
            icon={DollarSign}
            caption="Coming in a future sprint"
          />
          <StatCard
            label="Meetings Scheduled"
            value="0"
            icon={CalendarClock}
            caption="Coming in a future sprint"
          />
          <StatCard
            label="Proposal Queue"
            value="0"
            icon={FileText}
            caption="Coming in a future sprint"
          />
          <StatCard
            label="Draft Emails"
            value="0"
            icon={Mail}
            caption="Coming in a future sprint"
          />
          <StatCard
            label="Website Builds"
            value="0"
            icon={Globe}
            caption="Coming in a future sprint"
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">Missions</h2>
          <MissionList missions={missions} />
        </section>
      </div>
    </main>
  );
}
