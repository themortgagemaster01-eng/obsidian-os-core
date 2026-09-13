/**
 * lib/services/no-website-evidence-gate.ts — the hard safety gate Robert's
 * locked spec requires before ANY LLM call or customer-facing preview
 * generation for a no-website lead ("OBSIDIAN OS — NO-WEBSITE EVIDENCE GATE
 * + UNIFIED CREATIVE PIPELINE", §1).
 *
 * A pure, deterministic function — no database call, no LLM, no network
 * fetch — same shape as identity-verification-service.ts's
 * verifyBusinessIdentity, which this module deliberately mirrors (a
 * three-tier verdict, never a brittle boolean) without importing from it:
 * this is a narrower, independent check over a completely different
 * evidence source (verified discovery facts, not a crawl), and per
 * CLAUDE.md's "services have one job each," it stays its own small file
 * rather than a branch bolted onto identity verification.
 *
 * Minimum evidence bar (Robert's own, non-negotiable): a no-website lead is
 * eligible for creative generation only if it has at least one of a
 * verified business-specific phone number OR a specific street address.
 * Business name, industry/category, town/city, geocoded coordinates, and
 * generic search-area information are explicitly NOT sufficient on their
 * own — real, currently-discovered leads (Skyline Towing, Frasers Hardware,
 * Keller William Realty Partners) have exactly that thin profile today,
 * which is precisely the case this gate exists to catch.
 */

export type NoWebsiteEvidenceVerdict = "CONFIRMED" | "UNCERTAIN" | "FAILED";

export interface NoWebsiteEvidenceInput {
  businessName: string;
  /** leads.discovery_phone — null when never captured, never treated as a mismatch, only as absent evidence. */
  phone: string | null;
  /** leads.discovery_address — same discipline as phone. */
  address: string | null;
}

export interface NoWebsiteEvidenceResult {
  verdict: NoWebsiteEvidenceVerdict;
  reason: string;
}

function isNonEmpty(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * evaluateNoWebsiteEvidence — deterministic, no LLM involved (Robert's own
 * explicit instruction: "Keep the evidence gate deterministic. Do not use
 * an LLM to decide whether the evidence is sufficient.").
 *
 * FAILED is reserved for a genuine data-integrity problem — no business
 * name on record at all, which should never happen for a real lead but
 * would make it unsafe to build anything, since there would be nothing to
 * even honestly label a preview with. UNCERTAIN is the common, expected
 * outcome for a real but thinly-tagged OSM lead (name + category + a
 * town-level geocode only, no phone or address) — not a failure of the
 * business, a failure of available evidence. CONFIRMED requires a real,
 * verified phone number or street address beyond the generic search-area
 * information that is never, by itself, sufficient.
 */
export function evaluateNoWebsiteEvidence(input: NoWebsiteEvidenceInput): NoWebsiteEvidenceResult {
  if (!isNonEmpty(input.businessName)) {
    return {
      verdict: "FAILED",
      reason: "No business name on record — cannot safely build a preview without knowing what business this is for.",
    };
  }

  const hasPhone = isNonEmpty(input.phone);
  const hasAddress = isNonEmpty(input.address);

  if (hasPhone || hasAddress) {
    const parts = [
      hasPhone ? `a verified phone number (${input.phone})` : null,
      hasAddress ? `a specific street address (${input.address})` : null,
    ].filter((v): v is string => v !== null);
    return {
      verdict: "CONFIRMED",
      reason: `Business-specific evidence on record: ${parts.join(" and ")}.`,
    };
  }

  return {
    verdict: "UNCERTAIN",
    reason:
      "Only a business name, category, and general area are on record — no verified phone number or street address. " +
      "Insufficient business evidence to safely build a preview yet.",
  };
}
