import { ImageOff } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * §6.7 — the full-page capture, embedded. `screenshotUrl` is a signed URL
 * resolved server-side (the stored value is a private-bucket storage path,
 * not a displayable URL) — when it couldn't be resolved (no screenshot was
 * captured, or the signed URL couldn't be generated), this renders an
 * honest "unavailable" state rather than a broken image.
 */
export function ScreenshotSection({ screenshotUrl }: { screenshotUrl: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Screenshot</CardTitle>
      </CardHeader>
      <CardContent>
        {screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt="Full-page website screenshot"
            className="w-full rounded-md border border-border"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
            <ImageOff className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No screenshot is available for this analysis.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
