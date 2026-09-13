/**
 * lib/design-render/cta-label.ts — Fix #10 (Design Intelligence -> Production
 * Decisions Audit): the bounded, deterministic resolver that finally connects
 * DesignMemory.ctaHierarchy.primary — real, per-business CTA reasoning the
 * model already produces on every mission — to the actual rendered hero CTA
 * label.
 *
 * The gap this closes, confirmed against real live production data during the
 * read-only audit: four of six real missions had the model explicitly reason
 * that calling a specific, verified phone number was the strongest primary
 * action (Carriage House Mahopac's "Call 845-803-8728", Countryside Kitchen's
 * "Call 845-803-8420", Dante's Trattoria's "Call the restaurant (verified
 * phone 845-621-9654)...", The Freight House Cafe's "Call the cafe
 * directly..."), and every single one rendered the identical hardcoded
 * "Get in Touch" instead. The reasoning was generated, persisted, shown to
 * the founder, checked by QA for non-emptiness — and then discarded before it
 * ever reached a visitor.
 *
 * Architecture: the exact same discipline lib/design-render/safe-css.ts's
 * toSafeCssColor/toSafeFontFamilyStack already established for the other
 * free-text DesignMemory fields — a small, closed, deterministic vocabulary
 * matched against real model output, never an LLM call, never a
 * general-purpose natural-language parser, never fuzzy semantic inference,
 * never randomness. Anything this resolver cannot confidently and safely
 * reduce to a short button label falls back to the exact legacy string, so
 * the previous behavior remains reachable and unchanged for every input the
 * bounded vocabulary doesn't recognize.
 *
 * Evidence safety (the reason the renderer originally hardcoded a generic
 * label at all — see components/design-preview/design-preview.tsx's
 * TouchAffordance comment): this resolver never invents a phone number, an
 * email address, a reservation/ordering system, or any other business
 * capability. A phone number is only ever rendered when those exact digits
 * are literally present in the CTA source text itself; nothing is inferred
 * from another DesignMemory field, looked up, reformatted, or completed.
 */

/**
 * The exact pre-Fix-#10 hardcoded hero CTA label. Preserved verbatim as the
 * fallback for every input the bounded vocabulary can't safely reduce — so a
 * mission whose ctaHierarchy.primary is missing, explanatory prose, or simply
 * unrecognized renders byte-identically to how it rendered before this fix.
 */
export const LEGACY_HERO_CTA_LABEL = "Get in Touch";

/**
 * The closed set of CTA intents this resolver recognizes. Deliberately small
 * and explicit — every entry traces to either a real observed production CTA
 * pattern or the founder's own named action vocabulary for this fix; nothing
 * here is a speculative category invented to look complete.
 */
type CtaIntent =
  | "call"
  | "email"
  | "reserve"
  | "book"
  | "schedule"
  | "view-menu"
  | "view-listing"
  | "order"
  | "inquire"
  | "contact";

/**
 * Intent is recognized ONLY from the leading action of the CTA source, never
 * from a keyword appearing anywhere inside it. This is what separates real
 * CTA copy ("Call the restaurant...", "Email the shop...") from explanatory
 * prose that merely mentions those words — the exact discriminator the real
 * Brooklyn Organic Kitchen case demands: its own real ctaHierarchy.primary
 * ("A single clear 'Get in touch' action point, phrased generically... without
 * asserting any specific unverified phone, email, or address") contains both
 * "phone" and "email", but is a description OF a CTA rather than CTA copy, and
 * must correctly fall through to the legacy generic label. Order matters only
 * where two patterns share a leading word ("view menu" / "view listing").
 */
const LEADING_ACTION_PATTERNS: { intent: CtaIntent; pattern: RegExp }[] = [
  { intent: "view-menu", pattern: /^view\s+(?:the\s+|our\s+)?menu\b/ },
  { intent: "view-listing", pattern: /^view\s+(?:the\s+|our\s+)?listing/ },
  { intent: "call", pattern: /^call\b/ },
  { intent: "email", pattern: /^e-?mail\b/ },
  { intent: "reserve", pattern: /^reserve\b/ },
  { intent: "book", pattern: /^book\b/ },
  { intent: "schedule", pattern: /^schedule\b/ },
  { intent: "order", pattern: /^order\b/ },
  { intent: "inquire", pattern: /^inquire\b/ },
  { intent: "contact", pattern: /^contact\b/ },
];

/**
 * The short label each intent collapses to when the source itself is longer
 * explanatory CTA reasoning rather than already-short button copy. Each one
 * is deliberately generic WITHIN its intent — "Order Now", never "Order
 * Online", and "Reserve Now", never "Reserve a Table" — because asserting an
 * online ordering system or a table-reservation system the evidence never
 * established is exactly the fabrication this codebase's §8 discipline
 * forbids. A source that genuinely says "Order online" reaches that wording
 * through the short-copy path below, from the business's own real text, not
 * from this table.
 */
const FIXED_LABEL_BY_INTENT: Record<CtaIntent, string> = {
  call: "Call Now",
  email: "Email Us",
  reserve: "Reserve Now",
  book: "Book Now",
  schedule: "Schedule Now",
  "view-menu": "View Menu",
  "view-listing": "View Listing",
  order: "Order Now",
  inquire: "Inquire Now",
  // "contact" intent IS the legacy generic action — same string, deliberately.
  contact: LEGACY_HERO_CTA_LABEL,
};

/**
 * A conservative North-American phone-number shape. Requires a full 10-digit
 * number with consistent separators — a bare 4-digit year ("since 1994"), a
 * street number, or a price can never match it. Never reformatted: whatever
 * the source actually wrote is what renders, so no digit is ever added,
 * dropped, or rearranged by this module.
 */
const PHONE_TOKEN = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/;

/** Markers that a string is explanatory prose rather than button copy — parentheses, clause separators, or sentence punctuation. */
const PROSE_MARKERS = /[(),;:—–]|\.\s|\.$/;

const MAX_CTA_LABEL_WORDS = 5;
const MAX_CTA_LABEL_CHARS = 32;

/**
 * True only for a string already short enough to BE a button label — the
 * model does sometimes write ctaHierarchy.primary as literal CTA copy
 * ("Reserve a table", "Book now"), and in that case the business's own real
 * wording is better than anything this module could substitute for it. Long
 * or punctuated input is explanatory reasoning and never renders verbatim.
 */
function isShortButtonCopy(raw: string): boolean {
  if (raw.length > MAX_CTA_LABEL_CHARS) return false;
  if (raw.trim().split(/\s+/).length > MAX_CTA_LABEL_WORDS) return false;
  return !PROSE_MARKERS.test(raw);
}

/** Small words that stay lowercase inside a title-cased label (never the first word). */
const TITLE_CASE_MINOR_WORDS = new Set(["a", "an", "the", "at", "by", "for", "in", "of", "on", "or", "to", "and", "with"]);

function toButtonTitleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && TITLE_CASE_MINOR_WORDS.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * resolveHeroCtaLabel — the single entry point. Deterministic and pure: the
 * same input always produces the same output, with no I/O, no randomness, and
 * no dependency on anything but the string it is given. Both the renderer
 * (components/design-preview/design-preview.tsx) and QA
 * (lib/services/design-qa-service.ts) call THIS function rather than
 * duplicating its logic, so the rendered label and the label QA verifies can
 * never silently drift apart — which is precisely the class of disconnect
 * this fix exists to end.
 */
export function resolveHeroCtaLabel(ctaPrimary: string | undefined | null): string {
  const raw = ctaPrimary?.trim();
  if (!raw) return LEGACY_HERO_CTA_LABEL;

  const matched = LEADING_ACTION_PATTERNS.find(({ pattern }) => pattern.test(raw.toLowerCase()));
  if (!matched) return LEGACY_HERO_CTA_LABEL;

  // Call intent is the one case that can carry a real, specific value onto
  // the button — and only ever digits literally present in this same string.
  if (matched.intent === "call") {
    const phone = raw.match(PHONE_TOKEN);
    return phone ? `Call ${phone[0].trim()}` : FIXED_LABEL_BY_INTENT.call;
  }

  if (isShortButtonCopy(raw)) return toButtonTitleCase(raw);
  return FIXED_LABEL_BY_INTENT[matched.intent];
}
