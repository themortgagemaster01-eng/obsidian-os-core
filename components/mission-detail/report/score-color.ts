/** Presentation-only score → color mapping, mirrors the score bands opportunity-report-service.ts already computes from (good/moderate/poor), reused here purely for display. */
export function scoreTextClass(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 90) return "text-emerald-300";
  if (score >= 70) return "text-amber-300";
  return "text-red-300";
}

export function scoreRingClass(score: number | null): string {
  if (score === null) return "border-white/10";
  if (score >= 90) return "border-emerald-500/40";
  if (score >= 70) return "border-amber-500/40";
  return "border-red-500/40";
}
