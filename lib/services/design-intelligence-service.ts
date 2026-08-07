import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";
import { extractJsonFromLlmResponse } from "@/lib/llm/json-response";

import type { AnalysisCategory } from "@/lib/services/analysis-types";
import type { DesignBriefCitation } from "@/lib/services/design-brief-service";
import type { IndustryBucket, ReferenceDirection } from "@/lib/design-references/reference-library";
import type { LayoutFamily } from "@/lib/design-intelligence/layout-rules";

import { DESIGN_PRINCIPLES } from "@/lib/design-intelligence/design-rules";
import { MAX_TYPE_FAMILIES, READABILITY } from "@/lib/design-intelligence/typography-rules";
import { MOTION_DURATION_BAND_MS, ALLOWED_EASING, BANNED_EASING_KEYWORDS } from "@/lib/design-intelligence/motion-rules";
import { NEVER_GENERATE_RULES } from "@/lib/design-intelligence/never-generate-rules";

/**
 * design-intelligence-service.ts — Founder Architecture Spec v1.0's
 * "Design Intelligence" engine: the ONLY creative-decision layer in the
 * pipeline, and the only one that talks to an LLM (docs/
 * ARCHITECTURE_SPECIFICATION_V1.md §2, §3). This module owns prompt
 * construction and response parsing/validation; it depends on lib/llm/'s
 * LlmProvider port, never a specific vendor SDK — Anthropic-specific code
 * lives only in lib/llm/anthropic-provider.ts, never here.
 *
 * Input boundary, enforced by this module's own function signatures, not
 * just documented: this service receives only already-computed structured
 * facts (citations, industry bucket, candidate reference directions) —
 * never raw HTML, never a live website, never anything design-brief-
 * service.ts's own deterministic helpers (buildCitations,
 * findWeakestMeasuredCategory, resolveIndustryBucket) haven't already
 * reduced to a plain fact. Design Intelligence decides direction; it does
 * not re-derive facts from raw analysis data itself.
 */

// ===========================================================================
// Design Memory — the persistent, per-mission source of truth downstream
// engines (Generation, QA) read from. Field categories per the founder's
// list; internal shapes are a reasonable first-pass structure, not a fixed
// final schema — refine once real model output has been seen (this is
// explicitly unverified against a live model, see design-brief-service.ts's
// wiring and docs/SPRINT_STATUS.md for why).
// ===========================================================================

export interface DesignMemory {
  typography: {
    headingFamily: string;
    bodyFamily: string;
    scaleNotes: string;
  };
  colorPalette: {
    primary: string;
    secondary: string;
    accent: string;
    neutral: string;
    notes: string;
  };
  spacingScale: {
    baseUnit: string;
    notes: string;
  };
  grid: {
    columns: number;
    notes: string;
  };
  borderRadius: string;
  shadows: string;
  icons: string;
  photographyStyle: string;
  motionLevel: string;
  ctaHierarchy: {
    primary: string;
    secondary: string;
  };
  componentVariants: string[];
  brandPersonality: string[];
  accessibilityTargets: string;
  seoPriorities: string[];
  contentTone: string;
  preferredLayouts: string[];
}

/** The creative-decision fields of a Design Brief the LLM is responsible for — the same shape as DesignBrief["direction"] plus targetAudience/positioning, deliberately excluding the evidence-trail fields (citedInsights, referencesConsidered, industryBucket) design-brief-service.ts computes deterministically and merges in itself. */
export interface DesignIntelligenceCreativeBrief {
  targetAudience: string;
  positioning: string;
  direction: {
    layoutFamily: LayoutFamily;
    typographicMood: string;
    colorDirection: string;
    motionIntensity: "restrained" | "energetic";
  };
}

export interface DesignIntelligenceResult {
  designBrief: DesignIntelligenceCreativeBrief;
  designMemory: DesignMemory;
  reasoning: string;
}

export interface DesignIntelligenceInput {
  businessName: string;
  industry: string | null;
  industryBucket: IndustryBucket;
  citedInsights: DesignBriefCitation[];
  weakestCategory: { category: AnalysisCategory; score: number } | null;
  candidateReferences: ReferenceDirection[];
}

const VALID_LAYOUT_FAMILIES: LayoutFamily[] = [
  "editorial",
  "imagery-led",
  "credibility-led",
  "schedule-led",
  "menu-led",
  "listing-led",
];

// ===========================================================================
// Prompt construction
// ===========================================================================

/**
 * The system prompt embeds lib/design-intelligence/'s actual rule
 * constants — not a paraphrase of them — so the model is constrained by
 * the same values design-qa-service.ts (Phase 3, not yet built) will
 * eventually check its output against. This is the concrete form of
 * "Obsidian owns the schema and discipline; each mission owns its own
 * values" (docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md §5): the
 * rules module defines the space of valid values, the LLM chooses within
 * it.
 */
function buildSystemPrompt(): string {
  const principles = DESIGN_PRINCIPLES.map((p) => `- ${p.statement}`).join("\n");
  const neverGenerate = NEVER_GENERATE_RULES.map((r) => `- Never: ${r.neverGenerate}`).join("\n");

  return `You are the Design Intelligence engine of Obsidian OS, an autonomous client-acquisition system. You are the ONLY creative-decision-making layer in this pipeline. You never write code, never crawl websites, and never perform quality assurance — you make direction decisions and record them.

Design principles you must follow:
${principles}

Rules you must never violate:
${neverGenerate}

Hard constraints on your output:
- At most ${MAX_TYPE_FAMILIES} type families.
- Body line length ${READABILITY.bodyLineLengthCharsMin}-${READABILITY.bodyLineLengthCharsMax} characters; body line-height ${READABILITY.bodyLineHeightMin}-${READABILITY.bodyLineHeightMax}x type size.
- Motion duration ${MOTION_DURATION_BAND_MS.min}-${MOTION_DURATION_BAND_MS.max}ms unless the business's category genuinely calls for a disclosed deviation. Allowed easing: ${ALLOWED_EASING.join(", ")}. Never: ${BANNED_EASING_KEYWORDS.join(", ")} easing, or motion with no functional purpose.
- layoutFamily must be exactly one of: ${VALID_LAYOUT_FAMILIES.join(", ")}.
- motionIntensity must be exactly "restrained" or "energetic".

You will be given real, structured facts about one specific business — cited Insights from its website analysis, its industry classification, and a small set of candidate reference directions. The reference directions are inspiration for your reasoning only — you must NEVER copy their structure, and your response must explain your direction in terms of THIS business's actual cited facts, not a generic template.

Respond with ONLY a single JSON object, no prose before or after it, no markdown code fences, matching exactly this shape:
{
  "designBrief": {
    "targetAudience": "string",
    "positioning": "string",
    "direction": {
      "layoutFamily": "one of the allowed values above",
      "typographicMood": "string",
      "colorDirection": "string",
      "motionIntensity": "restrained" or "energetic"
    }
  },
  "designMemory": {
    "typography": { "headingFamily": "string", "bodyFamily": "string", "scaleNotes": "string" },
    "colorPalette": { "primary": "string", "secondary": "string", "accent": "string", "neutral": "string", "notes": "string" },
    "spacingScale": { "baseUnit": "string", "notes": "string" },
    "grid": { "columns": number, "notes": "string" },
    "borderRadius": "string",
    "shadows": "string",
    "icons": "string",
    "photographyStyle": "string",
    "motionLevel": "string",
    "ctaHierarchy": { "primary": "string", "secondary": "string" },
    "componentVariants": ["string"],
    "brandPersonality": ["string"],
    "accessibilityTargets": "string",
    "seoPriorities": ["string"],
    "contentTone": "string",
    "preferredLayouts": ["string"]
  },
  "reasoning": "string explaining why you made these choices for this specific business"
}`;
}

function buildUserPrompt(input: DesignIntelligenceInput): string {
  const citations = input.citedInsights
    .map((c) => `- [${c.category}] ${c.statement}`)
    .join("\n");

  const weakest = input.weakestCategory
    ? `The business's most pressing measured gap is ${input.weakestCategory.category} at ${input.weakestCategory.score}/100.`
    : "No single measured gap stands out.";

  const references = input.candidateReferences
    .map(
      (r) =>
        `- ${r.id}: ${r.description} (layout family: ${r.layoutFamily}, typographic mood: ${r.typographicMood}, color direction: ${r.colorDirection}, positioning emphasis: ${r.positioningEmphasis})`
    )
    .join("\n");

  return `Business: ${input.businessName}
Industry (as recorded, may be imprecise): ${input.industry ?? "unknown"}
Industry bucket (already classified): ${input.industryBucket}

Cited findings from this business's website analysis (address these, do not invent others):
${citations}

${weakest}

Candidate reference directions for this industry bucket (inspiration for your reasoning only — never copy their structure):
${references}

Produce a Design Brief and Design Memory for this specific business, grounded in the facts above.`;
}

export function buildDesignIntelligencePrompt(input: DesignIntelligenceInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  return { systemPrompt: buildSystemPrompt(), userPrompt: buildUserPrompt(input) };
}

// ===========================================================================
// Response parsing/validation
// ===========================================================================

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * parseDesignIntelligenceResponse — real, structural validation of the
 * model's JSON output, per the founder's explicit instruction not to
 * assume a clean, well-shaped parse always succeeds. Throws a descriptive
 * error naming exactly what's wrong rather than silently coercing a
 * malformed response into something plausible-looking — the same
 * evidence-first instinct ADR-013 applies to report claims, applied here
 * to model output.
 */
export function parseDesignIntelligenceResponse(raw: string): DesignIntelligenceResult {
  const parsed = extractJsonFromLlmResponse(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Design Intelligence response was not a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;

  const designBrief = obj.designBrief as Record<string, unknown> | undefined;
  if (!designBrief || typeof designBrief !== "object") {
    throw new Error("Design Intelligence response is missing a \"designBrief\" object.");
  }
  if (!isNonEmptyString(designBrief.targetAudience)) {
    throw new Error("Design Intelligence response's designBrief.targetAudience must be a non-empty string.");
  }
  if (!isNonEmptyString(designBrief.positioning)) {
    throw new Error("Design Intelligence response's designBrief.positioning must be a non-empty string.");
  }

  const direction = designBrief.direction as Record<string, unknown> | undefined;
  if (!direction || typeof direction !== "object") {
    throw new Error("Design Intelligence response is missing \"designBrief.direction\".");
  }
  const layoutFamily = direction.layoutFamily;
  if (typeof layoutFamily !== "string" || !VALID_LAYOUT_FAMILIES.includes(layoutFamily as LayoutFamily)) {
    throw new Error(
      `Design Intelligence response's direction.layoutFamily must be one of ${VALID_LAYOUT_FAMILIES.join(", ")}; got ${JSON.stringify(layoutFamily)}.`
    );
  }
  const motionIntensity = direction.motionIntensity;
  if (motionIntensity !== "restrained" && motionIntensity !== "energetic") {
    throw new Error(
      `Design Intelligence response's direction.motionIntensity must be "restrained" or "energetic"; got ${JSON.stringify(motionIntensity)}.`
    );
  }
  if (!isNonEmptyString(direction.typographicMood) || !isNonEmptyString(direction.colorDirection)) {
    throw new Error("Design Intelligence response's direction.typographicMood and colorDirection must be non-empty strings.");
  }

  const designMemory = obj.designMemory;
  if (!designMemory || typeof designMemory !== "object") {
    throw new Error("Design Intelligence response is missing a \"designMemory\" object.");
  }

  if (!isNonEmptyString(obj.reasoning)) {
    throw new Error("Design Intelligence response's \"reasoning\" must be a non-empty string.");
  }

  return {
    designBrief: {
      targetAudience: designBrief.targetAudience as string,
      positioning: designBrief.positioning as string,
      direction: {
        layoutFamily: layoutFamily as LayoutFamily,
        typographicMood: direction.typographicMood as string,
        colorDirection: direction.colorDirection as string,
        motionIntensity,
      },
    },
    designMemory: designMemory as unknown as DesignMemory,
    reasoning: obj.reasoning as string,
  };
}

// ===========================================================================
// Orchestration — the only function that actually talks to an LlmProvider.
// ===========================================================================

const DESIGN_INTELLIGENCE_MAX_TOKENS = 4096;

/**
 * generateDesignIntelligence — builds the prompt, calls the injected
 * LlmProvider (never a specific vendor directly), and parses/validates the
 * result. This is the one function design-brief-service.ts's orchestration
 * calls; everything upstream of it (citation-building, industry-bucket
 * resolution, reference selection) stays in design-brief-service.ts as
 * deterministic fact-gathering, per §2's "Analysis only gathers facts"
 * principle applied one layer up to the facts THIS engine consumes.
 *
 * `onUsage`, when supplied, is passed straight through to the provider —
 * this is real spend once a live API key is configured, so callers that
 * want to log or track cost per call have a way to observe it without this
 * function needing to know anything about persistence or logging itself.
 */
export async function generateDesignIntelligence(
  provider: LlmProvider,
  input: DesignIntelligenceInput,
  onUsage?: (usage: LlmUsage) => void
): Promise<DesignIntelligenceResult> {
  const { systemPrompt, userPrompt } = buildDesignIntelligencePrompt(input);
  const raw = await provider.complete({
    systemPrompt,
    userPrompt,
    maxTokens: DESIGN_INTELLIGENCE_MAX_TOKENS,
    expectJson: true,
    onUsage,
  });
  return parseDesignIntelligenceResponse(raw);
}
