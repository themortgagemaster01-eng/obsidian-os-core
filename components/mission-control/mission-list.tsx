import { Rocket } from "lucide-react";

import type { MissionRow } from "@/lib/repositories/mission-repository";
import { Card, CardContent } from "@/components/ui/card";
import { StateBadge } from "@/components/mission-control/state-badge";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Renders the list of missions, or an honest empty state when there are none. */
export function MissionList({ missions }: { missions: MissionRow[] }) {
  if (missions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
            <Rocket className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No missions yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start your first one to begin building the pipeline.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {missions.map((mission) => (
            <li
              key={mission.id}
              className="flex items-center justify-between gap-4 px-6 py-4 transition-colors duration-200 ease-in-out hover:bg-panel-hover"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {mission.business_name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {mission.website_url}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span className="text-xs text-muted-foreground">
                  {formatDate(mission.created_at)}
                </span>
                <StateBadge state={mission.state} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
