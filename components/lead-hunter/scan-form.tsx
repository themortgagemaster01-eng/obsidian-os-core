"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BUCKETS = ["restaurant", "lawFirm", "dentistMedical", "homeService", "realEstate", "fitness", "luxuryServices", "general"] as const;

/**
 * Lead Hunter scan trigger — deliberately plain (CTO Lead Hunter directive
 * §15: "Do NOT spend this iteration making the dashboard prettier — current
 * UI is sufficient... visual polish comes after the workflow works").
 * Submits to POST /api/leads/scan (fire-and-forget on the server side —
 * see that route's own comment) and just tells the user to check back;
 * there's no live progress row yet, a real, disclosed Phase 1 gap, not a
 * hidden one.
 */
export function ScanForm() {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [buckets, setBuckets] = useState<Set<string>>(new Set(["restaurant"]));
  const [scanSize, setScanSize] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleBucket(bucket: string) {
    setBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!location.trim()) {
      setError("Enter a real target area (e.g. \"Kitchener, Ontario\").");
      return;
    }
    if (buckets.size === 0) {
      setError("Pick at least one industry to scan for.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/leads/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: location.trim(), industryBuckets: [...buckets], scanSize }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; status?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to start scan");
      }
      setMessage(
        `Scan started for "${location.trim()}" — this runs in the background (real geocoding + up to ${scanSize} real site crawls, sequentially, out of respect for the public APIs it uses). Reload this page in a minute or two to see results.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start scan");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div>
        <Label htmlFor="lead-hunter-location">Target area</Label>
        <Input
          id="lead-hunter-location"
          placeholder="e.g. Kitchener, Ontario"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      <div>
        <Label>Industries</Label>
        <div className="mt-1 flex flex-wrap gap-2">
          {BUCKETS.map((bucket) => (
            <button
              type="button"
              key={bucket}
              onClick={() => toggleBucket(bucket)}
              className={`rounded border px-2 py-1 text-xs ${buckets.has(bucket) ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`}
            >
              {bucket}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="lead-hunter-scan-size">Scan size (businesses to evaluate)</Label>
        <Input
          id="lead-hunter-scan-size"
          type="number"
          min={1}
          max={200}
          value={scanSize}
          onChange={(e) => setScanSize(Number(e.target.value) || 60)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Starting scan…" : "Run Lead Hunter scan"}
      </Button>
    </form>
  );
}
