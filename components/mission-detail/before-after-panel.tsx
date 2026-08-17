"use client";

import { Loader2, ImageOff } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Before/After (CTO Phase 4 directive) — the original business's own site
 * screenshot (real, captured during Analysis — lib/adapters/screenshot-
 * adapter.ts) next to a real screenshot of the newly generated design,
 * captured live from the authenticated Design Preview route (lib/services/
 * preview-capture-service.ts). Both are real signed URLs to real uploaded
 * PNGs — never a placeholder image standing in for either side.
 *
 * REAL vs NOT-YET-AVAILABLE, stated plainly in the UI itself (CTO Phase 4
 * directive §1): "Live Preview" (the authenticated in-app route this
 * screenshot was captured from) is real and working. "External Deploy" (a
 * public URL on a real host) does not exist anywhere in this codebase —
 * shown as an honest, disabled state, never implied to work.
 */
export function BeforeAfterPanel({
  missionId,
  originalScreenshotUrl,
  previewScreenshotDesktopUrl,
  captureTriggered,
  captureError,
  onCapture,
  capturing,
}: {
  missionId: string;
  originalScreenshotUrl: string | null;
  previewScreenshotDesktopUrl: string | null;
  captureTriggered: boolean;
  captureError: string | null;
  onCapture: () => void;
  capturing: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Before / After</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs uppercase text-muted-foreground">Before — the business&apos;s real, existing site</p>
            {originalScreenshotUrl ? (
              <img src={originalScreenshotUrl} alt="Original website screenshot" className="w-full rounded-md border border-border" />
            ) : (
              <EmptyImageState label="No original screenshot available." />
            )}
          </div>
          <div>
            <p className="mb-2 text-xs uppercase text-muted-foreground">After — the real, generated design (live preview)</p>
            {previewScreenshotDesktopUrl ? (
              <img src={previewScreenshotDesktopUrl} alt="Generated design screenshot" className="w-full rounded-md border border-border" />
            ) : capturing ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Capturing a real screenshot of the live preview — real headless-browser navigation, real authentication, real
                  render…
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border py-14 text-center">
                <ImageOff className="h-5 w-5 text-muted-foreground" />
                <p className="max-w-xs text-sm text-muted-foreground">
                  {captureTriggered
                    ? "Capture was triggered but hasn't produced an image yet — check back, or see the error below."
                    : "No real screenshot of the generated design has been captured yet."}
                </p>
                {captureError && <p className="max-w-xs text-sm text-red-400">{captureError}</p>}
                <Button onClick={onCapture} disabled={capturing} size="sm" variant="outline">
                  Capture Real Screenshot
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-white/[0.02] p-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Live Preview</span> (this app, authenticated) is real — the screenshot
          above was captured from it.{" "}
          <span className="font-medium text-foreground">External Deploy</span> (a public URL on a real host) is not yet built in
          this codebase — no vendor/hosting integration exists today. See{" "}
          <code className="rounded bg-white/5 px-1 py-0.5">/missions/{missionId}/preview</code> for the live route itself.
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyImageState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
      <ImageOff className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
