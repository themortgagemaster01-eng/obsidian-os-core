import Link from "next/link";
import { ArrowUpRight, Rocket } from "lucide-react";

import type { MissionRow } from "@/lib/repositories/mission-repository";
import { sortMissionsForReview } from "@/lib/services/mission-service";
import { Card, CardContent } from "@/components/ui/card";
import { StateBadge } from "@/components/mission-control/state-badge";
import { cn } from "@/lib/utils";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface MissionListProps {
  missions: MissionRow[];
  /** Mission ids with a real, renderable Design Preview — see computeMissionsWithPreview(). */
  missionsWithPreview?: ReadonlySet<string>;
}

/** Renders the list of missions, or an honest empty state when there are none. */
export function MissionList({ missions, missionsWithPreview = new Set() }: MissionListProps) {
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

  const sortedMissions = sortMissionsForReview(missions);

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {sortedMissions.map((mission) => {
            const needsReview = mission.state === "reviewing";
            const hasPreview = missionsWithPreview.has(mission.id);

            return (
              <li
                key={mission.id}
                className={cn(
                  "flex items-center justify-between gap-4 px-6 py-4 transition-colors duration-200 ease-in-out hover:bg-panel-hover",
                  needsReview && "border-l-2 border-l-amber-400 bg-amber-500/[0.04]"
                )}
              >
                <Link href={`/missions/${mission.id}`} className="min-w-0 flex-1">
                  {needsReview && (
                    <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                      Needs your review
                    </p>
                  )}
                  <p className="truncate text-sm font-medium text-foreground">
                    {mission.business_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {mission.website_url}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-4">
                  {hasPreview && (
                    <Link
                      href={`/missions/${mission.id}/preview`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-foreground transition-colors duration-200 ease-in-out hover:underline"
                    >
                      View Preview
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(mission.created_at)}
                  </span>
                  <StateBadge state={mission.state} />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
