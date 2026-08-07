"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Plausibility check for a business URL — not a full RFC validator, just a client-side sanity gate. */
function isPlausibleUrl(value: string): boolean {
  const candidate = value.trim();
  if (candidate.length === 0) return false;
  try {
    const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
    return /\.[a-z]{2,}$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * "New Mission" dialog: single URL input + optional business name. Submits
 * to POST /api/missions, then refreshes the Mission Control list. Does not
 * perform any analysis itself — that happens in Sprint 2+ once a mission
 * exists at the `recon` stage.
 */
export function NewMissionDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlValid = isPlausibleUrl(websiteUrl);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!urlValid) {
      setError("Enter a valid business website URL.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl, businessName: businessName.trim() || undefined }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to create mission");
      }

      setWebsiteUrl("");
      setBusinessName("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create mission");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          New Mission
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a new mission</DialogTitle>
          <DialogDescription>
            Queue a business for the pipeline. Analysis begins once an agent picks it up.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="websiteUrl">Business website URL</Label>
            <Input
              id="websiteUrl"
              placeholder="https://example-business.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="businessName">Business name (optional)</Label>
            <Input
              id="businessName"
              placeholder="Acme Plumbing Co."
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              disabled={submitting}
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting || !urlValid} className="gap-2">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Launch mission
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
