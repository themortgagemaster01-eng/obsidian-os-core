"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ExistingMatch {
  matchedOn: "website_url" | "business_name";
  type: "company" | "lead";
  id: string;
  name: string;
}

/**
 * "Add a Business" (2026-09-14) — Robert's own front door for a business he
 * already knows about (a referral, something he drove past) instead of
 * waiting for a location scan to surface it. Deliberately plain, same
 * "workflow before polish" discipline ScanForm.tsx already follows.
 * Submits to POST /api/leads/manual, which dedup-checks and geocodes
 * synchronously (a real duplicate or a bad address is reported immediately
 * here) and runs the real crawl + qualification in the background — same
 * "check back in a bit" pattern as a Lead Hunter scan, since there's no
 * live progress row for an individual lead any more than there is one for
 * an individual scanned candidate today.
 */
export function AddBusinessForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingMatch, setExistingMatch] = useState<ExistingMatch | null>(null);

  function reset() {
    setBusinessName("");
    setAddress("");
    setWebsiteUrl("");
    setPhone("");
    setError(null);
    setExistingMatch(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setExistingMatch(null);

    if (!businessName.trim()) {
      setError("Business name is required.");
      return;
    }
    if (!address.trim()) {
      setError("Address is required.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/leads/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          address: address.trim(),
          websiteUrl: websiteUrl.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string; existingMatch?: ExistingMatch; location?: string }
        | null;
      if (!response.ok) {
        if (body?.existingMatch) setExistingMatch(body.existingMatch);
        throw new Error(body?.error ?? "Failed to add this business");
      }
      setMessage(
        `"${businessName.trim()}" added — real crawl and scoring running in the background. Reload this page in a bit to see it in the list.`
      );
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add this business");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Add a Business
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Add a Business</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Cancel
        </Button>
      </div>

      <div>
        <Label htmlFor="manual-lead-name">Business name</Label>
        <Input id="manual-lead-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Pepi's Pizza" />
      </div>

      <div>
        <Label htmlFor="manual-lead-address">Address</Label>
        <Input
          id="manual-lead-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. 87 Water Street North, Kitchener, ON"
        />
      </div>

      <div>
        <Label htmlFor="manual-lead-website">Website (optional)</Label>
        <Input id="manual-lead-website" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://…" />
      </div>

      <div>
        <Label htmlFor="manual-lead-phone">Phone (optional)</Label>
        <Input id="manual-lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 555-000-1111" />
      </div>

      {error && (
        <div className="text-sm text-destructive">
          <p>{error}</p>
          {existingMatch && (
            <p className="mt-1 text-muted-foreground">
              Existing {existingMatch.type === "company" ? "company" : "lead"}: {existingMatch.name}
            </p>
          )}
        </div>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Adding…" : "Add Business"}
      </Button>
    </form>
  );
}
