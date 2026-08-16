import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import type { ComponentNode, SectionType, Wireframe } from "@/lib/services/design-generation-service";
import {
  COMPONENT_PADDING_STEP_INDEX_BY_ROLE,
  INTERACTIVE_SECTIONS,
  NO_MOTION_SECTIONS,
  SECTION_PADDING_STEP_INDEX_BY_ROLE,
  TOUCH_TARGET_NAME_BY_SECTION,
  spacingRoleFor,
  type RefinedDesign,
} from "@/lib/services/design-refinement-service";
import type { DesignBrief, DesignBriefCitation } from "@/lib/services/design-brief-service";
import type { DesignMemory } from "@/lib/services/design-intelligence-service";
import type { IndustryBucket } from "@/lib/design-references/reference-library";

import { validateTypeScaleOrdering, validateTypographyChoice } from "@/lib/design-intelligence/typography-rules";
import { validateSpacingScale } from "@/lib/design-intelligence/design-rules";
import {
  findDuplicateSectionStructures,
  matchesGenericSaasTemplate,
  type MissionSectionStructure,
} from "@/lib/design-intelligence/layout-rules";
import {
  findGenericPhrases,
  findDuplicateDesignSignatures,
  findCrossIndustryPatternConvergence,
  findStructuralConvergence,
  type MissionDesignSignature,
} from "@/lib/design-intelligence/genericity-rules";
import { validateMotionChoice } from "@/lib/design-intelligence/motion-rules";
import { validateMobileTypeChoice, validateTouchTarget } from "@/lib/design-intelligence/mobile-rules";

import type { ContentSection, LighthouseCategoryScores } from "@/lib/adapters/types";
import { runAccessibilityAdapter } from "@/lib/adapters/accessibility-adapter";
import { runLighthouseAdapter } from "@/lib/adapters/lighthouse-adapter";
import { runRenderedPreviewAdapter } from "@/lib/adapters/rendered-preview-adapter";

import type { LlmProvider } from "@/lib/llm/provider";
import { extractJsonFromLlmResponse } from "@/lib/llm/json-response";
import { createAnthropicProviderFromEnv } from "@/lib/llm/anthropic-provider";
import { MetricsLlmProvider } from "@/lib/llm/metrics";

import { acquireQaPreviewAccess, resolveQaPreviewAccessConfig } from "@/lib/services/qa-preview-access";

import {
  websiteDesignRepository,
  type WebsiteDesignRow,
} from "@/lib/repositories/website-design-repository";
import { designBriefRepository } from "@/lib/repositories/design-brief-repository";
import { missionRepository } from "@/lib/repositories/mission-repository";
import { websiteAnalysisRepository } from "@/lib/repositories/website-analysis-repository";
import { normalizedAnalysisFromRow } from "@/lib/services/analysis-types";
import {
  createMissionWorkflowDeps,
  transitionMissionState,
  type MissionWorkflowDeps,
} from "@/lib/workflow/mission-workflow";
import { createEventBus, type EventBus } from "@/lib/events/event-bus";

/**
 * design-qa-service.ts — Sprint 4 Phase 4 (Design QA), the first real QA
 * implementation slice, per docs/SPRINT_4_PHASE_4_DESIGN_REVIEW.md. QA
 * answers a different question than Refinement: not "make it better" (that
 * already happened, lib/services/design-refinement-service.ts) but "is this
 * ready for a founder to confidently present to a prospective client" —
 * per docs/ARCHITECTURE_SPECIFICATION_V1.md §2's explicit boundary, "QA
 * validates and reports differences but never redesigns." Nothing in this
 * file mutates a Wireframe/ComponentNode/RefinedDesign value; every function
 * below reads and grades, never writes design output.
 *
 * Evidence-first throughout (the founder's core directive, mirroring
 * ADR-013's precedent for the Opportunity Report): every category result is
 * PASS/WARN/FAIL/UNAVAILABLE, computed only from real checks that actually
 * ran. A category with nothing runnable in the current environment (most of
 * Rendered QA, absent a configured QA validation account — see
 * lib/services/qa-preview-access.ts) reads UNAVAILABLE, never a fabricated
 * PASS. Deterministic checks (this file's own re-invocation of
 * lib/design-intelligence/'s real validators — never a paraphrase of them,
 * and never simply trusting RefinedDesign.violations, since QA's whole
 * value proposition is *independent* re-verification, not reading
 * Refinement's own self-check) are strictly separated from AI-derived
 * assessments (labeled `type: "AI-derived assessment"`, always carrying
 * reasoning + citedEvidence + confidence + a recommendation) — the two are
 * never blended into one score.
 */

// ===========================================================================
// Core scoring vocabulary
// ===========================================================================

export type QaVerdict = "PASS" | "WARN" | "FAIL" | "UNAVAILABLE";
export type QaConfidence = "High" | "Medium" | "Low" | "Unavailable";

export const QA_CATEGORY_IDS = [
  "typography",
  "spacing",
  "layout",
  "motion",
  "mobile",
  "accessibility",
  "performance",
  "trust",
  "conversion",
  "brandFit",
  "genericTemplate",
] as const;
export type QaCategoryId = (typeof QA_CATEGORY_IDS)[number];

/** Categories §4 of docs/SPRINT_4_PHASE_4_DESIGN_REVIEW.md names as having a real AI-derived residue. Accessibility and Performance are deliberately excluded — "entirely deterministic once rendered... no qualitative residue" — and Trust is excluded because an AI-derived "looks plausible" judgment is the exact failure mode that category exists to guard against, never a substitute for the deterministic check. */
export const AI_DERIVED_CATEGORY_IDS = [
  "typography",
  "spacing",
  "layout",
  "motion",
  "mobile",
  "conversion",
  "brandFit",
  "genericTemplate",
] as const satisfies readonly QaCategoryId[];
export type AiDerivedCategoryId = (typeof AI_DERIVED_CATEGORY_IDS)[number];

export interface QaEvidenceItem {
  /** What produced this evidence — a real validator/adapter function name, or "AI-derived assessment" for a model judgment. Never blank. */
  source: string;
  detail: string;
}

export interface DeterministicCategoryResult {
  verdict: QaVerdict;
  confidence: QaConfidence;
  /** Which artifact this check ran against — Design JSON (Structured) or the actual Next.js preview (Rendered), per the founder's explicit instruction to document which evidence source supports each result. */
  evidenceSource: "structured" | "rendered" | "none";
  /** Real findings — normally the underlying validator's own violation strings, or a positive confirmation when clean. Empty only when verdict is UNAVAILABLE. */
  findings: string[];
  evidence: QaEvidenceItem[];
}

export interface AiDerivedAssessment {
  type: "AI-derived assessment";
  grade: "no-finding" | "MINOR" | "MODERATE" | "CRITICAL";
  reasoning: string;
  citedEvidence: string[];
  confidence: QaConfidence;
  recommendation: string;
}

export interface QaCategoryReport {
  category: QaCategoryId;
  deterministic: DeterministicCategoryResult;
  /** Present only for AI_DERIVED_CATEGORY_IDS members, and only when a real LLM call succeeded — absent (not a fabricated "no-finding") when unavailable. */
  aiDerived?: AiDerivedAssessment;
}

export interface DesignQaReport {
  missionId: string;
  websiteDesignId: string;
  businessName: string;
  generatedAt: string;
  categories: Record<QaCategoryId, QaCategoryReport>;
  /**
   * PASS: no category read FAIL, and at least the structured half of QA
   * actually ran. FAIL: at least one category read FAIL (any CRITICAL
   * finding, deterministic or AI-derived, per docs/
   * SPRINT_4_PHASE_4_DESIGN_REVIEW.md §6's threshold rule — Trust QA's zero
   * tolerance means any fabrication finding alone is sufficient).
   * INCOMPLETE: nothing FAILed, but so much of the suite read UNAVAILABLE
   * that this is not an honest PASS — §6's explicit third state ("QA
   * incomplete... not a green checkmark earned by absence of failure").
   */
  overallVerdict: "PASS" | "FAIL" | "INCOMPLETE";
  renderedQaAvailable: boolean;
  renderedQaUnavailableReason?: string;
}

function evidence(source: string, detail: string): QaEvidenceItem {
  return { source, detail };
}

function deterministicResult(
  findings: string[],
  evidenceItems: QaEvidenceItem[],
  opts: { evidenceSource: "structured" | "rendered"; failIf: boolean; warnIf?: boolean; confidence?: QaConfidence }
): DeterministicCategoryResult {
  const verdict: QaVerdict = opts.failIf ? "FAIL" : opts.warnIf ? "WARN" : "PASS";
  return {
    verdict,
    confidence: opts.confidence ?? "High",
    evidenceSource: opts.evidenceSource,
    findings,
    evidence: evidenceItems,
  };
}

function unavailable(evidenceSource: "structured" | "rendered" | "none", reason: string): DeterministicCategoryResult {
  return {
    verdict: "UNAVAILABLE",
    confidence: "Unavailable",
    evidenceSource,
    findings: [reason],
    evidence: [evidence("none", reason)],
  };
}

// ===========================================================================
// Structured QA input — everything the deterministic + AI-derived checks
// below need, gathered once by the orchestration layer (I/O) and passed in
// as plain data so every check function here stays pure and unit-testable
// with plain fixtures, matching this codebase's existing precedent
// (design-refinement-service.ts's own pure-pass shape).
// ===========================================================================

export interface QaBatchContext {
  /** Every completed mission's section order in this organization, including this one — lib/design-intelligence/layout-rules.ts's findDuplicateSectionStructures' real input (its first real caller). */
  sectionStructures: MissionSectionStructure[];
  /** Every OTHER completed mission's type-family pairing in this organization (excludes this one) — §4.1's "quietly becoming the default" signal. */
  otherTypographyFamilies: string[][];
  /** Every completed mission's heroThesis/signatureElement in this organization, including this one — lib/design-intelligence/genericity-rules.ts's findDuplicateDesignSignatures' real input (CTO Design Intelligence directive's "if the business names were removed, could a human still tell these were different businesses" test). */
  designSignatures: MissionDesignSignature[];
}

export interface QaStructuredInput {
  missionId: string;
  websiteDesignId: string;
  businessName: string;
  industryBucket: IndustryBucket;
  wireframe: Wireframe;
  components: ComponentNode[];
  refinedDesign: RefinedDesign;
  designBrief: Pick<DesignBrief, "citedInsights" | "direction" | "referencesConsidered" | "positioning" | "heroThesis" | "signatureElement">;
  designMemory: DesignMemory | null;
  /** Real crawled facts to cross-check "real"-tagged trust content against (§4.8) — null when no completed website analysis exists for this mission. */
  crawl: { certifications: ContentSection[]; testimonials: ContentSection[]; faq: ContentSection[] } | null;
  batch: QaBatchContext;
  /** This mission's own original-site Lighthouse baseline (§4.7's relative-regression bar) — null when unmeasured. */
  baselineLighthouse: LighthouseCategoryScores | null;
}

// ===========================================================================
// 4.1 Typography QA
// ===========================================================================

export function qaTypography(input: QaStructuredInput): DeterministicCategoryResult {
  const { typography } = input.refinedDesign;
  const bodySizePx = typography.scale.find((s) => s.role === "body")?.sizePx ?? 16;

  const orderingViolations = validateTypeScaleOrdering(
    typography.scale.map((s) => ({ role: s.role, relativeSize: s.sizePx / bodySizePx, relativeWeight: s.weight }))
  );
  const choiceViolations = validateTypographyChoice({
    families: typography.families,
    bodyLineLengthChars: typography.bodyLineLengthChars,
    bodyLineHeight: typography.bodyLineHeight,
  });

  const findings = [...orderingViolations, ...choiceViolations];
  const ev = [
    evidence(
      "validateTypeScaleOrdering",
      orderingViolations.length === 0
        ? "Independently re-validated: role order carries correct size contrast."
        : orderingViolations.join(" ")
    ),
    evidence(
      "validateTypographyChoice",
      choiceViolations.length === 0
        ? `${typography.families.length} family/families, ${typography.bodyLineLengthChars}-char line length, ${typography.bodyLineHeight}x line height — all within §3's bounds.`
        : choiceViolations.join(" ")
    ),
  ];

  const repeatCount = input.batch.otherTypographyFamilies.filter(
    (families) =>
      families.length === typography.families.length && families.every((f, i) => f === typography.families[i])
  ).length;
  if (repeatCount > 0) {
    const note = `Type pairing (${typography.families.join(" + ")}) is identical to ${repeatCount} other mission(s) already in this batch — may be quietly becoming a default rather than a deliberate per-mission choice (§4.1).`;
    findings.push(note);
    ev.push(evidence("batch-pairing-repeat", note));
  }

  return deterministicResult(findings, ev, {
    evidenceSource: "structured",
    failIf: orderingViolations.length > 0 || choiceViolations.length > 0,
    warnIf: repeatCount > 0,
  });
}

// ===========================================================================
// 4.2 Spacing QA
// ===========================================================================

export function qaSpacing(input: QaStructuredInput): DeterministicCategoryResult {
  const { spacing } = input.refinedDesign;
  const scaleViolations = validateSpacingScale(spacing.scale);

  const roleViolations: string[] = [];
  for (const entry of spacing.sectionSpacing) {
    const expectedRole = spacingRoleFor(entry.section);
    if (entry.role !== expectedRole) {
      roleViolations.push(
        `Section "${entry.section}" is tagged role "${entry.role}" but spacingRoleFor() resolves it to "${expectedRole}" — defense-in-depth re-check (§4.2) found a Refinement/QA disagreement.`
      );
      continue;
    }
    const expectedSectionPad = spacing.scale.steps[SECTION_PADDING_STEP_INDEX_BY_ROLE[expectedRole]];
    const expectedComponentPad = spacing.scale.steps[COMPONENT_PADDING_STEP_INDEX_BY_ROLE[expectedRole]];
    if (entry.sectionPaddingRem !== expectedSectionPad || entry.componentPaddingRem !== expectedComponentPad) {
      roleViolations.push(
        `Section "${entry.section}" (role "${expectedRole}") padding is ${entry.sectionPaddingRem}rem/${entry.componentPaddingRem}rem, expected ${expectedSectionPad}rem/${expectedComponentPad}rem for this role per the sitewide scale.`
      );
    }
  }

  const findings = [...scaleViolations, ...roleViolations];
  const ev = [
    evidence(
      "validateSpacingScale",
      scaleViolations.length === 0 ? "Independently re-validated: sitewide scale is monotonic with enough steps." : scaleViolations.join(" ")
    ),
    evidence(
      "spacingRoleFor role-proportionality re-check",
      roleViolations.length === 0
        ? `All ${spacing.sectionSpacing.length} section-spacing entries re-verified consistent with their role.`
        : roleViolations.join(" ")
    ),
  ];

  return deterministicResult(findings, ev, { evidenceSource: "structured", failIf: findings.length > 0 });
}

// ===========================================================================
// 4.3 Layout QA (+ §5's reference-structure-match, disclosed as
// not-mechanically-checkable in this codebase's current architecture)
// ===========================================================================

export function qaLayout(input: QaStructuredInput): DeterministicCategoryResult {
  const sectionOrder = input.wireframe.sections.map((s) => s.type);
  const genericMatch = matchesGenericSaasTemplate(sectionOrder);
  const leadsWithHero = sectionOrder[0] === "hero";
  const duplicateGroups = findDuplicateSectionStructures(input.batch.sectionStructures);
  const ownGroup = duplicateGroups.find((g) => g.includes(input.missionId));

  const findings: string[] = [];
  const ev: QaEvidenceItem[] = [];

  ev.push(
    evidence(
      "matchesGenericSaasTemplate",
      genericMatch
        ? "Section order exactly matches NEVER_GENERATE_RULES's banned generic-SaaS pattern."
        : "Independently re-validated: does not match the banned generic-SaaS pattern."
    )
  );
  if (genericMatch) findings.push("Section order matches the exact banned generic-SaaS-template pattern (§5, §11) — a Generation/Refinement regression, since this should be unreachable.");

  ev.push(evidence("leadsWithHero re-check", leadsWithHero ? "Wireframe leads with a hero section." : "Wireframe's first section is not hero."));
  if (!leadsWithHero) findings.push("Wireframe does not lead with a hero section — §2's 'obvious first landing point' standard is not met.");

  ev.push(
    evidence(
      "findDuplicateSectionStructures",
      ownGroup
        ? `Section-order skeleton is identical to ${ownGroup.length - 1} other mission(s) in this organization's batch: ${ownGroup.filter((id) => id !== input.missionId).join(", ")}.`
        : `Compared against ${input.batch.sectionStructures.length - 1} other mission(s) in this organization — no identical section-order skeleton found.`
    )
  );
  if (ownGroup) {
    findings.push(
      "Section-order skeleton duplicates another mission's in this batch — §12 AC3's cross-mission 'not a template' proxy has flagged a structural match. A partial proxy, not proof of genericness on its own (§7/§13 of docs/SPRINT_4_DESIGN_REVIEW.md); routed for human review, not an automatic fail."
    );
  }

  ev.push(
    evidence(
      "§5 reference-structure-match",
      "Not mechanically checkable in this codebase's current architecture: generateWireframe() assembles section order from a fixed per-industry-bucket template (WIREFRAME_TEMPLATE_BY_BUCKET), never from a specific cited reference's structure — there is no per-reference structural data model to compare against. Disclosed as a real, named gap rather than a fabricated check."
    )
  );

  return deterministicResult(findings, ev, {
    evidenceSource: "structured",
    failIf: genericMatch || !leadsWithHero,
    warnIf: !!ownGroup,
  });
}

// ===========================================================================
// 4.4 Motion QA
// ===========================================================================

export function qaMotion(input: QaStructuredInput): DeterministicCategoryResult {
  const { motions, intensity } = input.refinedDesign.motion;
  const violations: string[] = [];

  for (const m of motions) {
    violations.push(...validateMotionChoice(m).map((e) => `[${m.section}] ${e}`));
  }

  const anyDeviation = motions.some((m) => m.deliberateDeviation);
  if (anyDeviation && intensity !== "energetic" ) {
    violations.push('A motion entry carries deliberateDeviation:true but RefinedDesign.motion.intensity is not "energetic" — deviation is not traceable to a disclosed brief decision (§6).');
  }
  if (anyDeviation && input.designBrief.direction.motionIntensity !== "energetic") {
    violations.push('A motion entry carries deliberateDeviation:true but the approved Design Brief\'s direction.motionIntensity is not "energetic" — deviation not traceable to the brief that should own this decision (§6).');
  }

  const animatable = input.wireframe.sections.map((s) => s.type).filter((t) => !NO_MOTION_SECTIONS.includes(t));
  const animatedSet = new Set(motions.map((m) => m.section));
  for (const t of animatable) {
    if (!animatedSet.has(t)) violations.push(`Section "${t}" should carry a motion entry but none was found.`);
  }
  for (const t of NO_MOTION_SECTIONS) {
    if (animatedSet.has(t)) violations.push(`Section "${t}" is a no-motion section but carries a motion entry.`);
  }

  const ev = [
    evidence(
      "validateMotionChoice (per section)",
      `Independently re-validated ${motions.length} motion entries against duration band, allowed easing, and required purpose.`
    ),
    evidence("deliberateDeviation traceability", anyDeviation ? "At least one section deviates from the default band; checked traceability to the brief's motionIntensity." : "No section deviates from the default band."),
    evidence("motion coverage", `${animatable.length} animatable section(s), ${NO_MOTION_SECTIONS.length} no-motion section(s) — re-verified coverage independently of refineMotion's own output.`),
  ];

  return deterministicResult(violations, ev, { evidenceSource: "structured", failIf: violations.length > 0 });
}

// ===========================================================================
// 4.5 Mobile QA — structured half only; qaMobileRendered below is the real
// 375px acceptance condition per §4.5.
// ===========================================================================

export function qaMobileStructured(input: QaStructuredInput): DeterministicCategoryResult {
  const { mobile } = input.refinedDesign;
  const violations: string[] = [];
  for (const t of mobile.touchTargets) violations.push(...validateTouchTarget(t));
  violations.push(...validateMobileTypeChoice({ bodyFontSizePx: mobile.bodyFontSizePx, bodyLineLengthChars: mobile.bodyLineLengthChars }));

  const ev = [
    evidence(
      "validateTouchTarget / validateMobileTypeChoice",
      violations.length === 0
        ? `Independently re-validated ${mobile.touchTargets.length} touch target(s) and mobile type choice — all within §7's bounds.`
        : violations.join(" ")
    ),
    evidence(
      "singleColumnVerified",
      `Carried through as-is: true by data-model construction only (Wireframe.sections has no way to express a multi-column section), not independently rendered-verified — not silently upgraded to a confident measured pass (§4.5).`
    ),
  ];

  return deterministicResult(violations, ev, { evidenceSource: "structured", failIf: violations.length > 0 });
}

// ===========================================================================
// 4.8 Trust QA — zero tolerance, deterministic only
// ===========================================================================

export function qaTrust(input: QaStructuredInput): DeterministicCategoryResult {
  const findings: string[] = [];
  let totalSlots = 0;

  for (const node of input.components) {
    for (const slot of node.slots) {
      totalSlots += 1;
      if (slot.source === "placeholder" && slot.value !== null) {
        findings.push(
          `CRITICAL: ${node.section}.${slot.name} is tagged "placeholder" but carries a non-null value ("${slot.value}") — fabricated content on a disclosed-gap slot. Zero tolerance (§4.8).`
        );
      }
    }
  }

  for (const node of input.components) {
    for (const slot of node.slots) {
      if (slot.source !== "real" || slot.value === null) continue;

      if (slot.name.startsWith("testimonial-attribution-")) {
        // design-generation-service.ts sources this slot from a
        // testimonial's real ContentSection.heading (crawl-adapter.ts's
        // findTestimonialsByStructure) — a different field than the quote
        // excerpt checked below, so it must trace against crawled
        // testimonial headings, not excerpts (checking excerpts here would
        // false-flag every real attribution as untraceable fabrication).
        const realAttributions = input.crawl?.testimonials.map((t) => t.heading) ?? [];
        const traces = realAttributions.some((h) => h === slot.value);
        if (!traces) {
          findings.push(
            `CRITICAL: ${node.section}.${slot.name} is tagged "real" but its value does not trace to any crawled testimonial attribution — untraceable real-tagged content (§4.8).`
          );
        }
      } else if (slot.name.startsWith("testimonial-")) {
        const realTestimonials = input.crawl?.testimonials.map((t) => t.excerpt) ?? [];
        const traces = realTestimonials.some((t) => t.includes(slot.value!) || slot.value!.includes(t));
        if (!traces) {
          findings.push(
            `CRITICAL: ${node.section}.${slot.name} is tagged "real" but its value does not trace to any crawled testimonial text — untraceable real-tagged content (§4.8).`
          );
        }
      } else if (slot.name.startsWith("question-")) {
        // design-generation-service.ts's faq case sources "question-N" slots
        // exclusively from context.faqEvidence (real crawled FAQ content) —
        // the older citedInsights-reframed-as-a-question fallback was
        // removed entirely (CTO Design Intelligence Remediation directive,
        // Issue 3: it surfaced internal audit findings in the visitor-facing
        // voice). Checking only citedInsights here left this branch
        // permanently unmatchable and flagged every real FAQ slot from every
        // business as untraceable — a false CRITICAL, not a real fabrication
        // (Evidence Depth investigation). citedInsights is kept as a second,
        // still-valid trace source rather than removed outright, since nothing
        // rules out a future/alternate caller legitimately using it.
        const realFaq = input.crawl?.faq.map((f) => f.excerpt) ?? [];
        const matchesCrawledFaq = realFaq.some((excerpt) => slot.value!.includes(excerpt));
        const matchesCitation = input.designBrief.citedInsights.some((c: DesignBriefCitation) => c.statement === slot.value);
        if (!matchesCrawledFaq && !matchesCitation) {
          findings.push(
            `CRITICAL: ${node.section}.${slot.name} is tagged "real" but its value does not trace to any crawled FAQ content or cited Insight statement.`
          );
        }
      } else if (slot.name === "businessName" && slot.value !== input.businessName) {
        findings.push(`CRITICAL: ${node.section}.businessName is "${slot.value}" but the mission's real business name is "${input.businessName}".`);
      }
    }
  }

  const ev = [
    evidence("placeholder-slot fabrication audit", `${totalSlots} slots across ${input.components.length} component(s) checked.`),
    evidence(
      "real-slot traceability cross-check",
      input.crawl
        ? `Cross-checked against ${input.crawl.testimonials.length} crawled testimonial(s), ${input.crawl.faq.length} crawled FAQ item(s), and ${input.designBrief.citedInsights.length} cited Insight statement(s).`
        : `No completed website analysis available to cross-check "real"-tagged testimonial/FAQ content against crawled facts — testimonial/FAQ-slot traceability could not be verified this run (businessName citation check still ran).`
    ),
  ];

  // Zero tolerance: any finding is FAIL, never WARN — §4.8's whole point.
  return deterministicResult(findings, ev, { evidenceSource: "structured", failIf: findings.length > 0 });
}

// ===========================================================================
// 4.9 Conversion QA
// ===========================================================================

export function qaConversion(input: QaStructuredInput): DeterministicCategoryResult {
  const findings: string[] = [];
  const targets = input.refinedDesign.mobile.touchTargets;
  const heroCta = targets.find((t) => t.name === TOUCH_TARGET_NAME_BY_SECTION.hero);
  const hasContactSection = input.wireframe.sections.some((s) => s.type === "contact");
  const contactCta = targets.find((t) => t.name === TOUCH_TARGET_NAME_BY_SECTION.contact);

  if (!heroCta) findings.push("No hero primary CTA touch target found — the main call to action is not structurally present.");
  if (!hasContactSection) findings.push("No contact section in the wireframe — no structural path to the business's desired action.");
  else if (!contactCta) findings.push("Contact section exists but no primary contact-action touch target was found.");

  const names = targets.map((t) => t.name);
  const dupeNames = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dupeNames.length > 0) {
    findings.push(`Duplicate touch-target names found (${dupeNames.join(", ")}) — competing actions rather than one consistent hierarchy (§4.9).`);
  }

  const primaryCta = input.designMemory?.ctaHierarchy?.primary;
  if (!primaryCta || primaryCta.trim().length === 0) {
    findings.push("Design Memory's ctaHierarchy.primary is empty — no stated primary call to action for this mission.");
  }

  const ev = [
    evidence("hero/contact touch-target presence", heroCta && contactCta ? "Both a hero CTA and a contact primary action are structurally present." : "One or both primary action targets missing."),
    evidence("touch-target name uniqueness", dupeNames.length === 0 ? "No duplicate primary-action names." : `Duplicates: ${dupeNames.join(", ")}.`),
    evidence("DesignMemory.ctaHierarchy", primaryCta ? `Stated primary CTA: "${primaryCta}".` : "No primary CTA stated."),
  ];

  return deterministicResult(findings, ev, {
    evidenceSource: "structured",
    failIf: !heroCta || !hasContactSection,
    warnIf: findings.length > 0,
  });
}

// ===========================================================================
// 4.10 Brand/Business Fit QA — mechanical half only; the genuine fit
// judgment is AI-derived (see runAiDerivedAssessments below).
// ===========================================================================

export function qaBrandFitStructured(input: QaStructuredInput): DeterministicCategoryResult {
  const duplicateGroups = findDuplicateSectionStructures(input.batch.sectionStructures);
  const isDuplicated = duplicateGroups.some((g) => g.includes(input.missionId));

  const brandTerms = (input.designMemory?.brandPersonality ?? []).map((t) => t.toLowerCase()).filter((t) => t.length > 2);
  const realCopy = input.components
    .flatMap((c) => c.slots)
    .filter((s) => s.source === "real" && s.value)
    .map((s) => s.value!.toLowerCase())
    .join(" ");
  const referencedTerms = brandTerms.filter((t) => realCopy.includes(t));

  const findings: string[] = [];
  if (isDuplicated) {
    findings.push("Structurally identical to another mission's output in this batch (see Layout QA) — necessary-but-not-sufficient signal against 'not a template marketplace' (docs/VISION_GUARDRAILS.md).");
  }
  const loadBearingNote =
    brandTerms.length === 0
      ? "Design Memory states no brandPersonality terms to check."
      : referencedTerms.length > 0
        ? `${referencedTerms.length}/${brandTerms.length} of Design Memory's brandPersonality terms are literally present in assembled real-slot copy.`
        : `None of Design Memory's brandPersonality terms (${brandTerms.join(", ")}) appear in assembled real-slot copy — a real, disclosed architectural gap: assembleComponents() does not currently consume DesignMemory's brandPersonality/contentTone fields at all, so they are recorded but not (yet) load-bearing in what actually ships.`;
  findings.push(loadBearingNote);

  const ev = [
    evidence("findDuplicateSectionStructures (brand-fit angle)", isDuplicated ? "Structural duplicate found in batch." : "No structural duplicate found in batch."),
    evidence("brandPersonality load-bearing check", loadBearingNote),
  ];

  return deterministicResult(findings, ev, {
    evidenceSource: "structured",
    failIf: false,
    warnIf: isDuplicated || (brandTerms.length > 0 && referencedTerms.length === 0),
    confidence: "Medium",
  });
}

// ===========================================================================
// 4.11 Generic Template Detection
// ===========================================================================

const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

export function qaGenericTemplate(input: QaStructuredInput): DeterministicCategoryResult {
  const sectionOrder = input.wireframe.sections.map((s) => s.type);
  const genericMatch = matchesGenericSaasTemplate(sectionOrder);
  const duplicateGroups = findDuplicateSectionStructures(input.batch.sectionStructures);
  const isDuplicated = duplicateGroups.some((g) => g.includes(input.missionId));

  const signatureDuplicates = findDuplicateDesignSignatures(input.batch.designSignatures);
  const isHeroThesisDuplicated = signatureDuplicates.duplicateHeroThesis.some((g) => g.includes(input.missionId));
  const isSignatureElementDuplicated = signatureDuplicates.duplicateSignatureElement.some((g) => g.includes(input.missionId));

  const crossIndustryConvergenceGroups = findCrossIndustryPatternConvergence(input.batch.designSignatures);
  const crossIndustryGroup = crossIndustryConvergenceGroups.find((g) => g.includes(input.missionId));
  const structuralConvergenceGroups = findStructuralConvergence(input.batch.designSignatures);
  const structuralGroup = structuralConvergenceGroups.find((g) => g.includes(input.missionId));

  const genericPhraseHits = [
    ...findGenericPhrases(input.designBrief.positioning ?? ""),
    ...findGenericPhrases(input.designBrief.heroThesis ?? ""),
    ...findGenericPhrases(input.designBrief.signatureElement?.justification ?? ""),
  ];
  const uniqueGenericPhraseHits = [...new Set(genericPhraseHits)];

  const findings: string[] = [];
  if (genericMatch) findings.push("Matches NEVER_GENERATE_RULES 'generic-saas-hero' — the exact banned pattern.");
  if (isDuplicated) findings.push("Matches NEVER_GENERATE_RULES 'template-looking-pages' proxy — structural duplicate found in this batch.");
  if (isHeroThesisDuplicated) findings.push("This mission's heroThesis is identical (after normalization) to another mission's in this batch — a real distinctiveness failure independent of section order (CTO Design Intelligence directive's 'if the business names were removed' test).");
  if (isSignatureElementDuplicated) findings.push("This mission's signatureElement is identical to another mission's in this batch.");
  if (uniqueGenericPhraseHits.length > 0) findings.push(`Hollow marketing filler found in positioning/heroThesis/signatureElement: ${uniqueGenericPhraseHits.join(", ")}.`);
  if (crossIndustryGroup) {
    findings.push(
      `WARN: this mission's hero pattern is shared with ${crossIndustryGroup.length - 1} other mission(s) in this batch across genuinely different industries — worth a human's attention as a possible "AI sameness" default rather than an evidence-driven choice, though not automatically wrong (docs/DESIGN_INTELLIGENCE.md §5). Not flagged when the shared pattern occurs only within the same industry bucket, where evidence is often genuinely similar.`
    );
  }
  if (structuralGroup) {
    findings.push(`WARN: this mission shares the same full rendered structural signature with ${structuralGroup.length - 1} other mission(s): hero composition, layout family, section order, navigation, CTA placement, media relationship, and component hierarchy all converge. Human review required.`);
  }

  const emojiSlots: string[] = [];
  for (const node of input.components) {
    for (const slot of node.slots) {
      if (slot.source === "real" && slot.value && EMOJI_REGEX.test(slot.value)) {
        emojiSlots.push(`${node.section}.${slot.name}`);
      }
    }
  }
  if (emojiSlots.length > 0) findings.push(`NEVER_GENERATE_RULES 'emoji-as-icon': emoji found in ${emojiSlots.join(", ")}.`);

  const ev = [
    evidence("matchesGenericSaasTemplate + findDuplicateSectionStructures", `Generic-pattern match: ${genericMatch}. Structural duplicate: ${isDuplicated}.`),
    evidence("findDuplicateDesignSignatures", `heroThesis duplicate: ${isHeroThesisDuplicated}. signatureElement duplicate: ${isSignatureElementDuplicated}.`),
    evidence(
      "findCrossIndustryPatternConvergence",
      crossIndustryGroup
        ? `Hero pattern shared across ${crossIndustryGroup.length} missions spanning different industries: ${crossIndustryGroup.join(", ")}.`
        : "No hero-pattern convergence found across genuinely different industries in this batch."
    ),
    evidence(
      "findStructuralConvergence",
      structuralGroup
        ? `Full structural signature shared with ${structuralGroup.length - 1} other mission(s): ${structuralGroup.filter((id) => id !== input.missionId).join(", ")}.`
        : "No full rendered structural-signature convergence found in this batch."
    ),
    evidence("findGenericPhrases", uniqueGenericPhraseHits.length > 0 ? `Banned phrases found: ${uniqueGenericPhraseHits.join(", ")}.` : "No banned generic-marketing phrases found."),
    evidence("emoji-as-icon scan", `${emojiSlots.length} real-slot value(s) containing an emoji character.`),
    evidence(
      "decorative-gradient / generic-ai-illustration / stock-imagery",
      "Not mechanically checkable against this data model: ComponentSlot carries no imagery/gradient/color-role field to scan — disclosed gap, not a fabricated check."
    ),
  ];

  return deterministicResult(findings, ev, {
    evidenceSource: "structured",
    failIf: genericMatch || isHeroThesisDuplicated || isSignatureElementDuplicated || uniqueGenericPhraseHits.length > 0,
    warnIf: isDuplicated || emojiSlots.length > 0 || !!crossIndustryGroup || !!structuralGroup,
  });
}

// ===========================================================================
// 4.6 / 4.7 Accessibility & Performance — structured stub + rendered
// ===========================================================================

export function qaAccessibilityStructured(input: QaStructuredInput): DeterministicCategoryResult {
  const stated = input.designMemory?.accessibilityTargets?.trim();
  return {
    verdict: "UNAVAILABLE",
    confidence: "Unavailable",
    evidenceSource: "structured",
    findings: [
      stated
        ? `Design Memory states an accessibility intention: "${stated}" — a stated intention only, not a verified outcome.`
        : "No accessibilityTargets stated in Design Memory.",
    ],
    evidence: [
      evidence(
        "accessibilityTargets field",
        "Accessibility QA has no meaningful structured-data-only verdict (§4.6: 'entirely deterministic once rendered... blocked on rendering, not blocked on judgment') — the real grade comes only from a rendered axe-core run."
      ),
    ],
  };
}

export async function qaAccessibilityRendered(
  previewUrl: string,
  cookies: { name: string; value: string; domain: string; path?: string }[]
): Promise<DeterministicCategoryResult> {
  const result = await runAccessibilityAdapter(previewUrl, { cookies });
  if (result.fetchError) {
    return unavailable("rendered", `Real axe-core run against the rendered preview failed: ${result.fetchError}`);
  }

  const { critical, serious } = result.violationCountByImpact;
  const findings = [
    `${result.violations.length} total violation(s) (${critical} critical, ${serious} serious, ${result.violationCountByImpact.moderate} moderate, ${result.violationCountByImpact.minor} minor); ${result.passCount} passed check(s).`,
    ...result.violations.map((v) => `[${v.impact ?? "unknown"}] ${v.id}: ${v.help} (${v.nodeCount} node(s))`),
  ];

  return deterministicResult(findings, [evidence("runAccessibilityAdapter (real axe-core run)", findings[0])], {
    evidenceSource: "rendered",
    failIf: critical > 0,
    warnIf: serious > 0,
  });
}

export async function qaPerformanceRendered(
  previewUrl: string,
  cookieHeader: string,
  baseline: LighthouseCategoryScores | null
): Promise<DeterministicCategoryResult> {
  const result = await runLighthouseAdapter(previewUrl, { extraHeaders: { Cookie: cookieHeader } });
  if (result.fetchError) {
    return unavailable("rendered", `Real Lighthouse run against the rendered preview failed: ${result.fetchError}`);
  }

  const { performance, accessibility, bestPractices, seo } = result.scores;
  const findings = [
    `Lighthouse scores — performance: ${performance ?? "n/a"}, accessibility: ${accessibility ?? "n/a"}, best practices: ${bestPractices ?? "n/a"}, SEO: ${seo ?? "n/a"}.`,
  ];

  let regressed = false;
  if (baseline?.performance != null && performance != null) {
    const delta = performance - baseline.performance;
    findings.push(`Performance vs. original site baseline (${baseline.performance}): ${delta >= 0 ? "+" : ""}${delta}.`);
    if (delta < 0) regressed = true;
  } else {
    findings.push("No original-site Lighthouse baseline available for a relative comparison — graded on absolute score only.");
  }

  const lowAbsolute = performance != null && performance < 50;

  return deterministicResult(findings, [evidence("runLighthouseAdapter (real Lighthouse run)", findings[0])], {
    evidenceSource: "rendered",
    failIf: lowAbsolute,
    warnIf: regressed,
  });
}

export interface RenderedMobileEvidence {
  overflow: boolean;
  touchTargetsBelowMinimum: number;
  screenshotByteSize: number;
}

export async function qaMobileRendered(previewUrl: string, cookies: { name: string; value: string; domain: string; path?: string }[]) {
  const result = await runRenderedPreviewAdapter(previewUrl, { cookies });
  if (result.fetchError || !result.mobile || !result.desktop) {
    return {
      mobile: unavailable("rendered", `Real 375px rendered check failed: ${result.fetchError ?? "no viewport measurement returned"}`),
      visual: unavailable("rendered", `Real screenshot capture failed: ${result.fetchError ?? "no viewport measurement returned"}`),
    };
  }

  const belowMin = result.mobile.touchTargets.filter((t) => t.widthPx < 44 || t.heightPx < 44);
  const findings = [
    `375px viewport: ${result.mobile.horizontalOverflow ? "horizontal overflow detected" : "no horizontal overflow"}; ${result.mobile.touchTargets.length} touch target(s) measured, ${belowMin.length} below the 44px minimum.`,
  ];

  const mobile = deterministicResult(findings, [evidence("runRenderedPreviewAdapter (real 375px DOM measurement)", findings[0])], {
    evidenceSource: "rendered",
    failIf: result.mobile.horizontalOverflow,
    warnIf: belowMin.length > 0,
  });

  const visualFindings = [
    `Desktop screenshot captured: ${result.desktop.screenshotByteSize} bytes at ${result.desktop.widthPx}x${result.desktop.heightPx}.`,
    `Mobile (375px) screenshot captured: ${result.mobile.screenshotByteSize} bytes at ${result.mobile.widthPx}x${result.mobile.heightPx}.`,
    `Page title observed: "${result.pageTitle ?? "(none)"}" — DOM rendered with real content, not just structurally present markup.`,
  ];
  const visual = deterministicResult(visualFindings, [evidence("runRenderedPreviewAdapter (screenshot capture)", visualFindings.join(" "))], {
    evidenceSource: "rendered",
    failIf: false,
  });

  return { mobile, visual };
}

// ===========================================================================
// AI-derived assessment layer — one consolidated LLM call, mirroring
// design-intelligence-service.ts's exact shape (system+user prompt, single
// JSON response, defensive extraction, real structural validation of every
// field). Every assessment is text-and-structured-data judgment over
// already-generated Design Brief/Design Memory/component-slot content — no
// vision model, no pixels, per §12 answer 3 of the Phase 4 planning doc.
// ===========================================================================

/**
 * Eight categories' worth of reasoning + citedEvidence + recommendation
 * genuinely needs headroom beyond the 4096 default — a live run against the
 * real Anthropic API hit exactly this ceiling mid-JSON (completionTokens:
 * 4096, truncated before the object closed), the same failure mode
 * design-intelligence-service.ts's own DESIGN_INTELLIGENCE_MAX_TOKENS doc
 * comment already names and fixed the same way: raise with headroom rather
 * than trim the response's own content.
 */
const QA_MAX_TOKENS = 8192;

function buildAiDerivedSystemPrompt(): string {
  return `You are the QA Judgment layer of Obsidian OS, an autonomous client-acquisition system. Deterministic rule checks have already run against this generated website design — your job is ONLY the qualitative residue those rules cannot capture: whether choices that are structurally valid also genuinely fit this specific business.

Rules for your response:
- Never contradict or restate a deterministic pass/fail — you are evaluating fit and intent, not rule compliance.
- Never invent facts about the business beyond what you are given.
- Every assessment must be labeled, reasoned, and cite specific evidence from the input — a grade with no reasoning is not acceptable.
- grade must be exactly one of: "no-finding", "MINOR", "MODERATE", "CRITICAL".
- citedEvidence must be a non-empty array of short strings, each pointing at something specific in the input (a section name, a stated brand term, a copy fragment) — never a generic statement.
- recommendation is a concrete, actionable next step, or "No action needed" when grade is "no-finding".
- Keep every reasoning/recommendation string to 1-3 sentences, and every citedEvidence entry to a short phrase — eight categories' worth of output must fit in one concise response; a shorter, complete response is far more useful than a longer one that gets cut off before it finishes.

Respond with ONLY a single JSON object, no prose before or after, no markdown fences, with exactly these eight top-level keys: typography, spacing, layout, motion, mobile, conversion, brandFit, genericTemplate. Each value must have exactly this shape:
{ "grade": "no-finding" | "MINOR" | "MODERATE" | "CRITICAL", "reasoning": "string", "citedEvidence": ["string"], "recommendation": "string" }

What each key evaluates:
- typography: does the family pairing read as a deliberate choice for this business's register, not just structurally valid.
- spacing: does the page read as crowded or as empty at a holistic, whole-page level.
- layout: composition quality — does the sequencing follow this business's actual story, does the page read as composed rather than assembled.
- motion: does the motion feel purposeful or performative in aggregate.
- mobile: does the mobile experience feel considered, not just a compressed desktop layout (judge from the structural data given — you are not shown a screenshot).
- conversion: is the contact/booking path's friction appropriate for this business's industry category.
- brandFit: does the typographic mood, color direction, and copy tone genuinely read as this business's industry, not merely "different from a generic template."
- genericTemplate: any residual generic-feeling signal not already caught by the named deterministic rules.`;
}

export interface AiDerivedInput {
  businessName: string;
  industryBucket: string;
  positioning: string;
  targetAudience: string;
  typographicMood: string;
  colorDirection: string;
  layoutFamily: string;
  motionIntensity: string;
  sectionOrder: string[];
  realCopySamples: string[];
  brandPersonality: string[];
  contentTone: string;
}

function buildAiDerivedUserPrompt(input: AiDerivedInput): string {
  return `Business: ${input.businessName}
Industry bucket: ${input.industryBucket}
Positioning: ${input.positioning}
Target audience: ${input.targetAudience}

Design direction chosen:
- Layout family: ${input.layoutFamily}
- Typographic mood: ${input.typographicMood}
- Color direction: ${input.colorDirection}
- Motion intensity: ${input.motionIntensity}
- Brand personality terms: ${input.brandPersonality.join(", ") || "(none stated)"}
- Content tone: ${input.contentTone || "(none stated)"}

Wireframe section order: ${input.sectionOrder.join(" -> ")}

Real (never placeholder) copy actually assembled for this design:
${input.realCopySamples.length > 0 ? input.realCopySamples.map((c) => `- ${c}`).join("\n") : "(no real copy slots yet — most content is placeholder-only for this mission)"}

Evaluate this specific, already-generated design per your instructions.`;
}

interface RawAiDerivedCategory {
  grade?: unknown;
  reasoning?: unknown;
  citedEvidence?: unknown;
  recommendation?: unknown;
}

const VALID_GRADES = ["no-finding", "MINOR", "MODERATE", "CRITICAL"] as const;

function parseAiDerivedAssessment(category: AiDerivedCategoryId, raw: RawAiDerivedCategory): AiDerivedAssessment {
  if (typeof raw.grade !== "string" || !VALID_GRADES.includes(raw.grade as (typeof VALID_GRADES)[number])) {
    throw new Error(`AI-derived response for "${category}" has an invalid grade: ${JSON.stringify(raw.grade)}.`);
  }
  if (typeof raw.reasoning !== "string" || raw.reasoning.trim().length === 0) {
    throw new Error(`AI-derived response for "${category}" is missing non-empty "reasoning".`);
  }
  if (typeof raw.recommendation !== "string" || raw.recommendation.trim().length === 0) {
    throw new Error(`AI-derived response for "${category}" is missing non-empty "recommendation".`);
  }
  if (!Array.isArray(raw.citedEvidence) || raw.citedEvidence.length === 0 || !raw.citedEvidence.every((e) => typeof e === "string")) {
    throw new Error(`AI-derived response for "${category}" must have a non-empty "citedEvidence" array of strings.`);
  }

  return {
    type: "AI-derived assessment",
    grade: raw.grade as AiDerivedAssessment["grade"],
    reasoning: raw.reasoning,
    citedEvidence: raw.citedEvidence as string[],
    recommendation: raw.recommendation,
    confidence: "Medium",
  };
}

/**
 * runAiDerivedAssessments — the one function in this file that calls an
 * LlmProvider. Returns a partial map: a category present here got a real,
 * validated assessment; a category absent here (including all of them, on
 * total failure) is left for the caller to render as "AI-derived assessment
 * unavailable" — never a fabricated grade standing in for a call that
 * didn't happen or a response that didn't parse.
 */
export async function runAiDerivedAssessments(
  provider: LlmProvider,
  input: AiDerivedInput
): Promise<{ assessments: Partial<Record<AiDerivedCategoryId, AiDerivedAssessment>>; error?: string }> {
  try {
    const raw = await provider.complete({
      systemPrompt: buildAiDerivedSystemPrompt(),
      userPrompt: buildAiDerivedUserPrompt(input),
      maxTokens: QA_MAX_TOKENS,
      expectJson: true,
    });
    const parsed = extractJsonFromLlmResponse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { assessments: {}, error: "AI-derived assessment response was not a JSON object." };
    }
    const obj = parsed as Record<string, RawAiDerivedCategory>;

    const assessments: Partial<Record<AiDerivedCategoryId, AiDerivedAssessment>> = {};
    const errors: string[] = [];
    for (const category of AI_DERIVED_CATEGORY_IDS) {
      const entry = obj[category];
      if (!entry || typeof entry !== "object") {
        errors.push(`missing "${category}"`);
        continue;
      }
      try {
        assessments[category] = parseAiDerivedAssessment(category, entry);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `invalid "${category}"`);
      }
    }

    return { assessments, error: errors.length > 0 ? errors.join("; ") : undefined };
  } catch (err) {
    return { assessments: {}, error: err instanceof Error ? err.message : "AI-derived assessment call failed." };
  }
}

// ===========================================================================
// Report assembly — pure, given every already-computed category result.
// ===========================================================================

function overallVerdictFor(categories: Record<QaCategoryId, QaCategoryReport>): "PASS" | "FAIL" | "INCOMPLETE" {
  const results = Object.values(categories);
  const anyFail = results.some((r) => r.deterministic.verdict === "FAIL" || r.aiDerived?.grade === "CRITICAL");
  if (anyFail) return "FAIL";

  const unavailableCount = results.filter((r) => r.deterministic.verdict === "UNAVAILABLE").length;
  // More than half the suite unresolved is not an honest PASS — §6's "QA incomplete" third state.
  if (unavailableCount > results.length / 2) return "INCOMPLETE";

  return "PASS";
}

export function assembleDesignQaReport(
  structuredInput: Pick<QaStructuredInput, "missionId" | "websiteDesignId" | "businessName">,
  deterministic: Record<QaCategoryId, DeterministicCategoryResult>,
  aiDerived: Partial<Record<AiDerivedCategoryId, AiDerivedAssessment>>,
  rendered: { available: boolean; reason?: string }
): DesignQaReport {
  const categories = {} as Record<QaCategoryId, QaCategoryReport>;
  for (const category of QA_CATEGORY_IDS) {
    categories[category] = {
      category,
      deterministic: deterministic[category],
      ...(aiDerived[category as AiDerivedCategoryId] ? { aiDerived: aiDerived[category as AiDerivedCategoryId] } : {}),
    };
  }

  return {
    missionId: structuredInput.missionId,
    websiteDesignId: structuredInput.websiteDesignId,
    businessName: structuredInput.businessName,
    generatedAt: new Date().toISOString(),
    categories,
    overallVerdict: overallVerdictFor(categories),
    renderedQaAvailable: rendered.available,
    ...(rendered.reason ? { renderedQaUnavailableReason: rendered.reason } : {}),
  };
}

/** Runs every deterministic structured-QA check against one QaStructuredInput — pure, no I/O, independently testable. */
export function runStructuredDeterministicChecks(input: QaStructuredInput): Record<QaCategoryId, DeterministicCategoryResult> {
  return {
    typography: qaTypography(input),
    spacing: qaSpacing(input),
    layout: qaLayout(input),
    motion: qaMotion(input),
    mobile: qaMobileStructured(input),
    accessibility: qaAccessibilityStructured(input),
    performance: unavailable("none", "Performance QA has no structured-data-only check — entirely deterministic once rendered, with no qualitative residue (§4.7). Real grade requires a rendered Lighthouse run."),
    trust: qaTrust(input),
    conversion: qaConversion(input),
    brandFit: qaBrandFitStructured(input),
    genericTemplate: qaGenericTemplate(input),
  };
}

// ===========================================================================
// Orchestration — mirrors design-generation-service.ts's run shape exactly
// (ADR-012's fire-and-forget pattern), the one function in this file that
// touches Supabase, transitions mission state, calls an LLM, and drives
// headless rendered access.
// ===========================================================================

type TypedClient = SupabaseClient<Database>;

export interface DesignQaServiceDeps {
  client: TypedClient;
  websiteDesignRepository: typeof websiteDesignRepository;
  designBriefRepository: typeof designBriefRepository;
  missionRepository: typeof missionRepository;
  websiteAnalysisRepository: typeof websiteAnalysisRepository;
  workflowDeps: MissionWorkflowDeps;
  eventBus: EventBus;
  llmProvider: LlmProvider;
}

export function createDesignQaServiceDeps(client: TypedClient): DesignQaServiceDeps {
  return {
    client,
    websiteDesignRepository,
    designBriefRepository,
    missionRepository,
    websiteAnalysisRepository,
    workflowDeps: createMissionWorkflowDeps(client),
    eventBus: createEventBus(client),
    llmProvider: new MetricsLlmProvider(createAnthropicProviderFromEnv()),
  };
}

async function buildBatchContext(
  deps: DesignQaServiceDeps,
  organizationId: string,
  currentMissionId: string
): Promise<QaBatchContext> {
  const rows = await deps.websiteDesignRepository.listCompletedByOrganization(deps.client, organizationId);

  const sectionStructures: MissionSectionStructure[] = rows
    .filter((r) => !!r.wireframe)
    .map((r) => ({
      missionId: r.mission_id,
      sectionOrder: ((r.wireframe as unknown as Wireframe).sections ?? []).map((s) => s.type),
    }));
  // Ensure the current mission is represented even if this row's own wireframe wasn't yet visible in the query (e.g. same-transaction read timing).
  if (!sectionStructures.some((s) => s.missionId === currentMissionId)) {
    sectionStructures.push({ missionId: currentMissionId, sectionOrder: [] });
  }

  // Real hero Pattern Selection choice per mission (lib/design-intelligence/
  // section-patterns.ts), sourced from the SAME rows as sectionStructures
  // above — "" for a row predating ComponentNode.pattern or with no hero
  // section, findCrossIndustryPatternConvergence's own "no data" exclusion.
  const heroPatternByMissionId = new Map<string, string>(
    rows
      .filter((r) => !!r.components)
      .map((r) => {
        const heroNode = ((r.components as unknown as ComponentNode[]) ?? []).find((c) => c.section === "hero");
        return [r.mission_id, heroNode?.pattern ?? ""] as const;
      })
  );
  const componentsByMissionId = new Map<string, ComponentNode[]>(
    rows.filter((r) => !!r.components).map((r) => [r.mission_id, r.components as unknown as ComponentNode[]])
  );

  const otherTypographyFamilies = rows
    .filter((r) => r.mission_id !== currentMissionId && !!r.refined_design)
    .map((r) => (r.refined_design as unknown as RefinedDesign).typography?.families ?? [])
    .filter((families) => families.length > 0);

  const briefRows = await deps.designBriefRepository.listCompletedByOrganization(deps.client, organizationId);
  const designSignatures: MissionDesignSignature[] = briefRows
    .filter((r) => !!r.brief)
    .map((r) => {
      const brief = r.brief as unknown as DesignBrief;
      const designRow = rows.find((design) => design.mission_id === r.mission_id);
      const components = componentsByMissionId.get(r.mission_id) ?? [];
      const renderedSections = ((designRow?.wireframe as unknown as Wireframe | null)?.sections ?? [])
        .map((section) => section.type)
        .filter((section) => {
          const component = components.find((node) => node.section === section);
          return !["menu", "gallery", "services", "schedule", "listings", "serviceArea", "credibility", "faq"].includes(section) || !!component?.slots.some((slot) => slot.source === "real");
        });
      const hero = components.find((node) => node.section === "hero");
      return {
        missionId: r.mission_id,
        heroThesis: brief.heroThesis ?? "",
        signatureElement: brief.signatureElement?.element ?? "",
        industryBucket: r.industry_bucket ?? "",
        heroPattern: heroPatternByMissionId.get(r.mission_id) ?? "",
        layoutFamily: (designRow?.wireframe as unknown as Wireframe | null)?.layoutFamily ?? "",
        sectionOrder: renderedSections,
        navigationSections: renderedSections.filter((section) => section !== "hero" && section !== "footer"),
        heroHasCta: !!hero,
        contactHasCta: renderedSections.includes("contact"),
        heroMediaMode: hero?.pattern === "split-media-text" ? "split" : hero?.pattern === "image-full-bleed" || hero?.pattern === "centered-cinematic" ? "background" : "none",
        componentHierarchy: components.map((component) => `${component.section}:${component.componentKind}:${component.pattern ?? "canonical"}`),
      };
    });
  if (!designSignatures.some((s) => s.missionId === currentMissionId)) {
    designSignatures.push({ missionId: currentMissionId, heroThesis: "", signatureElement: "" });
  }

  return { sectionStructures, otherTypographyFamilies, designSignatures };
}

export interface CreateDesignQaRunInput {
  websiteDesignId: string;
}

/** No separate `design_qa` row: QA's result is persisted directly onto the `website_designs` row it graded (website_designs.qa_result, migration 0015) — one artifact, one row, mirroring how refined_design extended the same row rather than adding a new table. createDesignQaRun exists only for API-route symmetry with the other two /:id/* POST routes (design-brief, generate-design). */
export async function createDesignQaRun(
  deps: DesignQaServiceDeps,
  input: CreateDesignQaRunInput
): Promise<WebsiteDesignRow> {
  const run = await deps.websiteDesignRepository.findById(deps.client, input.websiteDesignId);
  if (!run) {
    throw new Error(`Website design ${input.websiteDesignId} not found.`);
  }
  return run;
}

/**
 * runDesignQa — the orchestration entry point. Requires a `complete`
 * website_designs row (Generation + Refinement already ran) and a
 * `designing` mission. Gathers real structured input, runs every
 * deterministic check, attempts one real AI-derived-assessment LLM call,
 * attempts real rendered QA (mobile/accessibility/performance/visual) via
 * lib/services/qa-preview-access.ts — honestly UNAVAILABLE if that
 * environment isn't configured or the auth flow doesn't succeed — persists
 * the full report to `website_designs.qa_result`, and transitions the
 * mission `designing -> qa` ONLY on success: per docs/
 * ARCHITECTURE_SPECIFICATION_V1.md and design-generation-service.ts's own
 * header comment, this is the one function in the whole pipeline that owns
 * that transition. Never transitions the mission when the run throws — an
 * unreviewed mission staying at `designing` is the correct, honest failure
 * state, not a silent advance.
 */
export async function runDesignQa(deps: DesignQaServiceDeps, websiteDesignId: string): Promise<WebsiteDesignRow> {
  const run = await deps.websiteDesignRepository.findById(deps.client, websiteDesignId);
  if (!run) throw new Error(`Website design ${websiteDesignId} not found.`);

  const mission = await deps.missionRepository.findById(deps.client, run.mission_id);
  if (!mission) throw new Error(`Mission ${run.mission_id} not found.`);

  try {
    if (mission.state !== "designing") {
      throw new Error(`Mission ${mission.id} is at state "${mission.state}", not "designing" — Design QA requires a completed Generation + Refinement pass first.`);
    }
    if (run.status !== "complete" || !run.wireframe || !run.components || !run.refined_design) {
      throw new Error("This website design run is not complete — Design QA requires wireframe, components, and refined_design to all be present.");
    }

    const briefRow = await deps.designBriefRepository.findById(deps.client, run.design_brief_id);
    if (!briefRow || briefRow.status !== "complete" || !briefRow.brief) {
      throw new Error("No completed Design Brief found for this design run — Design QA requires one.");
    }
    const brief = briefRow.brief as unknown as DesignBrief;
    const designMemory = briefRow.design_memory as unknown as DesignMemory | null;
    const wireframe = run.wireframe as unknown as Wireframe;
    const components = run.components as unknown as ComponentNode[];
    const refinedDesign = run.refined_design as unknown as RefinedDesign;

    const analysisRow = await deps.websiteAnalysisRepository.findLatestByMission(deps.client, mission.id);
    const normalized = analysisRow && analysisRow.status === "complete" ? normalizedAnalysisFromRow(analysisRow, mission.website_url) : null;
    const crawl = analysisRow?.crawl_result
      ? {
          certifications: ((analysisRow.crawl_result as unknown as { certifications?: ContentSection[] }).certifications) ?? [],
          testimonials: ((analysisRow.crawl_result as unknown as { testimonials?: ContentSection[] }).testimonials) ?? [],
          faq: ((analysisRow.crawl_result as unknown as { faq?: ContentSection[] }).faq) ?? [],
        }
      : null;

    const batch = await buildBatchContext(deps, mission.organization_id, mission.id);
    // The current mission's own real section order always wins over whatever
    // the batch query saw. Filters out EVERY prior entry for this mission
    // (not just the first match) before re-adding the fresh one — a mission
    // re-run more than once has multiple completed rows in the batch query
    // (listCompletedByOrganization has no dedup-by-mission), and a
    // find-and-replace-first-only strategy left the older row(s) in place,
    // which then trivially "duplicated" the fresh one once overwritten to
    // match it — a real, self-inflicted false positive confirmed via a live
    // five-mission validation run, not a hypothetical.
    batch.sectionStructures = batch.sectionStructures.filter((s) => s.missionId !== mission.id);
    batch.sectionStructures.push({ missionId: mission.id, sectionOrder: wireframe.sections.map((s) => s.type) });

    // Same "own real value always wins, every stale entry for this mission
    // removed first" discipline for this mission's own design signature.
    batch.designSignatures = batch.designSignatures.filter((s) => s.missionId !== mission.id);
    batch.designSignatures.push({
      missionId: mission.id,
      heroThesis: brief.heroThesis ?? "",
      signatureElement: brief.signatureElement?.element ?? "",
    });

    const structuredInput: QaStructuredInput = {
      missionId: mission.id,
      websiteDesignId,
      businessName: mission.business_name,
      industryBucket: brief.industryBucket,
      wireframe,
      components,
      refinedDesign,
      designBrief: brief,
      designMemory,
      crawl,
      batch,
      baselineLighthouse: normalized?.lighthouse ?? null,
    };

    const deterministic = runStructuredDeterministicChecks(structuredInput);

    const { assessments: aiDerived } = await runAiDerivedAssessments(deps.llmProvider, {
      businessName: mission.business_name,
      industryBucket: brief.industryBucket,
      positioning: brief.positioning,
      targetAudience: brief.targetAudience,
      typographicMood: brief.direction.typographicMood,
      colorDirection: brief.direction.colorDirection,
      layoutFamily: brief.direction.layoutFamily,
      motionIntensity: brief.direction.motionIntensity,
      sectionOrder: wireframe.sections.map((s) => s.type),
      realCopySamples: components.flatMap((c) => c.slots).filter((s) => s.source === "real" && s.value).map((s) => `${s.name}: ${s.value}`),
      brandPersonality: designMemory?.brandPersonality ?? [],
      contentTone: designMemory?.contentTone ?? "",
    });

    const accessConfig = resolveQaPreviewAccessConfig();
    let renderedAvailable = false;
    let renderedReason: string | undefined;
    if (accessConfig) {
      const access = await acquireQaPreviewAccess(accessConfig);
      if (access.available) {
        renderedAvailable = true;
        const previewUrl = `${accessConfig.appBaseUrl}/missions/${mission.id}/preview?designId=${websiteDesignId}`;
        const [accessibilityRendered, performanceRendered, mobileRendered] = await Promise.all([
          qaAccessibilityRendered(previewUrl, access.cookies),
          qaPerformanceRendered(previewUrl, access.cookieHeader, structuredInput.baselineLighthouse),
          qaMobileRendered(previewUrl, access.cookies),
        ]);
        deterministic.accessibility = accessibilityRendered;
        deterministic.performance = performanceRendered;
        deterministic.mobile = mobileRendered.mobile;
        (deterministic as Record<string, DeterministicCategoryResult>).visual = mobileRendered.visual;
      } else {
        renderedReason = access.reason;
      }
    } else {
      renderedReason = "QA_PREVIEW_* environment not configured — Rendered QA (Mobile/Accessibility/Performance/Visual) requires an explicit, opt-in QA validation account (see lib/services/qa-preview-access.ts).";
    }

    const report = assembleDesignQaReport(structuredInput, deterministic, aiDerived, { available: renderedAvailable, reason: renderedReason });

    const updated = await deps.websiteDesignRepository.update(deps.client, websiteDesignId, {
      qa_result: report as unknown as Json,
    });

    await deps.eventBus.publish({
      type: "DesignQaComplete",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: { overallVerdict: report.overallVerdict, renderedQaAvailable: report.renderedQaAvailable },
    });

    await transitionMissionState(deps.workflowDeps, mission.id, "qa");

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Design QA failed for an unknown reason.";

    await deps.eventBus.publish({
      type: "DesignQaFailed",
      missionId: mission.id,
      organizationId: mission.organization_id,
      payload: { errorMessage: message },
    });

    throw err instanceof Error ? err : new Error(message);
  }
}
