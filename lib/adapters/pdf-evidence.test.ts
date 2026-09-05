import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { extractPdfText, findMenuItemsInPdfText } from "@/lib/adapters/pdf-evidence";

// __dirname here resolves inside .test-build/ (this file's compiled
// location, not its source location) — the fixture PDFs live alongside the
// source file, so resolve from the repo root (the test script's own cwd)
// instead.
const FIXTURES_DIR = path.join(process.cwd(), "lib/adapters/__fixtures__");

/**
 * lib/adapters/pdf-evidence.test.ts — Phase 13 (docs/PHASE_13_PDF_EVIDENCE_SCOPE.md,
 * docs/PHASE_13_IMPLEMENTATION_PLAN.md). The two real fixtures under
 * __fixtures__/ are the actual PDF menus the Phase 13 investigation found
 * linked directly from the real Carriage House Mahopac mission's crawled
 * page (carriagehousetavern.com/?page_id=45) — downloaded and independently
 * verified during that investigation as genuine, non-scanned, real-text-layer
 * PDFs (real /Font entries, real Tj/TJ operators, no /Subtype /Image). These
 * are this phase's own primary acceptance test, not a synthetic stand-in.
 */

describe("pdf-evidence: extractPdfText (unpdf integration)", () => {
  test("real Carriage House Mahopac main menu PDF — real text extracted, not corrupted/garbled", async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES_DIR, "mahopac-menu.pdf"));
    const result = await extractPdfText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.ok(!("error" in result), "expected real text, not an error");
    if ("error" in result) return;
    assert.ok(result.text.includes("FRENCH ONION SOUP"));
    assert.ok(result.text.includes("STARTERS"));
  });

  test("real Carriage House Mahopac dessert menu PDF — real text extracted", async () => {
    const bytes = fs.readFileSync(path.join(FIXTURES_DIR, "mahopac-dessert.pdf"));
    const result = await extractPdfText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.ok(!("error" in result), "expected real text, not an error");
    if ("error" in result) return;
    assert.ok(result.text.includes("New York Cheesecake"));
  });

  test("a structurally valid PDF with no content stream at all (the same honest outcome a scanned/image-only PDF produces: real PDF, zero extractable text) yields no-text-layer, never a silent empty success", async () => {
    // The minimal valid single-page PDF skeleton — a real Catalog/Pages/Page
    // object graph with no /Contents key, so pdf.js parses it successfully
    // and correctly finds nothing to extract. Deliberately not a fabricated
    // "broken" fixture: this is a genuinely valid PDF, exercising the same
    // downstream branch (extraction succeeds, text is empty) an actual
    // scanned/image-only menu would hit — see this module's own §3 in the
    // scope doc for why OCR recovery is out of scope rather than attempted here.
    const minimalBlankPdf = [
      "%PDF-1.1",
      "1 0 obj",
      "<< /Type /Catalog /Pages 2 0 R >>",
      "endobj",
      "2 0 obj",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "endobj",
      "3 0 obj",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
      "endobj",
      "trailer",
      "<< /Size 4 /Root 1 0 R >>",
      "%%EOF",
    ].join("\n");
    const bytes = new TextEncoder().encode(minimalBlankPdf);
    const result = await extractPdfText(bytes.buffer);
    assert.deepEqual(result, { error: "no-text-layer" });
  });

  test("a malformed/corrupt PDF (not real PDF structure at all) fails honestly, never throws past this function", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nthis is not a real pdf body, just garbage bytes after the header");
    const result = await extractPdfText(bytes.buffer);
    assert.deepEqual(result, { error: "extraction-failed" });
  });

  test("a genuinely empty buffer fails honestly, never throws", async () => {
    const result = await extractPdfText(new ArrayBuffer(0));
    assert.deepEqual(result, { error: "extraction-failed" });
  });
});

describe("pdf-evidence: findMenuItemsInPdfText (text-based structural detection)", () => {
  test("real Carriage House Mahopac menu text (page 1: STARTERS + SALADS) — real dish names, real prices, correct category grouping", () => {
    const text = `STARTERS
FRENCH ONION SOUP 8
Garlic Baguette, Gruyere Cheese
TRUFFLE CHIPS 9
Truffle Oil & Pecorino Romano,
Roasted Garlic Aioli
SALADS
GRILLED CHICKEN 8 CHICKEN CUTLET 9 SHRIMP 9 SALMON 10 STEAK 12
CARRIAGE HOUSE SALAD 13
Mixed Greens, Apples, Gorgonzola, Craisins, Candied Walnuts, Raspberry Vinaigrette
If you have a food allergy, please speak to any member of our staff. The FDA advises consuming raw or undercooked
meats, poultry, seafood or eggs increases your risk of foodborne illnesses. A Processing Fee of 3% is added to all Credit Card Payments.`;

    const categories = findMenuItemsInPdfText(text, "https://carriagehousetavern.test/menu.pdf");
    const byName = Object.fromEntries(categories.map((c) => [c.name, c]));

    assert.ok(byName["STARTERS"], "STARTERS category should be detected (a real, all-caps structural signal)");
    assert.deepEqual(
      byName["STARTERS"].items.find((i) => i.name === "FRENCH ONION SOUP"),
      { name: "FRENCH ONION SOUP", description: null, price: "8", sourceUrl: "https://carriagehousetavern.test/menu.pdf", confidence: "medium" }
    );
    assert.ok(byName["STARTERS"].items.some((i) => i.name === "TRUFFLE CHIPS" && i.price === "9"));

    // The multi-pair-per-line "protein add-on" row — five real name+price
    // pairs on a single extracted line, all five must be recovered, not just
    // the first or last.
    assert.ok(byName["SALADS"], "SALADS category should be detected");
    const saladNames = byName["SALADS"].items.map((i) => i.name);
    assert.deepEqual(saladNames.slice(0, 5), ["GRILLED CHICKEN", "CHICKEN CUTLET", "SHRIMP", "SALMON", "STEAK"]);
    assert.ok(byName["SALADS"].items.some((i) => i.name === "CARRIAGE HOUSE SALAD" && i.price === "13"));

    // The FDA disclaimer paragraph must never become a fabricated menu item
    // or category — it has no trailing price token and isn't all-caps/short.
    const allNames = categories.flatMap((c) => c.items.map((i) => i.name));
    assert.ok(!allNames.some((n) => /allergy|FDA|Processing Fee/i.test(n)));
  });

  test("real Carriage House Mahopac dessert menu text — a single-category real menu, every item medium-confidence (no description ever attached)", () => {
    const text = `Dessert
New York Cheesecake 9
NY Style Cheesecake with Sweetened Graham Cracker Crust topped with
Sliced Strawberries finished with Whipped Cream and Raspberry Sauce
Lemon Berry Mascarpone Cake 9
Moist Cream Cake with Cranberries, Blueberries, and Streusel filled with
Fruit and Lemon Mascarpone Cream topped with Whipped Cream
Carriage House Pecan Rolls 9
Pecan Halves in a warm filling with Kentucky bourbon folded into egg
roll wrappers and then fried. Topped with Butter Pecan Ice Cream`;

    const categories = findMenuItemsInPdfText(text, "https://carriagehousetavern.test/dessert.pdf");
    const items = categories.flatMap((c) => c.items);
    assert.ok(items.some((i) => i.name === "New York Cheesecake" && i.price === "9"));
    assert.ok(items.some((i) => i.name === "Lemon Berry Mascarpone Cake" && i.price === "9"));
    assert.ok(items.some((i) => i.name === "Carriage House Pecan Rolls" && i.price === "9"));
    assert.ok(items.every((i) => i.description === null && i.confidence === "medium"));
    // "Dessert" (Title Case, not all-caps) is honestly not detected as a
    // category header — every item falls to the fallback category, never a
    // guessed one.
    assert.equal(categories.length, 1);
    assert.equal(categories[0].name, "Menu");
  });

  test("a two-size price ('24/17') is kept verbatim, never reformatted or split", () => {
    const text = `BURGERS
THE MCRIP OFF 24/17
Two All Beef Patties, Special Sauce, Lettuce, Cheese, Pickles, Onions, Sesame Seed Bun
FIG PROSCUITTO BURGER 19
Fig Jam, Crispy Prosciutto, Goat Cheese, Spicy Honey, Arugula, Brioche Bun`;
    const categories = findMenuItemsInPdfText(text, "https://example.test/menu.pdf");
    const item = categories.flatMap((c) => c.items).find((i) => i.name === "THE MCRIP OFF");
    assert.equal(item?.price, "24/17");
  });

  test("an irrelevant real PDF (no menu-shaped content at all) yields zero menu items, not a false positive", () => {
    const text = `ACCESSIBILITY STATEMENT
This establishment is committed to ensuring digital accessibility for people with disabilities.
We are continually improving the user experience for everyone and applying the relevant
accessibility standards. If you have any questions, please contact our office at your
convenience. We welcome your feedback on the accessibility of this document.`;
    assert.deepEqual(findMenuItemsInPdfText(text, "https://example.test/accessibility.pdf"), []);
  });

  test("a single price-shaped line elsewhere in a document isn't a menu — MIN_MENU_ITEMS_FOR_REAL_MENU (2) still applies, same as the DOM detector", () => {
    const text = `CONSULTATION\nInitial Consultation 150\nBook online or call our office for availability.`;
    assert.deepEqual(findMenuItemsInPdfText(text, "https://example.test/rates.pdf"), []);
  });

  test("empty text yields zero menu items, never throws", () => {
    assert.deepEqual(findMenuItemsInPdfText("", "https://example.test/blank.pdf"), []);
  });

  test("every real item's sourceUrl is the PDF's own URL, not a guessed or blank value (Phase 13 provenance requirement)", () => {
    const text = `MENU\nHouse Salad 8\nSoup of the Day 6`;
    const categories = findMenuItemsInPdfText(text, "https://example.test/real-menu.pdf");
    for (const item of categories.flatMap((c) => c.items)) {
      assert.equal(item.sourceUrl, "https://example.test/real-menu.pdf");
    }
  });

  test("item count per category is capped (MAX_ITEMS_PER_MENU_CATEGORY = 12), same bound as the DOM detector", () => {
    const letters = "ABCDEFGHIJKLMNOPQRST".split("");
    const lines = ["MENU", ...letters.map((letter, i) => `Dish ${letter} ${i + 1}`)];
    const categories = findMenuItemsInPdfText(lines.join("\n"), "https://example.test/big-menu.pdf");
    assert.equal(categories[0]?.items.length, 12);
  });
});
