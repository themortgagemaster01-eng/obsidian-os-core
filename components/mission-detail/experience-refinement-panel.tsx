"use client";

import { useState } from "react";
import { Sparkles, RotateCcw, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ExperienceRefinementRow } from "@/lib/repositories/experience-refinement-repository";
import {
  NEUTRAL_EXPERIENCE_PREFERENCE,
  type ExperiencePlan,
  type EnergyPreference,
  type MotionPreference,
  type HumanExperiencePreference,
} from "@/shared/design-intelligence/types";

function humanize(value: string): string {
  return value
    .replace(/-/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

const ENERGY_OPTIONS: { value: EnergyPreference; label: string }[] = [
  { value: "calmer", label: "Calmer" },
  { value: "keep", label: "Keep AI Recommendation" },
  { value: "more-energetic", label: "More Energetic" },
];

const MOTION_OPTIONS: { value: MotionPreference; label: string }[] = [
  { value: "less", label: "Less Motion" },
  { value: "recommended", label: "Recommended" },
  { value: "more", label: "More Motion" },
];

export interface ReapplyPrompt {
  preference: HumanExperiencePreference;
  fromWebsiteDesignId: string;
}

/**
 * Phase 6.4 — Human-in-the-Loop Experience Refinement. Shows the AI's
 * resolved Experience Plan in plain language (§1's prerequisite), then two
 * bounded, discrete button groups (§2) that submit a preference resolved
 * through the SAME existing constraint logic every generation-time call
 * already goes through (lib/services/experience-refinement-service.ts) —
 * this component only ever calls that one API route, it never computes or
 * guesses a resolution client-side, so what's shown here is always exactly
 * what the server actually decided, never an optimistic prediction that
 * could disagree with the real ceiling once the request lands.
 */
export function ExperienceRefinementPanel({
  missionId,
  initialBaselinePlan,
  initialCurrentRefinement,
  initialReapplyPrompt,
}: {
  missionId: string;
  initialBaselinePlan: ExperiencePlan | null;
  initialCurrentRefinement: ExperienceRefinementRow | null;
  initialReapplyPrompt: ReapplyPrompt | null;
}) {
  const [baselinePlan] = useState(initialBaselinePlan);
  const [currentRefinement, setCurrentRefinement] = useState(initialCurrentRefinement);
  const [reapplyPrompt, setReapplyPrompt] = useState(initialReapplyPrompt);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!baselinePlan) {
    return null;
  }

  const activePreference = (currentRefinement?.preference as unknown as HumanExperiencePreference | undefined) ?? NEUTRAL_EXPERIENCE_PREFERENCE;
  const displayedPlan = (currentRefinement?.resolved_plan as unknown as ExperiencePlan | undefined) ?? baselinePlan;
  const hasBeenRefined = !!currentRefinement && (activePreference.energy !== "keep" || activePreference.motion !== "recommended");

  async function submitPreference(preference: HumanExperiencePreference) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${missionId}/experience-refinement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preference }),
      });
      const body = (await res.json().catch(() => null)) as { refinement?: ExperienceRefinementRow; error?: string } | null;
      if (!res.ok || !body?.refinement) {
        throw new Error(body?.error ?? "Failed to refine the experience plan.");
      }
      setCurrentRefinement(body.refinement);
      setReapplyPrompt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refine the experience plan.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 py-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Experience Plan</h3>
          </div>
          {hasBeenRefined && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground"
              disabled={submitting}
              onClick={() => submitPreference(NEUTRAL_EXPERIENCE_PREFERENCE)}
            >
              <RotateCcw className="h-3 w-3" />
              Reset to AI Recommendation
            </Button>
          )}
        </div>

        {reapplyPrompt && (
          <div className="rounded-md border border-border bg-white/5 p-3 text-sm">
            <p className="text-foreground">
              The underlying business evidence changed. We created a new recommendation. Would you like to reapply your
              previous preference?
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" disabled={submitting} onClick={() => submitPreference(reapplyPrompt.preference)}>
                Reapply previous preference
              </Button>
              <Button size="sm" variant="ghost" disabled={submitting} onClick={() => setReapplyPrompt(null)}>
                No, keep the new recommendation
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="navy">{humanize(displayedPlan.mode)}</Badge>
            <Badge variant="outline">{humanize(displayedPlan.motionBudget)} motion</Badge>
            {currentRefinement?.was_constrained && <Badge variant="warning">Capped at this business&apos;s real ceiling</Badge>}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{displayedPlan.rationale}</p>
        </div>

        <div className="space-y-3">
          <ButtonGroup
            label="Experience Tone"
            options={ENERGY_OPTIONS}
            value={activePreference.energy}
            disabled={submitting}
            onSelect={(energy) => submitPreference({ energy, motion: activePreference.motion })}
          />
          <ButtonGroup
            label="Motion Intensity"
            options={MOTION_OPTIONS}
            value={activePreference.motion}
            disabled={submitting}
            onSelect={(motion) => submitPreference({ energy: activePreference.energy, motion })}
          />
        </div>

        {submitting && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Resolving your preference against this business&apos;s real evidence…
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ButtonGroup<T extends string>({
  label,
  options,
  value,
  disabled,
  onSelect,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  disabled: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={value === option.value ? "default" : "outline"}
            disabled={disabled}
            aria-pressed={value === option.value}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
