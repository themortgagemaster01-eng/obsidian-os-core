# Phase 13 — Implementation Plan: PDF & Document Evidence Acquisition

Planning document only. No code written, no dependency installed, no commit, no push. Governed by
the already-approved `docs/PHASE_13_PDF_EVIDENCE_SCOPE.md` — this document narrows that scope into
concrete implementation steps, exact call sites, and exact acceptance tests. Where this plan
references a line number, it was read directly from the current file, not assumed.

Robert's stated concern, addressed head-on in §11 below with an exact traced data flow: this phase
must not quietly become "PDF extraction + evidence-modeling changes + qualification changes +
generation changes." The claim this plan makes is falsifiable and is proven, not asserted, in §11.

---

## 1. Where PDF detection happens in the existing crawl flow

Exactly one call site: the sub-page fetch loop in `lib/adapters/crawl-adapter.ts`, currently at
lines 1830-1859 (`subPageResults = await Promise.all(sampleUrls.map(async (pageUrl) => {...}))`).
Today this loop unconditionally does:

```
fetchWithTimeout(pageUrl) → response.text() → cheerio.load(pageHtml) → extractStructuredFacts(...)
```

New branch, inserted immediately after the `fetchWithTimeout(pageUrl)` call, before the existing
`response.text()` line:

```
const contentType = pageResponse.headers.get("content-type") ?? "";
if (contentType.includes("application/pdf")) {
  // → new PDF path (§2-§5)
}
// → existing HTML path, completely unchanged
```

Nothing upstream of this changes: `linkEntries` collection (`$("a[href]")`, line ~1797),
`prioritizeSampleUrls` (line 962), and `sampleUrls` selection (line 1819) are untouched — a PDF URL
is already a same-origin `<a href>` today and already survives all of that unmodified (proven
empirically: both real Carriage House Mahopac PDF URLs are already present in the persisted
`sampleUrls` result for that mission, per the original audit). This phase only changes what happens
*after* a URL has already been selected and fetched, never which URLs get selected.

**Detection is `Content-Type`-driven, not URL-extension-driven** — per the scope doc's §1
reasoning, this is what makes non-obvious-anchor-text PDFs (test case in §9 below) work, and it is
what survives a URL like `/download?id=4471` that happens to serve a PDF with no `.pdf` in the
path at all.

---

## 2. How `unpdf` integrates with the current architecture

New, isolated module — `lib/adapters/pdf-evidence.ts` — following the scope doc's §10 "adapters
are I/O only, one job each" seam. Two exported functions, called only from the one branch in §1:

- `extractPdfText(buffer: ArrayBuffer): Promise<{ text: string } | { error: "no-text-layer" | "extraction-failed" }>`
  — wraps `unpdf`'s `extractText` (or equivalent current API — confirmed present in `unpdf@1.8.1`,
  the current published version as of this plan). Returns the `no-text-layer` variant when
  extraction succeeds structurally but yields effectively no text (e.g. a scanned/image-only PDF —
  `unpdf` still parses the PDF's object structure even with no text layer, it just returns an empty
  or near-empty string); returns `extraction-failed` when `unpdf` itself throws (malformed/corrupt
  PDF — see §4).
- `findMenuItemsInPdfText(text: string, sourceUrl: string): MenuCategory[]` — the new text-based
  structural detector described in the scope doc §2, producing the existing `MenuCategory`/
  `MenuItem` types (`lib/adapters/types.ts:133-145`) unchanged, `sourceUrl` set to the PDF's own
  URL per §8 below.

**One fetch-mechanics detail the scope doc didn't spell out, worth being explicit about now:** the
existing loop currently calls `response.text()` unconditionally, which UTF-8-decodes the response
body — correct for HTML, but this would corrupt binary PDF bytes before `unpdf` ever saw them. The
new PDF branch must call `response.arrayBuffer()` instead, on the same already-fetched `Response`
object (no second network request). This is a one-line consequence of the branch already being
necessary in §1, not a separate architectural change.

**A size guard, newly needed:** the existing loop has no response-size cap of any kind today (HTML
pages are naturally bounded; `FETCH_TIMEOUT_MS = 15_000` line 20 is the only existing limit, and it
already applies unchanged to a PDF fetch). A PDF can legitimately be large (scanned menus,
multi-page brochures). Recommend a simple byte-size ceiling (e.g. skip extraction and record an
`unparsedDocuments` entry with reason `"too-large"` above some threshold — 20MB is a reasonable
starting point, well above both real Carriage House PDFs' actual sizes of 77KB and 72KB) purely as
a resource-safety guard, not a product decision — worth flagging for review at implementation time
rather than picking the number unilaterally here.

---

## 3. What happens when extraction succeeds

1. `extractPdfText` returns `{ text }`.
2. `findMenuItemsInPdfText(text, pdfUrl)` runs the new text-based structural detector.
3. If it finds ≥ `MIN_MENU_ITEMS_FOR_REAL_MENU` (2, same existing constant, same existing
   threshold — not a new number) real name+price pairs, it returns real `MenuCategory[]` with
   `sourceUrl: pdfUrl` on every item.
4. That result is merged into the page's own `StructuredFacts.menu` exactly the way an HTML
   sub-page's `extractStructuredFacts(...).menu` result already is today (`subPageResults.map(r =>
   r.facts)`, merged via the existing `mergeStructuredFacts`/`mergeMenu` at the end of
   `runCrawlAdapter` — lines 1676-1734, completely unmodified).
5. If it finds < 2 real items (an irrelevant PDF — §9 test case 4), it returns `[]`, exactly the
   same non-event a genuinely menu-free HTML page produces today. No `unparsedDocuments` entry —
   this is not a failure, it's a successfully-read document that simply isn't a menu.

## 4. What happens when a PDF has no text layer

`extractPdfText` returns `{ error: "no-text-layer" }` (empty/near-empty extracted text from an
otherwise-successfully-parsed PDF — the scanned/image-only case). No menu items are produced. One
entry is added to the new `unparsedDocuments` array (§6): `{ url: pdfUrl, reason: "no-text-layer"
}`. This is the concrete, disclosed difference from today's silent behavior — the whole reason this
phase exists. Per the approved scope doc §3, no OCR is attempted; this is a terminal, honest state
for this phase.

## 5. What happens when the PDF is corrupt/unreadable

`extractPdfText` throws (or `unpdf` itself throws) → caught in the same try/catch shape the
existing HTML sub-page loop already uses at lines 1839-1844 (`try { facts = extractStructuredFacts(...) } catch { facts = null; }`)
— the PDF branch gets the identical discipline: one document's corruption never takes down the rest
of the crawl, never throws past this one `Promise.all` entry. Result: `{ error: "extraction-failed"
}`, one `unparsedDocuments` entry with that reason, `facts` for this sub-page contributes nothing
(same as today's `facts = null` outcome for a markup-quirk HTML page).

A malformed-but-`Content-Type: application/pdf`-labeled response (test case 6 below) and a
genuinely truncated download both land here — `unpdf` throwing on invalid PDF structure is the
expected, correctly-handled outcome, not a gap.

---

## 6. How `unparsedDocuments` is populated

New field on `CrawlRawResult` (`lib/adapters/types.ts`), additive and optional exactly like every
prior late addition to this type (`ContactInfo.phoneEvidence`/`hoursByDay`, `types.ts:250-253`):

```
unparsedDocuments?: { url: string; reason: "no-text-layer" | "extraction-failed" | "too-large" }[]
```

Populated at the same point in `runCrawlAdapter` where `subPageResults` are assembled (line
1830-1859) — the PDF branch appends to a per-crawl array alongside building `facts`, the same
shape as the existing `pages: CrawlPage[]` array is built. Merged into the final `CrawlRawResult`
return object as a flat concatenation across all sampled pages (no cross-page dedup needed — each
PDF URL is only ever fetched once per crawl, since `sampleUrls` is already deduped by
`prioritizeSampleUrls`).

`normalizeCrawlRawResult` (`types.ts:212`) gets one new line, following its own established
pattern exactly: `unparsedDocuments: r.unparsedDocuments ?? []` — an older persisted row without
this field reads back as an honestly-empty array, never a crash, never a fabricated entry.

**No migration.** `website_analyses.crawl_result` is `jsonb` (confirmed directly:
`supabase/migrations/0007_website_analysis.sql:45`, `crawl_result jsonb`) — a new optional key in
an already-schemaless JSON blob requires no `ALTER TABLE`, no new migration file, exactly the same
zero-migration precedent `ContactInfo`'s own later-added fields already established in this
codebase.

---

## 7. How extracted text enters the existing evidence structure

Traced exactly, one hop at a time, all confirmed by reading the current code (not assumed):

1. `findMenuItemsInPdfText(...)` produces `MenuCategory[]` (new producer, existing type).
2. `mergeMenu()` (`crawl-adapter.ts:1677-1694`, **unmodified**) merges it into
   `CrawlRawResult.menu` alongside whatever HTML sub-pages also contributed — this function
   already merges *across pages*; a PDF is just one more page-shaped source to it.
3. `NormalizedAnalysis.menu` (`analysis-types.ts:289` and `:347`, **unmodified**) —
   `menu: crawl?.menu ?? []` — reads straight from `CrawlRawResult.menu` with no branching on
   where any item came from.
4. `DesignBrief.menu` (`design-brief-service.ts:408`, **unmodified**) — `menu: normalized.menu`,
   a direct pass-through, confirmed: `menu` is *not* even included in the object passed to the
   LLM call (`design-brief-service.ts:363-378` lists contactEvidence/services/testimonials/
   certifications/team/faqEvidence/reviews/gallery — no `menu` key) — menu evidence bypasses the
   creative/LLM layer entirely and is attached to the brief as raw structured data, by design, per
   that file's own doc comment at line 109 ("Passed through from NormalizedAnalysis.menu
   unchanged"). This means Phase 13 cannot possibly require an LLM-prompt change for menu data —
   there is no prompt it flows through.
5. `Wireframe`/`generateWireframe`'s `"menu"` slot-builder (`design-generation-service.ts:891-914`,
   **unmodified**) — reads `context.menu[i].name`/`.items[j].name`/`.price`/`.description`
   structurally, builds `category-N`/`item-N-M` slots. Confirmed no branch anywhere in this
   function inspects where a `MenuItem` came from.
6. `components/design-preview/design-preview.tsx` — confirmed in the original diagnostic session:
   "menu" has no dedicated render branch at all; it reuses the same generic divided-row renderer
   `team`/`faq` already use (per `design-generation-service.ts:896-899`'s own comment). Real slots
   render; `OMIT_SECTION_IF_EMPTY` (already includes `"menu"`) still governs whether the section
   appears at all — now correctly *not* omitted once real slots exist, using logic that already
   exists today for exactly this purpose.

Every one of these six hops is existing, unmodified code. The only new code in the entire trace is
step 1 and the merge input to step 2 (which itself needs no change, only a new caller).

---

## 8. How provenance/source URLs are preserved

`MenuItem.sourceUrl` (`types.ts:137`, existing field, existing doc comment: "the exact page ...
this ... was found on") is set to the PDF's own URL by `findMenuItemsInPdfText` (§2) — not the
HTML page that linked to it. No schema change: this field already exists and is already required
on every `MenuItem`, HTML- or PDF-sourced alike. A founder or future QA check inspecting a menu
item's `sourceUrl` for a PDF-derived item sees the literal `.pdf` URL, which is itself suf­ficient
provenance to distinguish "found directly on the page" from "found inside a linked document"
without any new discriminator field — the scope doc's optional `sourceKind` suggestion remains
optional and is not required for this plan's acceptance criteria (§12) to pass.

`unparsedDocuments[].url` (§6) carries the same provenance discipline for the honest-failure case.

---

## 9. Exact tests

All against real or realistically-constructed fixtures; none written as part of this plan.

1. **Real Carriage House Mahopac main menu** — `MAHOPAC-MENU-FAll-2024.pdf`, already downloaded
   and verified this engagement (`Content-Type: application/pdf`, real `/Font`, real `Tj`/`TJ`
   operators, no `/Subtype /Image`; 77,089 bytes). **Primary acceptance test**: must produce real,
   non-empty `MenuCategory[]` with real dish names and real prices matching what a human reading
   the PDF sees.
2. **Real Carriage House Mahopac dessert menu** — `Mahopac-Dessert-3.28.24.pdf` (72,717 bytes),
   same business. Confirms `mergeMenu()` correctly merges categories across two separate PDF
   documents the same way it already merges categories across two separate HTML pages today —
   no new merge logic, this is a regression check on existing code receiving a new input shape.
3. **Full-mission regression** — re-run extraction against this exact mission's already-persisted
   crawl target (`?page_id=45`) end-to-end and confirm `DesignBrief.menu`/the rendered preview for
   Carriage House Mahopac now shows a real, populated menu section — the literal complaint this
   entire investigation started from, closed and demonstrated on the real business that raised it.
4. **Image-only/scanned PDF** — a constructed fixture PDF containing only a `/Subtype /Image`
   XObject, no `/Font`/text-show operators. Must yield zero menu items and exactly one
   `unparsedDocuments` entry with `reason: "no-text-layer"`.
5. **Irrelevant PDF** — a real, unrelated PDF (an ADA/accessibility statement, a press kit).
   Text extracts fine; must yield zero menu items and **no** `unparsedDocuments` entry — proves
   `findMenuItemsInPdfText`'s own `MIN_MENU_ITEMS_FOR_REAL_MENU` threshold guards against
   hallucinating menu structure out of arbitrary real prose, mirroring the existing HTML-path
   guarantee.
6. **Malformed/corrupt PDF** — truncated bytes or an invalid PDF header served with
   `Content-Type: application/pdf`. Must produce one `unparsedDocuments` entry with
   `reason: "extraction-failed"`, and must not throw past the existing per-page try/catch — the
   rest of the crawl (including the Mahopac homepage/contact facts already proven real) completes
   unaffected.
7. **Menu linked through non-obvious anchor text** — a PDF whose link text is unrelated to "menu"
   (e.g. "View Our Fall Offerings"), served with a correct `Content-Type` header. Must still be
   detected and extracted — proves detection is genuinely `Content-Type`-driven, not a disguised
   text/extension heuristic.
8. **Oversized PDF** — a fixture (or a truncation of a real one, relabeled) exceeding the size
   guard from §2. Must produce an `unparsedDocuments` entry with `reason: "too-large"`, never
   attempt extraction, never block the crawl for an unreasonable amount of time.
9. **Existing HTML menu regression fixture** (already exists in `crawl-adapter.test.ts` or
   equivalent — `findMenuItemsByStructure`'s own test suite) — must produce byte-identical output
   to today, proving this phase adds a new branch and touches zero existing DOM-based logic.
10. **Existing full-pipeline regression fixtures** — `design-generation-service.test.ts`'s existing
    `REAL_MENU`-based tests (lines 834-888, already exist, already pass with a hand-built
    `MenuCategory[]` fixture with no `sourceUrl` distinction) — must continue to pass completely
    unmodified, proving §7's "zero downstream code changes" claim empirically, not just by
    argument: the exact same test fixtures and assertions that pass today must still pass without
    being touched.

---

## 10. Dependency/version considerations

Per the scope doc's §9 recommendation, re-verified just now against the live npm registry (not
re-asserted from memory):

- **`unpdf`** — latest published version **1.8.1**, MIT license, no `engines` restriction (broadly
  compatible, including this project's Node 22 runtime — see the nightly-batch workflow's own
  recent Node 20→22 bump for why that specifically matters here). Confirmed actively published.
- **`pdf-parse`** — latest published version **2.2.13**, license **Apache-2.0** (changed from the
  older 1.x line's MIT — worth noting for a license-compliance pass, though Apache-2.0 is equally
  permissive for this project's purposes), with 13+ releases in its 2.x line — **more actively
  maintained currently than the scope doc's original characterization assumed**; that characterization
  should be read as superseded by this re-check, not as still-current. This narrows the gap between
  the two candidates but doesn't reverse the recommendation.
- **Recommendation unchanged: `unpdf` primary.** It remains the smaller, more purpose-built option
  for a text-only server-side extraction need with no rendering requirement, and its lack of an
  `engines` constraint removes any repeat of the exact Node-version class of incident this project
  already hit once this engagement (the GitHub Actions Node 20→22 WebSocket failure). `pdf-parse`
  is a legitimate fallback if `unpdf`'s API proves awkward once actually exercised against the two
  real fixtures — that validation is the first real implementation step, not decided blind here.
- Neither package requires any change to this project's own `engines`/Node version — already at 22
  everywhere that matters (CI and, per this engagement's own dev-server work, local).

---

## 11. Proof: no downstream changes are required

This is the load-bearing section for Robert's stated concern. The claim: **once PDF-derived
`MenuCategory[]` data is merged into `CrawlRawResult.menu` by the new code in §2-§3, every single
downstream consumer receives it through a code path that already exists today, unmodified, because
none of them are format-aware — they only know about the `MenuCategory`/`MenuItem` shape.**

Traced concretely, file and line, confirmed by reading each one directly (not inferred):

| Stage | File : line | What it does with `menu` | Format-aware? |
|---|---|---|---|
| Merge across pages/documents | `crawl-adapter.ts:1677-1694` (`mergeMenu`) | Dedupes categories by name across whatever sources contributed | No — already merges across *pages* today; a PDF is just another source |
| Raw result assembly | `crawl-adapter.ts:1734` | `menu: mergeMenu(pages.map(p => p.menu))` | No |
| Normalization | `analysis-types.ts:289`, `:347` | `menu: crawl?.menu ?? []` | No — direct pass-through |
| Design Brief construction | `design-brief-service.ts:408` | `menu: normalized.menu` | No — direct pass-through, **and confirmed not even sent to the LLM** (`:363-378`) |
| Industry-bucket classification | `reference-library.ts:314-335` (`resolveIndustryBucket`) | Uses menu *category names* only as a fallback when `industry`/`businessCategory` are both empty | No new code — this fallback parameter has existed since Phase 4.9 for exactly this purpose |
| Wireframe slot-building | `design-generation-service.ts:891-914` | Builds `category-N`/`item-N-M` slots from `.name`/`.price`/`.description` | No |
| Rendering | `design-preview.tsx` (per Phase 4.8's own comment, no dedicated `"menu"` branch) | Reuses the generic divided-row renderer already used for `team`/`faq` | No |
| Qualification/scoring | `lib/services/lead-scoring-service.ts` | **Confirmed: zero references to `.menu` anywhere in this file** | N/A — doesn't touch menu evidence at all, today or after this phase |
| QA | `lib/services/design-qa-service.ts` | **Confirmed: zero references to `.menu` anywhere in this file** — its section-emptiness checks are generic (count of real slots per section), not menu-specific | No |

**The one honest, non-code-level effect worth naming, not papering over:** `resolveIndustryBucket`
can now be reached with real (non-empty) `menuCategoryNames` for businesses where it previously
always received `[]` (because their real menu was trapped in an unparsed PDF). For a business whose
`industry`/`businessCategory` fields are *both* empty or unmatched *and* whose only menu evidence
was a PDF, this could change which industry bucket — and therefore which design template/reference
direction — gets selected, where today it silently falls to `"general"`. This is not a code change:
the parameter and the fallback logic already exist, unmodified, built in Phase 4.9 specifically to
do this the moment real menu-category evidence becomes available from *any* source. It is a
data-availability effect of already-designed code doing exactly the job it was built for — the same
category of effect as "a business now has a real menu section that previously had none," which is
this entire phase's whole point. Concretely, for Carriage House Mahopac itself, this has no effect:
its industry classification already resolves correctly today via other signals before the menu
fallback would ever be consulted.

**Conclusion: the target shape is genuinely achievable, and is what this plan implements.** No
line in `lib/services/lead-scoring-service.ts` (qualification/scoring), no line in
`lib/services/design-qa-service.ts` (QA logic), and no line in `design-generation-service.ts`'s or
`design-brief-service.ts`'s existing menu-handling paths needs to change. The only new code is: one
`Content-Type` branch in the crawl adapter's fetch loop, one new isolated module
(`pdf-evidence.ts`), one new optional field (`unparsedDocuments`) on an existing jsonb-backed type.

---

## 12. Acceptance criteria

1. Both real Carriage House Mahopac PDFs (main menu + dessert menu) produce real, non-empty,
   correctly-priced `MenuCategory[]` when run through the new extraction path.
2. Re-running this mission's crawl target end-to-end results in `DesignBrief.menu` and the
   rendered Design Preview showing a real populated menu section for Carriage House Mahopac,
   closing the original customer-facing complaint concretely, not just in a unit test.
3. All ten test cases in §9 pass, including the two pre-existing regression suites
   (`design-generation-service.test.ts`'s `REAL_MENU` tests, and the existing
   `findMenuItemsByStructure` HTML fixture) passing **completely unmodified**.
4. `git diff` for the completed phase touches only: `lib/adapters/crawl-adapter.ts` (one new
   branch + one new import), a new `lib/adapters/pdf-evidence.ts`, `lib/adapters/types.ts` (one
   new optional field + one new line in `normalizeCrawlRawResult`), `package.json`/lock file (the
   one new dependency), and new test files. Zero lines changed in
   `lib/services/lead-scoring-service.ts`, `lib/services/design-qa-service.ts`,
   `lib/services/design-generation-service.ts`, `lib/services/design-brief-service.ts`, or
   `lib/design-references/reference-library.ts` — this is a mechanically-checkable criterion, not
   just a design intention.
5. No new migration file. No `ALTER TABLE`.

## 13. Explicit non-goals

- **No OCR / image-only PDF text recovery** (scope doc §3 — deferred, not this phase).
- **No general PDF→any-evidence-category classifier** — this phase's structural interpreter
  targets menu-shaped content only, per the scope doc §4's explicit scope decision.
- **No QA-verdict change** — `unparsedDocuments` is populated honestly; whether/how QA reads it
  and turns it into a visible grade is a separate, later decision (scope doc §6).
- **No change to which URLs get sampled** — `prioritizeSampleUrls`/`LINK_PRIORITY_WORDS` (the
  missing-"menu"-category gap the original audit also flagged) is untouched by this phase; it
  remains a valid, separate, smaller follow-up (scope doc's own recommendation #2), independent of
  this plan.
- **No image/social/review evidence work** — that's Phase 14/15 (scope doc's closing section).
- **No design-intelligence changes** — confirmed unnecessary in §11/§7 above.
- **No account creation, no secret/credential changes, no CI workflow changes.**
