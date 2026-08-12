import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";
import { extractJsonFromLlmResponse } from "@/lib/llm/json-response";

import type { AnalysisCategory } from "@/lib/services/analysis-types";
import type { DesignBriefCitation } from "@/lib/services/design-brief-service";
import type { ContactInfo, ContentSection, ReviewsSummary } from "@/lib/adapters/types";
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

/**
 * The fixed vocabulary of Signature Element treatments (CTO Design
 * Intelligence directive) Design Intelligence may choose from — each one
 * maps to a treatment design-generation-service.ts/the existing typed
 * renderer (components/design-preview/) can actually express today. This
 * module never invents a signature element the renderer can't render; the
 * directive's own "not decoration for its own sake" instruction is enforced
 * here as a real constraint, not just a prompt suggestion (parseDesignIntelligenceResponse
 * throws on any value outside this list).
 */
export const SIGNATURE_ELEMENT_VOCABULARY = [
  "authentic-photography-hero",
  "menu-editorial-presentation",
  "testimonial-editorial-treatment",
  "credibility-certification-display",
  "service-area-location-motif",
  "gallery-atmosphere-treatment",
  "listing-imagery-treatment",
  "schedule-energy-treatment",
  "faq-evidence-treatment",
  "service-list-editorial-treatment",
] as const;

export type SignatureElementId = (typeof SIGNATURE_ELEMENT_VOCABULARY)[number];

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
  /** CTO directive's Hero-as-Thesis standard — one sentence answering "why does this website belong to THIS business," grounded in real cited evidence. */
  heroThesis: string;
  /** CTO directive's Signature Element standard — one memorable, business-justified visual treatment, chosen from SIGNATURE_ELEMENT_VOCABULARY. */
  signatureElement: {
    element: SignatureElementId;
    justification: string;
  };
  /** Ranked (highest-priority first) list of the real evidence categories this specific business's design should emphasize — a subset of design-generation-service.ts's SectionType vocabulary, validated/applied there (this module has no dependency on that type, to avoid a circular import). */
  contentEmphasis: string[];
}

/**
 * The CTO directive's Pass 2 Self-Critique result — a second, independent
 * LLM judgment of Pass 1's output against the directive's self-critique
 * questions (the founder's original ten plus the Genericity Challenge/
 * Name-Swap/Human Designer Test amendment). Always additive/labeled, never silently blended into the
 * design (mirrors design-qa-service.ts's AI-derived-assessment discipline:
 * a real, separate judgment call, not folded into deterministic output).
 */
export interface DesignCritiqueResult {
  isGeneric: boolean;
  reasoning: string;
  recommendation: string | null;
}

/** Pass 1's raw output shape — what a single LLM call produces and parseDesignIntelligenceResponse validates. */
export interface DesignIntelligencePass1Result {
  designBrief: DesignIntelligenceCreativeBrief;
  designMemory: DesignMemory;
  reasoning: string;
}

/** Pass 2's outcome, always recorded — whether or not Pass 1's first output was ultimately used. Named/exported so design-brief-service.ts can persist it and Founder UI components can render it without duplicating the shape. */
export interface SelfCritique {
  initiallyFlaggedGeneric: boolean;
  reasoning: string;
  wasRevised: boolean;
}

/** The full two-pass result generateDesignIntelligence() returns — Pass 1's (possibly revised) output plus Pass 2's self-critique record, always present. */
export interface DesignIntelligenceResult extends DesignIntelligencePass1Result {
  selfCritique: SelfCritique;
}

export interface DesignIntelligenceInput {
  businessName: string;
  industry: string | null;
  industryBucket: IndustryBucket;
  citedInsights: DesignBriefCitation[];
  weakestCategory: { category: AnalysisCategory; score: number } | null;
  candidateReferences: ReferenceDirection[];
  /** Real, mechanically-extracted contact facts (design-brief-service.ts's own deterministic gathering) — told to the model explicitly so it never has to guess or imply contact evidence that was never actually captured (§8). */
  contactEvidence: ContactInfo;
  /** The business's own real, published homepage description — real content to ground heroThesis/positioning in, never a generic invented tagline (CTO directive's "prefer real evidence" hero standard). */
  metaDescription?: string | null;
  /** Real service/offering descriptions the crawler found — grounds signatureElement/contentEmphasis choices in what this business actually offers, not a guess. */
  services?: ContentSection[];
  /** Real, already-published client testimonials — when present, a legitimate signal that testimonial-editorial-treatment or contentEmphasis should prioritize testimonials. */
  testimonials?: ContentSection[];
  /** Real certifications/credentials the crawler found. */
  certifications?: ContentSection[];
  /** Real team/staff content the crawler found. */
  team?: ContentSection[];
  /** Real, already-published FAQ content the crawler found. */
  faqEvidence?: ContentSection[];
  /** Real review count/rating, when the crawl found structured review data. */
  reviews?: ReviewsSummary;
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

Design Brain — before answering, you must actually work through these ten questions using the real evidence given below. Do not begin from a generic "make it beautiful" instinct; begin from these:
1. What is distinctive about this business?
2. What evidence supports that interpretation?
3. Who is the likely visitor?
4. What is the primary job of the website (call, visit, book, request an estimate, review services, view menu, contact the firm — pick what's actually supported)?
5. What visual direction best communicates that job?
6. What typography supports that direction?
7. What color strategy supports it?
8. What layout structure supports it?
9. What real evidence should become visually dominant?
10. What ONE signature element makes this design memorable?

Evidence -> design mapping (use whichever of these actually apply, based on what evidence you were actually given below — never fabricate evidence to unlock a mapping): real photography suggests an image-led hospitality direction; a real menu suggests the menu becomes a major information-architecture element; real testimonials suggest trust/social-proof becomes a meaningful section; a real service list suggests services receive deliberate visual hierarchy; real location/history suggests a geographic or editorial treatment may become part of the identity. If no evidence exists for a category, do not invent it — build a strong, honest direction from whatever evidence actually exists rather than defaulting to filler.

Genericity Challenge — before finalizing your answer, silently identify the most obvious generic AI-generated version of this exact business's website (a generic SaaS layout, a centered hero with two buttons, a purple/blue gradient, three feature cards, generic Inter-only typography, excessive rounded cards, generic stock imagery, repeated identical testimonial cards, a generic "Welcome to..." headline). Then ask yourself: would your direction still make just as much sense if this business's name were swapped for a different business in the same industry? If yes, your direction is too generic — revise it before answering, using the real evidence given below to make it specific to this business.

Constraints over vibes: never justify a choice with a vague word like "beautiful," "modern," or "premium" alone — every value you produce (typographicMood, colorDirection, signatureElement, componentVariants, etc.) must be a concrete, explainable choice a human designer could defend in one sentence, tied to the real evidence below.

Contact-evidence honesty rule, non-negotiable: you will be told exactly which contact facts (phone, email, address, hours) have been verified by crawling this business's real website. For any field NOT listed as verified, you must never claim, imply, or promise that it is present, prominent, findable, "impossible to miss," or otherwise available — not in "positioning," not in "direction," not anywhere in your response. You may recommend that the contact section be clear and easy to find in general terms (e.g. "make the way to reach us obvious"), but you must never assert a specific unverified phone number, email, address, or hours exists. Only reference a specific contact fact by claiming its prominence if it is explicitly listed as verified below.

Hard constraints on your output:
- At most ${MAX_TYPE_FAMILIES} type families.
- Body line length ${READABILITY.bodyLineLengthCharsMin}-${READABILITY.bodyLineLengthCharsMax} characters; body line-height ${READABILITY.bodyLineHeightMin}-${READABILITY.bodyLineHeightMax}x type size.
- Motion duration ${MOTION_DURATION_BAND_MS.min}-${MOTION_DURATION_BAND_MS.max}ms unless the business's category genuinely calls for a disclosed deviation. Allowed easing: ${ALLOWED_EASING.join(", ")}. Never: ${BANNED_EASING_KEYWORDS.join(", ")} easing, or motion with no functional purpose.
- layoutFamily must be exactly one of: ${VALID_LAYOUT_FAMILIES.join(", ")}.
- motionIntensity must be exactly "restrained" or "energetic".
- signatureElement.element must be exactly one of: ${SIGNATURE_ELEMENT_VOCABULARY.join(", ")} — pick the one that is genuinely justified by this business's real evidence below, never the first one or a default; if none is strongly justified, pick the closest fit and say so honestly in the justification rather than inventing a stronger connection than the evidence supports.

You will be given real, structured facts about one specific business — cited Insights from its website analysis, its industry classification, real content the business itself already publishes (services, testimonials, certifications, team, FAQ, reviews, its own homepage description) when the crawler found any, and a small set of candidate reference directions. The reference directions are inspiration for your reasoning only — you must NEVER copy their structure. Ground heroThesis, signatureElement, and contentEmphasis in the REAL content you were given, not in the industry bucket alone — two businesses in the same industry bucket must still read as genuinely different from each other when their real evidence differs, because their evidence differs, not because you varied colors arbitrarily.

heroThesis: ONE SHORT, PUNCHY sentence (aim for under 20 words — a real headline a visitor reads in one glance, not an analytical paragraph) answering "why does this website belong to THIS business and not a competitor's" — must be traceable to a specific real fact given below (a cited finding, a real testimonial, a real service, real evidence of longevity/specialty/location), never a generic claim like "quality service" or "your trusted partner." Save any fuller explanation of your reasoning for the separate "reasoning" field below — heroThesis itself is what gets rendered as large hero display text, so a long, multi-clause justification crammed into it renders as an oversized wall of text, especially on mobile.

contentEmphasis: an ordered list (highest priority first, 1-3 entries) of which of these categories this business's real evidence most supports emphasizing: services, testimonials, credibility, menu, gallery, schedule, listings, serviceArea, faq. Only include a category if real evidence for it was actually given to you below — never guess one into emphasis with no backing content.

Keep every string value concise — 1-3 sentences each, "reasoning" up to one short paragraph. This is a direction brief, not a full essay; a shorter, complete response is far more useful than a longer one that gets cut off before it finishes.

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
    },
    "heroThesis": "string",
    "signatureElement": { "element": "one of the allowed values above", "justification": "string" },
    "contentEmphasis": ["string", "..."]
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

/** Renders contactEvidence as an explicit verified/not-verified list for the prompt — never a summary that could blur "captured" and "not captured" together. */
function describeContactEvidence(contact: ContactInfo): string {
  const lines = [
    contact.phones.length > 0 ? `- Phone: VERIFIED — ${contact.phones[0]}` : "- Phone: not verified — do not claim or imply one exists.",
    contact.emails.length > 0 ? `- Email: VERIFIED — ${contact.emails[0]}` : "- Email: not verified — do not claim or imply one exists.",
    contact.address ? `- Address: VERIFIED — ${contact.address}` : "- Address: not verified — do not claim or imply one exists.",
    contact.hours ? `- Hours: VERIFIED — ${contact.hours}` : "- Hours: not verified — do not claim or imply they exist.",
  ];
  return lines.join("\n");
}

/** Renders a ContentSection[] list for the prompt, or an honest "none found" line — never silently omitted, so the model can't accidentally assume evidence exists that it was never given. */
function describeContentSections(label: string, sections: ContentSection[] | undefined): string {
  if (!sections || sections.length === 0) return `- ${label}: none found by the crawler.`;
  const lines = sections.slice(0, 6).map((s) => `  - "${s.heading}": ${s.excerpt}`);
  return `- ${label} (real, from ${sections[0].sourceUrl}${sections.length > 1 ? " and other pages" : ""}):\n${lines.join("\n")}`;
}

function describeReviews(reviews: ReviewsSummary | undefined): string {
  if (!reviews || (reviews.averageRating === null && reviews.count === null)) {
    return "- Reviews: none found by the crawler.";
  }
  const rating = reviews.averageRating !== null ? `${reviews.averageRating} average rating` : "rating unknown";
  const count = reviews.count !== null ? `${reviews.count} reviews` : "count unknown";
  return `- Reviews (real, ${reviews.source ?? "source unspecified"}): ${rating}, ${count}.`;
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

Verified contact evidence from this business's real website (per the contact-evidence honesty rule above):
${describeContactEvidence(input.contactEvidence)}

Real content this business already publishes on its own website (use this to ground heroThesis, signatureElement, and contentEmphasis — never invent content beyond what's listed here):
${input.metaDescription ? `- Homepage description (real, published by the business): "${input.metaDescription}"` : "- Homepage description: none found by the crawler."}
${describeContentSections("Services/offerings", input.services)}
${describeContentSections("Testimonials", input.testimonials)}
${describeContentSections("Certifications/credentials", input.certifications)}
${describeContentSections("Team", input.team)}
${describeContentSections("FAQ", input.faqEvidence)}
${describeReviews(input.reviews)}

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
export function parseDesignIntelligenceResponse(raw: string): DesignIntelligencePass1Result {
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

  if (!isNonEmptyString(designBrief.heroThesis)) {
    throw new Error("Design Intelligence response's designBrief.heroThesis must be a non-empty string.");
  }

  const signatureElement = designBrief.signatureElement as Record<string, unknown> | undefined;
  if (!signatureElement || typeof signatureElement !== "object") {
    throw new Error("Design Intelligence response is missing \"designBrief.signatureElement\".");
  }
  const signatureElementId = signatureElement.element;
  if (typeof signatureElementId !== "string" || !SIGNATURE_ELEMENT_VOCABULARY.includes(signatureElementId as SignatureElementId)) {
    throw new Error(
      `Design Intelligence response's signatureElement.element must be one of ${SIGNATURE_ELEMENT_VOCABULARY.join(", ")}; got ${JSON.stringify(signatureElementId)}.`
    );
  }
  if (!isNonEmptyString(signatureElement.justification)) {
    throw new Error("Design Intelligence response's signatureElement.justification must be a non-empty string.");
  }

  const contentEmphasisRaw = designBrief.contentEmphasis;
  if (!Array.isArray(contentEmphasisRaw) || !contentEmphasisRaw.every((v) => isNonEmptyString(v))) {
    throw new Error("Design Intelligence response's designBrief.contentEmphasis must be an array of non-empty strings.");
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
      heroThesis: designBrief.heroThesis as string,
      signatureElement: {
        element: signatureElementId as SignatureElementId,
        justification: signatureElement.justification as string,
      },
      contentEmphasis: contentEmphasisRaw as string[],
    },
    designMemory: designMemory as unknown as DesignMemory,
    reasoning: obj.reasoning as string,
  };
}

// ===========================================================================
// Pass 2 — Self-Critique (CTO Design Intelligence directive's Two-Pass
// Design Process). A second, independent LLM call that evaluates Pass 1's
// output against the directive's self-critique questions and returns a
// real verdict — never a rubber stamp folded into Pass 1's own response,
// since a model grading its own single response is not an independent
// check. Mirrors design-qa-service.ts's "AI-derived assessment" discipline:
// additive, labeled, never silently blended into what generation actually
// uses unless a revision is genuinely warranted.
// ===========================================================================

const SELF_CRITIQUE_QUESTIONS = [
  "Would this design look basically the same for another business in a different industry, or even a different business in the SAME industry bucket?",
  "Is the direction actually derived from the real evidence given, or could it have been produced with zero knowledge of this specific business?",
  "Is the hero thesis specific to this business, or would it read as true of almost any business in this industry?",
  "Is the typography/color direction an intentional choice tied to real evidence, or a default (vague words like \"beautiful,\" \"modern,\" or \"premium\" alone are not a real justification)?",
  "Is the signature element genuinely justified by real evidence, or decoration chosen to look creative?",
  "Is contentEmphasis driven by which real evidence actually exists, or guessed?",
  "The Genericity Challenge: what would the most obvious generic AI-generated version of this exact business's website look like — a generic SaaS layout, a centered hero with two buttons, a purple/blue gradient, three feature cards, generic Inter-only typography, excessive rounded cards, generic stock imagery, repeated identical testimonial cards, a generic \"Welcome to...\" headline? Does this direction clearly avoid that, for a real, stated reason tied to this business — not just superficially?",
  "The Name-Swap Test: would this design direction still make just as much sense if this business's name were swapped for a different business in the same industry? If yes, it has failed — the direction is not actually specific to this business.",
  "Is there any claim in positioning/heroThesis/signatureElement.justification that isn't traceable to the evidence given?",
  "Is the complexity of the direction appropriate to how much real evidence actually exists for this business?",
  "The Human Designer Test: if a human designer presented this direction to the business owner, could they explain WHY every major visual decision was made, in one sentence each? The goal is maximum intentionality, not maximum decoration.",
] as const;

function buildCritiqueSystemPrompt(): string {
  return `You are the Self-Critique pass of Obsidian OS's Design Intelligence engine — an independent quality check on a Design Direction another pass of yourself already produced for a specific business. You did not write the direction under review; your only job is to judge it honestly against these questions, per the founder's directive that "if the answer suggests the design is generic, revise the design direction — do not simply proceed":

${SELF_CRITIQUE_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Judge strictly. A direction that merely varies color/typography without being traceable to this specific business's real evidence should be flagged generic, even if it looks superficially polished. A direction that is genuinely grounded in the real evidence given — even a simple one, when little evidence exists — should NOT be flagged generic; do not demand decoration the evidence doesn't support.

Keep "reasoning" concise — 2-4 sentences covering the strongest points from the questions above, not an exhaustive answer to every one. A shorter, complete response is far more useful than a longer one that gets cut off before its closing quote and brace.

Respond with ONLY a single JSON object, no prose before or after, no markdown fences, matching exactly this shape:
{
  "isGeneric": true or false,
  "reasoning": "string — your honest assessment against the questions above, including the Genericity Challenge and Name-Swap Test, 2-4 sentences",
  "recommendation": "string — what specifically should change if isGeneric is true, or null if false"
}`;
}

function buildCritiquePrompt(input: DesignIntelligenceInput, pass1: DesignIntelligencePass1Result): string {
  return `Business: ${input.businessName} (industry bucket: ${input.industryBucket})

Real evidence this business's direction was supposed to be grounded in:
${describeContentSections("Services/offerings", input.services)}
${describeContentSections("Testimonials", input.testimonials)}
${describeContentSections("Certifications/credentials", input.certifications)}
${describeReviews(input.reviews)}
Cited findings:
${input.citedInsights.map((c) => `- [${c.category}] ${c.statement}`).join("\n")}

The Design Direction produced for this business, to be evaluated:
- targetAudience: ${pass1.designBrief.targetAudience}
- positioning: ${pass1.designBrief.positioning}
- heroThesis: ${pass1.designBrief.heroThesis}
- layoutFamily: ${pass1.designBrief.direction.layoutFamily}
- typographicMood: ${pass1.designBrief.direction.typographicMood}
- colorDirection: ${pass1.designBrief.direction.colorDirection}
- signatureElement: ${pass1.designBrief.signatureElement.element} — ${pass1.designBrief.signatureElement.justification}
- contentEmphasis: ${pass1.designBrief.contentEmphasis.join(", ")}

Evaluate this direction against your questions, including the Genericity Challenge and Name-Swap Test.`;
}

function parseCritiqueResponse(raw: string): DesignCritiqueResult {
  const parsed = extractJsonFromLlmResponse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Design Intelligence self-critique response was not a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.isGeneric !== "boolean") {
    throw new Error("Design Intelligence self-critique response's \"isGeneric\" must be a boolean.");
  }
  if (!isNonEmptyString(obj.reasoning)) {
    throw new Error("Design Intelligence self-critique response's \"reasoning\" must be a non-empty string.");
  }
  const recommendation = obj.recommendation;
  if (recommendation !== null && !isNonEmptyString(recommendation)) {
    throw new Error("Design Intelligence self-critique response's \"recommendation\" must be a non-empty string or null.");
  }
  return {
    isGeneric: obj.isGeneric,
    reasoning: obj.reasoning,
    recommendation: (recommendation as string | null) ?? null,
  };
}

/**
 * A live five-industry validation run hit this ceiling at the previous
 * value (1024) repeatedly — the same truncation failure mode already
 * documented twice elsewhere in this codebase (Design Intelligence Pass 1
 * at 4096, design-qa-service.ts's AI-derived assessment at 4096), both
 * fixed the same way: raise with real headroom, pair with an explicit
 * concision instruction (above) rather than just raising the ceiling
 * further. The amended, longer self-critique question set (Genericity
 * Challenge/Name-Swap/Human Designer Test) made the model's real reasoning
 * responses long enough to make 1024 unsafe.
 */
const CRITIQUE_MAX_TOKENS = 4096;

/** critiqueDesignDirection — Pass 2's entry point. A separate LlmProvider call from Pass 1's, so the critique is a genuinely independent judgment, not the same completion reused. */
export async function critiqueDesignDirection(
  provider: LlmProvider,
  input: DesignIntelligenceInput,
  pass1: DesignIntelligencePass1Result,
  onUsage?: (usage: LlmUsage) => void
): Promise<DesignCritiqueResult> {
  const raw = await provider.complete({
    systemPrompt: buildCritiqueSystemPrompt(),
    userPrompt: buildCritiquePrompt(input, pass1),
    maxTokens: CRITIQUE_MAX_TOKENS,
    expectJson: true,
    onUsage,
  });
  return parseCritiqueResponse(raw);
}

/** Appended to Pass 1's own user prompt for the one bounded revision attempt — gives the model the critique's concrete recommendation rather than asking it to guess what was wrong. */
function buildRevisionPrompt(input: DesignIntelligenceInput, critique: DesignCritiqueResult): string {
  return `${buildUserPrompt(input)}

A prior attempt at this Design Direction was reviewed and flagged as too generic: "${critique.reasoning}" Specific recommendation: ${critique.recommendation ?? "make the direction more specifically traceable to this business's real evidence."}

Produce a REVISED Design Brief and Design Memory that addresses this feedback directly — ground heroThesis, signatureElement, and contentEmphasis more specifically in the real evidence given above.`;
}

// ===========================================================================
// Orchestration — the only functions that actually talk to an LlmProvider.
// ===========================================================================

/**
 * A live smoke test against the real API (docs/SPRINT_STATUS.md) hit this
 * ceiling mid-JSON at the previous value (4096) — the model's response was
 * truncated before the object closed, which surfaced as a JSON parse
 * error, not a token-limit error, since the API itself doesn't fail the
 * request for hitting max_tokens. Raised with headroom; paired with an
 * explicit concision instruction in the system prompt (above) to control
 * both truncation risk and cost, rather than just raising the ceiling
 * further.
 */
const DESIGN_INTELLIGENCE_MAX_TOKENS = 8192;

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
  const pass1 = parseDesignIntelligenceResponse(raw);

  const critique = await critiqueDesignDirection(provider, input, pass1, onUsage);

  if (!critique.isGeneric) {
    return { ...pass1, selfCritique: { initiallyFlaggedGeneric: false, reasoning: critique.reasoning, wasRevised: false } };
  }

  // One bounded revision attempt — per the directive's "revise, do not simply
  // proceed" instruction. If the revised call itself fails to parse, that's
  // a real error surfaced to the caller like any other LLM failure; this
  // function does not silently fall back to the flagged-generic Pass 1
  // output on a revision failure.
  const revisedRaw = await provider.complete({
    systemPrompt,
    userPrompt: buildRevisionPrompt(input, critique),
    maxTokens: DESIGN_INTELLIGENCE_MAX_TOKENS,
    expectJson: true,
    onUsage,
  });
  const revised = parseDesignIntelligenceResponse(revisedRaw);

  return {
    ...revised,
    selfCritique: { initiallyFlaggedGeneric: true, reasoning: critique.reasoning, wasRevised: true },
  };
}
