/**
 * Shared schema types for lib/design-intelligence/ (docs/DESIGN_INTELLIGENCE.md,
 * docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md §4). This module is a
 * read-only knowledge/constraints layer, not a service: schema and rules,
 * never per-mission values, never orchestration. Nothing here depends on an
 * adapter, a repository, Supabase, or the Mission Engine, and nothing here
 * calls transitionMissionState() — matching the ownership boundary
 * `docs/SPRINT_4_DESIGN_REVIEW.md` §6 and the Design Intelligence
 * Recommendation §4 both set for this layer.
 *
 * Per-mission token *values* (an actual chosen typographic pairing, a real
 * color palette, a specific spacing scale for one business) are
 * design-brief-service.ts's future output, not this module's concern — this
 * module owns only the categories of decision that always get made and the
 * rules those values must satisfy, per the Recommendation §2's item-1/item-3
 * distinction (schema vs. per-mission values).
 */

/** The named type roles §3 defines — a small, bounded set, not an unbounded per-page vocabulary. */
export type TypeRole = "display" | "heading1" | "heading2" | "heading3" | "body" | "caption";

/** §6's motion discipline: no bounce/spring, ever — only these curves are ever allowed. */
export type EasingCurve = "ease" | "ease-in" | "ease-out" | "ease-in-out" | "linear";
