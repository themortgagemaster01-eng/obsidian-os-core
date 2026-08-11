import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { MissionRow } from "@/lib/repositories/mission-repository";
import { computeMissionStageTrack, groupMissionsForDisplay } from "@/lib/services/mission-service";
import { StateBadge } from "@/components/mission-control/state-badge";
import { StageTracker } from "@/components/mission-control/stage-tracker";
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

interface MissionRowItemProps {
  mission: MissionRow;
  hasPreview: boolean;
  needsReview: boolean;
}

/** A production-log entry: business name carries the serif signature, everything else stays quiet grotesk. */
function MissionRowItem({ mission, hasPreview, needsReview }: MissionRowItemProps) {
  const track = computeMissionStageTrack(mission, hasPreview);

  return (
    <li
      className={cn(
        "flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        needsReview && "border-l-2 border-l-amber-400/70 pl-4"
      )}
    >
      <Link href={`/missions/${mission.id}`} className="group min-w-0 flex-1">
        <p className="truncate font-serif text-xl font-medium text-foreground transition-colors duration-200 ease-in-out group-hover:text-foreground/75 sm:text-2xl">
          {mission.business_name}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{mission.website_url}</p>
        {track && (
          <div className="mt-2.5">
            <StageTracker steps={track} />
          </div>
        )}
      </Link>
      <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-start sm:gap-1.5">
        {hasPreview && (
          <Link
            href={`/missions/${mission.id}/preview`}
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground transition-colors duration-200 ease-in-out hover:underline"
          >
            View Preview
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{formatDate(mission.created_at)}</span>
          <StateBadge state={mission.state} />
        </div>
      </div>
    </li>
  );
}

/**
 * Ready to Present gets its own row shape, not a reuse of the generic
 * production-log entry — a finished piece of work entering the presentation
 * stage, not another database row. Business name leads at the largest size
 * in the list; the preview link is the row's whole reason for being there.
 */
function ReadyToPresentRow({ mission }: { mission: MissionRow }) {
  return (
    <li className="flex flex-col gap-3 py-6 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <Link href={`/missions/${mission.id}`} className="group min-w-0">
        <p className="truncate font-serif text-2xl font-medium text-foreground transition-colors duration-200 ease-in-out group-hover:text-foreground/75 sm:text-3xl">
          {mission.business_name}
        </p>
        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-emerald-300">Preview available</p>
      </Link>
      <Link
        href={`/missions/${mission.id}/preview`}
        className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-foreground transition-colors duration-200 ease-in-out hover:text-emerald-300"
      >
        View Preview
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </li>
  );
}

interface MissionGroupSectionProps {
  title: string;
  missions: MissionRow[];
  missionsWithPreview: ReadonlySet<string>;
  needsReview?: boolean;
}

function MissionGroupSection({
  title,
  missions,
  missionsWithPreview,
  needsReview = false,
}: MissionGroupSectionProps) {
  if (missions.length === 0) return null;

  return (
    <div className="border-t border-border pt-8 first:border-t-0 first:pt-0">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title} <span className="text-muted-foreground/50">· {missions.length}</span>
      </h3>
      <ul className="divide-y divide-border">
        {missions.map((mission) => (
          <MissionRowItem
            key={mission.id}
            mission={mission}
            hasPreview={missionsWithPreview.has(mission.id)}
            needsReview={needsReview}
          />
        ))}
      </ul>
    </div>
  );
}

function ReadyToPresentSection({ missions }: { missions: MissionRow[] }) {
  if (missions.length === 0) return null;

  return (
    <div className="border-t border-border pt-8 first:border-t-0 first:pt-0">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Ready to present <span className="text-muted-foreground/50">· {missions.length}</span>
      </h3>
      <ul className="divide-y divide-border">
        {missions.map((mission) => (
          <ReadyToPresentRow key={mission.id} mission={mission} />
        ))}
      </ul>
    </div>
  );
}

/** Renders missions grouped by what a founder needs to do about them, or an honest empty state when there are none. */
export function MissionList({ missions, missionsWithPreview = new Set() }: MissionListProps) {
  if (missions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-border py-20 text-center">
        <p className="font-serif text-2xl text-foreground">No missions yet</p>
        <p className="text-sm text-muted-foreground">Start your first one to begin building the pipeline.</p>
      </div>
    );
  }

  const groups = groupMissionsForDisplay(missions, missionsWithPreview);

  return (
    <div className="space-y-10">
      <MissionGroupSection
        title="Needs your review"
        missions={groups.needsReview}
        missionsWithPreview={missionsWithPreview}
        needsReview
      />
      <MissionGroupSection
        title="In production"
        missions={groups.inProduction}
        missionsWithPreview={missionsWithPreview}
      />
      <ReadyToPresentSection missions={groups.readyToPresent} />
    </div>
  );
}
