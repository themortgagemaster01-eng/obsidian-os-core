/**
 * Deterministic genericity detection (CTO Design Intelligence directive's
 * "Design Default Avoidance" + "Genericity Detection" sections). Two real,
 * mechanical checks, mirroring this codebase's existing precedent
 * (opportunity-report-service.ts's banned-terms test; layout-rules.ts's
 * matchesGenericSaasTemplate/findDuplicateSectionStructures):
 *
 * 1. A banned-phrase scanner over hollow marketing filler that carries no
 *    evidence of its own — the same "named, checkable pattern instead of a
 *    vibe" discipline §5 already applied to the generic-SaaS section order.
 * 2. A cross-mission duplicate-signature check, the Design Intelligence
 *    analogue of findDuplicateSectionStructures — two businesses landing on
 *    the identical heroThesis or signatureElement is a real distinctiveness
 *    failure even when their section order happens to differ.
 *
 * Neither check claims to catch every generic-feeling design (the directive
 * itself frames "not generic" as requiring an AI-derived judgment call too,
 * see design-qa-service.ts's genericTemplate category) — these are
 * deterministic proxies, not a complete guarantee.
 */

/**
 * Hollow marketing filler that carries no evidence of its own — phrases
 * that could be pasted onto any business's site unchanged and would still
 * "work," which is exactly what §8's evidence-first discipline (applied
 * here to design copy, not just factual claims) rules out. Deliberately
 * narrow: real, evidence-backed claims that happen to share a word with one
 * of these (e.g. "quality" alone) are not banned — only the specific hollow
 * phrasing is.
 */
export const BANNED_GENERIC_DESIGN_PHRASES: string[] = [
  "committed to quality",
  "committed to excellence",
  "your satisfaction is our",
  "customer satisfaction is our",
  "state-of-the-art",
  "cutting-edge",
  "unmatched quality",
  "unparalleled",
  "world-class service",
  "world class service",
  "we go above and beyond",
  "above and beyond for our customers",
  "customer-centric",
  "customer centric approach",
  "look no further",
  "your trusted partner",
  "your one-stop shop",
  "we pride ourselves",
  "quality you can trust",
  "service you can trust",
  "dedicated team of professionals",
  "passion for excellence",
  "welcome to",
];

/**
 * Scans free text for any banned generic phrase (case-insensitive substring
 * match, per the same simple/explainable discipline the Opportunity
 * Report's own banned-terms test uses). Returns every match found, not just
 * the first — a real evidence list for a QA finding, not a boolean.
 */
export function findGenericPhrases(text: string): string[] {
  const haystack = text.toLowerCase();
  return BANNED_GENERIC_DESIGN_PHRASES.filter((phrase) => haystack.includes(phrase));
}

export interface MissionDesignSignature {
  missionId: string;
  heroThesis: string;
  signatureElement: string;
}

/** Normalizes for comparison — case/whitespace shouldn't hide a real duplicate, and shouldn't manufacture a false one either. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The Design Intelligence analogue of layout-rules.ts's
 * findDuplicateSectionStructures: groups mission IDs whose heroThesis OR
 * signatureElement.element+justification normalize to the identical string
 * — a real distinctiveness failure (CTO directive's "if the business names
 * were removed, could a human still tell these were different businesses"
 * test) independent of whether their section order also matches.
 */
export function findDuplicateDesignSignatures(entries: MissionDesignSignature[]): {
  duplicateHeroThesis: string[][];
  duplicateSignatureElement: string[][];
} {
  const byHeroThesis = new Map<string, string[]>();
  const bySignatureElement = new Map<string, string[]>();

  for (const entry of entries) {
    // An empty heroThesis/signatureElement means "no data" (a mission whose
    // brief predates these fields, or a failed run) — never a real value to
    // compare against. Grouping on "" would flag every such legacy/failed
    // mission as a duplicate of every other one, which is noise, not a real
    // distinctiveness failure.
    const heroKey = normalize(entry.heroThesis);
    if (heroKey.length > 0) {
      const heroGroup = byHeroThesis.get(heroKey);
      if (heroGroup) heroGroup.push(entry.missionId);
      else byHeroThesis.set(heroKey, [entry.missionId]);
    }

    const sigKey = normalize(entry.signatureElement);
    if (sigKey.length > 0) {
      const sigGroup = bySignatureElement.get(sigKey);
      if (sigGroup) sigGroup.push(entry.missionId);
      else bySignatureElement.set(sigKey, [entry.missionId]);
    }
  }

  return {
    duplicateHeroThesis: [...byHeroThesis.values()].filter((g) => g.length > 1),
    duplicateSignatureElement: [...bySignatureElement.values()].filter((g) => g.length > 1),
  };
}
