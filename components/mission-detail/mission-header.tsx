import { Globe } from "lucide-react";

import type { MissionRow } from "@/lib/repositories/mission-repository";
import { StateBadge } from "@/components/mission-control/state-badge";

/**
 * Always-visible header: business name, URL, and current mission state
 * (founder Phase 3 scope: "shows mission state"). When a completed
 * analysis has a viewable screenshot, its thumbnail is shown alongside —
 * this doubles as §6.1 ("Business Name" header, with URL and screenshot
 * thumbnail) once a report exists, without a second, duplicate header.
 */
export function MissionHeader({
  mission,
  screenshotUrl,
}: {
  mission: MissionRow;
  screenshotUrl?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
          {mission.business_name}
        </h1>
        <a
          href={mission.website_url}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 ease-in-out hover:text-foreground"
        >
          <Globe className="h-3.5 w-3.5" />
          {mission.website_url}
        </a>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {screenshotUrl && (
          <img
            src={screenshotUrl}
            alt={`${mission.business_name} homepage screenshot`}
            className="h-16 w-24 rounded-md border border-border object-cover object-top shadow-panel"
          />
        )}
        <StateBadge state={mission.state} />
      </div>
    </div>
  );
}
