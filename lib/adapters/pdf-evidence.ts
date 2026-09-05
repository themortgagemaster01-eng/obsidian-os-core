import { extractText, getDocumentProxy } from "unpdf";

import type { MenuCategory, MenuItem } from "@/lib/adapters/types";

/**
 * lib/adapters/pdf-evidence.ts — Phase 13 (docs/PHASE_13_PDF_EVIDENCE_SCOPE.md,
 * docs/PHASE_13_IMPLEMENTATION_PLAN.md). Isolated, I/O-adjacent module (CLAUDE.md's
 * "adapters are I/O only, one job each"): the crawl adapter's own sub-page fetch
 * loop (crawl-adapter.ts) calls into this file once it has already decided, from
 * the response's real Content-Type header, that a same-origin URL is a PDF —
 * detection itself stays in crawl-adapter.ts, not here.
 *
 * Everything below produces the exact same MenuCategory/MenuItem shape
 * findMenuItemsByStructure (crawl-adapter.ts) already produces from HTML — no
 * new evidence type, only a new producer of an existing one, so every
 * downstream consumer (mergeMenu, NormalizedAnalysis, DesignBrief, Wireframe
 * slot-building, rendering) receives it unmodified (Phase 13 Implementation
 * Plan §7/§11).
 */

/** 20MB — well above both real Carriage House Mahopac PDFs (77KB/24KB) confirmed during this phase's own investigation; a resource-safety guard against a pathological same-origin PDF, not a product decision. */
export const MAX_PDF_BYTES = 20_000_000;

export type PdfTextExtractionResult = { text: string } | { error: "no-text-layer" | "extraction-failed" };

/**
 * Wraps unpdf's extractText/getDocumentProxy. Returns `{ error: "no-text-layer" }`
 * when unpdf parses the PDF's structure successfully but finds no extractable
 * text at all (the scanned/image-only case — OCR is out of scope for this
 * phase, see the scope doc's §3) — distinct from `{ error: "extraction-failed" }`,
 * which is a genuinely corrupt/malformed PDF unpdf itself threw on. Both are
 * honest, named outcomes the caller records in CrawlRawResult.unparsedDocuments
 * rather than letting either collapse into the same empty result a business
 * with no such document produces.
 */
export async function extractPdfText(bytes: ArrayBuffer): Promise<PdfTextExtractionResult> {
  try {
    const proxy = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(proxy, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join("\n") : text).trim();
    if (merged.length === 0) {
      return { error: "no-text-layer" };
    }
    return { text: merged };
  } catch {
    // A malformed/corrupt PDF, or one unpdf otherwise can't parse — the same
    // "one document's failure never takes down the rest of the crawl" honesty
    // the existing HTML sub-page loop already applies (crawl-adapter.ts's own
    // try/catch around extractStructuredFacts).
    return { error: "extraction-failed" };
  }
}

// ===========================================================================
// Text-based menu/price-list structural detection — the PDF-text analogue of
// crawl-adapter.ts's findMenuItemsByStructure. A PDF's extracted text has no
// DOM (no elements, no siblings, no parents), so this is a new detector, not
// a reuse of that function — but it targets the exact same real-world SHAPE
// (a short name, immediately followed by a real price the business itself
// published, repeated) and produces the identical MenuCategory/MenuItem
// output shape. Constants below intentionally mirror crawl-adapter.ts's own
// DOM-detector thresholds (MIN_MENU_ITEMS_FOR_REAL_MENU, MAX_MENU_CATEGORIES,
// etc.) — same concept, same numbers, kept as this module's own copy rather
// than imported, so this file has no dependency on crawl-adapter.ts and stays
// independently testable (crawl-adapter.ts is the one that imports THIS file,
// not the reverse).
//
// Deliberately does NOT attempt multi-line description capture. Validated
// directly against the two real Carriage House Mahopac PDFs during this
// phase's own investigation: a real item's description reliably spans a
// variable 0-2 lines, and the same short, capitalized-but-not-ALL-CAPS shape
// that marks a genuine one-line description ("Roasted Garlic Aioli") is
// structurally indistinguishable, from plain text alone, from a second
// consecutive description line belonging to a DIFFERENT, later item — there
// is no DOM parent/sibling boundary here to disambiguate them the way
// findMenuItemsByStructure's own container-consumption logic does. Rather
// than risk attaching a real description fragment to the wrong dish, this
// detector captures name + price only (MenuItem.description stays null,
// confidence stays "medium" — the same honest floor findMenuItemsByStructure
// already uses for a name+price pair with no description). A disclosed
// limitation, not a silent gap — the same discipline crawl-adapter.ts's own
// comment on price RANGES already models for this exact detector family.
// ===========================================================================

/** Mirrors crawl-adapter.ts's own PRICE_TOKEN_PATTERN concept, adapted for a bare trailing price at the end of a name — "8", "24/17" (a real two-size price, e.g. small/large, kept verbatim as the DOM detector's own price field already does), "9.00". */
const NAME_PRICE_PATTERN = /([A-Z][A-Za-z'’&.,-]*(?:\s+[A-Za-z'’&.,-]+)*)\s+\$?(\d{1,3}(?:\.\d{2})?(?:\/\d{1,3})?)(?=\s+[A-Z]|\s*$)/g;

/** Mirrors crawl-adapter.ts's MIN_MENU_ITEMS_FOR_REAL_MENU: a single price-shaped line elsewhere in an unrelated document isn't a menu — a menu is a REPEATED pattern. */
const MIN_MENU_ITEMS_FOR_REAL_MENU = 2;
const MAX_MENU_CATEGORIES = 6;
const MAX_ITEMS_PER_MENU_CATEGORY = 12;
const MENU_ITEM_NAME_MAX_CHARS = 80;
/** A category-header candidate line must be this short AND fully uppercase (ignoring punctuation/whitespace) — a real, mechanical typographic signal the source PDF itself chose (confirmed against both real Carriage House Mahopac menus: "STARTERS", "SALADS", "ENTREES", "SIDES" are genuinely all-caps; a real description line like "Roasted Garlic Aioli" is not), never a guess from the text's own topic/content. */
const MENU_CATEGORY_LABEL_MAX_CHARS = 40;
const MENU_FALLBACK_CATEGORY_NAME = "Menu";

function isAllCapsCategoryLabel(line: string): boolean {
  if (line.length === 0 || line.length > MENU_CATEGORY_LABEL_MAX_CHARS) return false;
  if (!/[A-Za-z]/.test(line)) return false;
  return line === line.toUpperCase() && line !== line.toLowerCase();
}

/**
 * findMenuItemsInPdfText — the PDF-text-based structural menu detector.
 * Takes extractPdfText's already-merged (mergePages: true) whole-document
 * text, not a per-page slice — a category header carries forward correctly
 * even if its items happen to span a real page break in the source PDF
 * (confirmed harmless against both real Carriage House Mahopac PDFs: their
 * own category boundaries already align with page boundaries, but nothing
 * here depends on that being true).
 */
export function findMenuItemsInPdfText(text: string, sourceUrl: string): MenuCategory[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  type Category = { name: string; items: MenuItem[] };
  const categories: Category[] = [];
  let currentCategoryName: string = MENU_FALLBACK_CATEGORY_NAME;

  function ensureCategory(name: string): Category {
    const existing = categories.find((c) => c.name === name);
    if (existing) return existing;
    if (categories.length >= MAX_MENU_CATEGORIES) return categories[0] ?? { name, items: [] };
    const created: Category = { name, items: [] };
    categories.push(created);
    return created;
  }

  let totalItems = 0;
  for (const line of lines) {
    const matches = [...line.matchAll(NAME_PRICE_PATTERN)];
    if (matches.length > 0) {
      const category = ensureCategory(currentCategoryName);
      for (const match of matches) {
        if (category.items.length >= MAX_ITEMS_PER_MENU_CATEGORY) break;
        const name = match[1].trim().slice(0, MENU_ITEM_NAME_MAX_CHARS);
        const price = match[2];
        category.items.push({ name, description: null, price, sourceUrl, confidence: "medium" });
        totalItems += 1;
      }
      continue;
    }
    if (isAllCapsCategoryLabel(line)) {
      currentCategoryName = line;
    }
    // Any other line (a description fragment, a disclaimer, a page footer) is
    // deliberately ignored — see this module's own header comment.
  }

  if (totalItems < MIN_MENU_ITEMS_FOR_REAL_MENU) return [];
  return categories.filter((c) => c.items.length > 0);
}
