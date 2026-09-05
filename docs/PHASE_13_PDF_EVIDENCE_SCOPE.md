# Phase 13 — Scope & Plan: PDF & Document Evidence Acquisition

Planning document only. No code written, no dependency installed, no file other than this one
touched. Every function/module/field named below is *proposed* — none of it exists yet except
where explicitly marked "already exists, unmodified."

Follows directly from the PDF Evidence Retrieval Audit run against the real Carriage House
Mahopac mission (`mission_id dddd0d22-a116-4935-889e-687f5e29e06f`) and its live source site
(`carriagehousetavern.com`). That audit is the concrete acceptance-test case for everything below
— every section of this plan is checked against it, not a hypothetical.

---

## 0. What the audit actually found (background, not repeated investigation)

`lib/adapters/crawl-adapter.ts` discovers same-origin links with no extension/content-type
filtering, then its sub-page fetch loop calls `response.text()` + `cheerio.load()` on every
sampled URL unconditionally — no `Content-Type` check exists anywhere in the file (confirmed:
zero occurrences of "pdf" in `lib/adapters/crawl-adapter.ts` or anywhere else in `lib/`).

For Carriage House Mahopac, the crawler's own persisted `website_analyses.crawl_result` row
(`requestedUrl = finalUrl = https://carriagehousetavern.com/?page_id=45`) shows it **discovered
and successfully fetched (HTTP 200, no `fetchError`)** two real menu PDFs directly linked from
that page:

- `https://carriagehousetavern.com/wp-content/uploads/2024/11/MAHOPAC-MENU-FAll-2024.pdf`
- `https://carriagehousetavern.com/wp-content/uploads/2024/04/Mahopac-Dessert-3.28.24.pdf`

Both downloaded and independently verified this session: `Content-Type: application/pdf`, real
`/Font` entries and `Tj`/`TJ` text-show operators present, no `/Subtype /Image` — i.e. a genuine,
non-scanned, machine-text PDF, not an image. The crawler's own record shows `title: null` for both
(the tell that `cheerio.load()` was handed raw PDF bytes decoded as text and found no `<title>`
tag), and the final merged result is `menu: []`. Everything downstream — the Design Brief
(`positioning: "...no menu... crawled"`), Website Generation (menu section correctly omitted, zero
real slots), and QA (`layout` category graded `MODERATE`) — behaved exactly correctly given that
empty input. Nothing downstream is broken. The gap is entirely upstream, at parse time, and it is
silent: no error, no warning, no flag anywhere in the pipeline distinguishes "this business has no
menu" from "this business's menu was fetched and then discarded by misclassification."

That distinction is what Phase 13 exists to close.

---

## 1. PDF detection

**Where:** the existing sub-page fetch loop in `lib/adapters/crawl-adapter.ts` (the block that
today does `fetchWithTimeout(pageUrl)` → `response.text()` → `cheerio.load()` for every sampled
URL, no branching).

**How:** branch on the real HTTP response's `Content-Type` header (`application/pdf`), not on
anchor text or URL extension. This matters concretely: the audit's own test case #7 below (a link
whose text says nothing like "menu") would be missed entirely by a text/extension heuristic;
`Content-Type` is authoritative regardless of URL shape or link wording. URL-extension (`.pdf`) is
worth keeping only as a *cheap early hint* for logging/metrics — never as the actual gate, since a
mis-served or extensionless PDF URL (real-world CMS misconfiguration) would then be silently
skipped for the exact same reason the original bug existed. See test case #8 below for the
Content-Type-missing-but-real-PDF edge this decision has to survive.

This is purely an added `if` branch at one existing call site — no change to link discovery, no
change to `prioritizeSampleUrls`, no change to which URLs get selected.

---

## 2. PDF text extraction (real text-layer PDFs)

Once a response is classified as a PDF, extract its plain text via a dependency (see §9) and run a
**new, text-based structural menu detector** — not a reuse of `findMenuItemsByStructure`, which is
inherently DOM-shaped (it walks `cheerio` elements and their siblings/parents). A PDF's extracted
text has no DOM; the detector needs its own line/paragraph-based heuristic for "a name, then a
price, optionally then a description, repeated" — the same *concept* `findMenuItemsByStructure`
already applies (`MIN_MENU_ITEMS_FOR_REAL_MENU = 2`, price-shape detection, category-label
detection), reimplemented against plain text lines rather than DOM siblings. Output shape is
unchanged: the existing `MenuItem { name, description, price, sourceUrl, confidence }` /
`MenuCategory { name, items }` types (`lib/adapters/types.ts:133-145`) — no new evidence type,
just a new producer of the same type.

Acceptance test: both real Carriage House Mahopac PDFs above must yield real, non-empty
`MenuCategory[]` with real dish names and real prices, at `high` or `medium` confidence per the
existing field's own definition.

---

## 3. Scanned/image-only PDFs — **OCR is out of scope for Phase 13, deliberately deferred**

Recommendation: defer OCR entirely to a later, separately-scoped phase (only if evidence from
other real missions shows image-only PDFs are common enough to justify it — not assumed here).

Reasoning:
- Neither real PDF in this phase's own acceptance test needs OCR — both have genuine text layers,
  confirmed directly. Building OCR support now would be solving a problem this concrete case
  doesn't actually have.
- OCR is a materially heavier, materially riskier addition than text extraction: a real image-
  processing dependency (Tesseract.js or a cloud OCR API), meaningfully worse accuracy on
  real-world scanned menus (skewed photos, low-res phone scans, handwritten specials boards),
  added latency per document, and for a cloud API, a new external cost/dependency/secret — a much
  bigger increment than "detect a PDF and extract its existing text layer."
- The evidence-first, no-fabrication discipline this project holds to everywhere else means an
  OCR misread (a wrong price, a misread dish name) is a worse failure mode than today's honest
  empty array — a wrong-but-confident-looking menu item is strictly more dangerous to a founder's
  trust in the system than a disclosed gap.

What Phase 13 *does* do instead: when a PDF is detected but yields no extractable text (no `Tj`/
`TJ` operators, or extraction returns empty/near-empty output), record that honestly (§6) rather
than silently collapsing to the same empty state as "no PDF was ever found." That distinction —
"a document exists but this system can't read it yet" vs. "nothing exists" — is the actual
deliverable here, and it's what makes a future OCR phase (if ever justified) easy to scope
precisely: it would target exactly the documents this phase's own honest-failure signal has
already identified and counted.

---

## 4. Evidence normalization

PDF-derived `MenuCategory[]` output merges into the **exact same** `CrawlRawResult.menu` field via
the existing `mergeMenu()` function (`crawl-adapter.ts:1677`, already dedupes categories by name
across multiple pages) — no new top-level field for "PDF menu evidence" alongside the existing
one. From `design-brief-service.ts` and every downstream consumer's point of view, a PDF-sourced
menu item is indistinguishable in shape from an HTML-sourced one, by design: evidence is evidence
once normalized, regardless of which document format it came from.

**Scope decision, stated explicitly:** Phase 13's structural interpreter targets **menu-shaped
content only** — the proven, acceptance-tested failure mode. A PDF that happens to be a
certifications list or a standalone price sheet is a real, plausible future case (the audit's own
"isolated case?" question flagged this), but building a general PDF→any-evidence-category
classifier now would be exactly the scope creep the original audit's hard rules warned against.
The detection/extraction seam (§1, §2) is format-generic by construction — a future phase can add
a second structural interpreter (e.g. for certifications) against the same extracted text without
touching detection or extraction again. This phase ships one interpreter, proven against one real
case, on a seam built to hold a second one later.

---

## 5. Provenance

`MenuItem.sourceUrl` already exists (`lib/adapters/types.ts:137`) and already carries "the exact
page ... this ... was found on," per its own doc comment. For a PDF-derived item, this becomes the
literal PDF URL itself — not the HTML page that merely linked to it — so a founder or a future QA
check can tell "found directly on the page" apart from "found inside a linked document" without
any new required field.

One optional addition worth flagging for the implementer to decide, not required for correctness:
a `sourceKind?: "html" | "pdf"` discriminator on `MenuItem`, following the exact precedent already
set by `ContactInfo`'s `phoneEvidence`/`emailEvidence`/`hoursByDay` fields (`types.ts:250-253`) —
optional, additive, `normalizeCrawlRawResult` already has the pattern for omitting it entirely on
older persisted rows rather than defaulting it to a guessed value. Similarly, `CrawlPage` (the
`pages` array — `types.ts` referenced at `crawl-adapter.ts:1846`) could optionally carry a
`contentType` field for debugging/audit visibility (would have made this very investigation
faster: `title: null` was the only clue this session had that something had gone wrong). Neither
is required for the phase's own acceptance test to pass; both are cheap, backward-compatible, and
directly useful the next time someone has to debug a "why is this evidence empty" question like
this one.

---

## 6. Honest failure handling

A broken, corrupt, or genuinely-unreadable PDF, and an image-only PDF with no text layer, must
**not** collapse to the same indistinguishable `menu: []` a business with no menu at all produces
today. Recommendation: a new, honestly-populated field — e.g. `CrawlRawResult.unparsedDocuments:
{ url: string; reason: "no-text-layer" | "extraction-failed" | "fetch-error" }[]` — following the
exact same "always present, honestly empty when there's nothing to report" discipline every other
field in `CrawlRawResult` already follows, and the same `normalizeCrawlRawResult` read-boundary
default (`r.unparsedDocuments ?? []`) every other field already gets.

**Explicit scope boundary:** this phase's job is to make the *signal* real and honest. Whether and
how QA reads that signal and turns it into a visible grade/finding is a separate decision, held
back deliberately — the original audit's own hard rules said "do not change QA," and extending
that rule to this scope doc: Phase 13 populates `unparsedDocuments` truthfully; wiring a QA check
that reads it is a named, explicit follow-up, not bundled silently into this phase's own
completion.

---

## 7. Test suite (described, not written)

All fixtures conceptual/described here; none written as part of this scope document.

1. **Real text-layer PDF menu** — the actual Carriage House Mahopac main menu PDF (already
   downloaded and verified this session as a real fixture candidate: real `/Font`, real `Tj`/`TJ`
   operators, no `/Subtype /Image`). The phase's primary acceptance test: must yield real,
   non-empty menu items with real names and prices.
2. **Dessert/secondary menu variant** — the same business's second PDF
   (`Mahopac-Dessert-3.28.24.pdf`). Confirms multi-PDF merging behaves the same way `mergeMenu()`
   already merges multi-*page* HTML menu evidence today — same dedupe-by-category-name behavior,
   now across document boundaries too.
3. **Image-only/scanned PDF** — a PDF containing only a `/Subtype /Image` XObject, no
   `/Font`/text-show operators. Must produce zero menu items **and** a `no-text-layer` entry in
   `unparsedDocuments` — proves §3's and §6's honest-gap behavior, not silent emptiness.
4. **Irrelevant PDF** — a real, unrelated PDF (an accessibility statement, a press kit, a menu-free
   brochure). Must produce zero menu items with **no** `unparsedDocuments` entry (its text
   extracted fine; it simply contains no menu-shaped structure) — proves the new text-based
   structural detector doesn't hallucinate menu items out of arbitrary real text, mirroring how
   `findMenuItemsByStructure`'s own `MIN_MENU_ITEMS_FOR_REAL_MENU` threshold already guards the
   HTML path.
5. **Malformed/corrupt PDF** — truncated download, invalid PDF header/structure. Must degrade to a
   `fetch-error`-or-equivalent `unparsedDocuments` entry, never a thrown exception that takes down
   the rest of the crawl — same try/catch discipline the existing HTML sub-page loop already has
   at `crawl-adapter.ts:1839-1844`.
6. **Menu linked through non-obvious anchor text** — a PDF linked with link text unrelated to
   "menu" (e.g. "View Our Fall Offerings"). Must still be detected and extracted, since detection
   is `Content-Type`-driven (§1), not anchor-text-driven — proves this specific, real limitation
   named in the original audit is actually closed, not just partially mitigated.
7. **Existing HTML menu regression fixture** — an existing `findMenuItemsByStructure` test case.
   Must produce byte-identical results to today — proves this phase adds a new branch and never
   touches the existing DOM-based path.
8. **PDF served with a missing/incorrect `Content-Type` header but real PDF magic bytes
   (`%PDF-`)** — a real-world CMS/hosting misconfiguration case, not hypothetical. Forces an
   explicit decision at implementation time: sniff magic bytes as a fallback when `Content-Type`
   is absent/generic (e.g. `application/octet-stream`), or accept this as a named, disclosed
   residual gap. Either answer is acceptable; silently not deciding is not.

---

## 8. No downstream behavior changes

Stated explicitly, as a hard boundary for this phase: **no change to scoring, qualification,
opportunity logic, or generation.** PDF-derived menu items merge into the exact same
`menu: MenuCategory[]` field already consumed identically today by `design-brief-service.ts` and
`design-generation-service.ts` — from generation's point of view, a PDF-sourced menu item is
indistinguishable from an HTML-sourced one, by construction, the moment normalization has run. No
opportunity-scoring weight changes. No new qualification gate. No change to
`lib/services/mission-batch-service.ts`'s pipeline sequence or stage attribution. This phase is
entirely contained inside the Crawl Adapter's own boundary (`lib/adapters/crawl-adapter.ts` +
`lib/adapters/types.ts`) plus the one new, additively-typed field in §6.

---

## 9. Dependency choice

Three real candidates, compared on the axes that matter for this specific, narrow use case
(server-side, Node 22 runtime — see the nightly-batch workflow's own recent Node 20→22 bump —
text-only extraction, no rendering needed):

| | `pdf-parse` | `pdfjs-dist` | `unpdf` |
|---|---|---|---|
| What it is | Thin Node wrapper around pdf.js internals, text-extraction-only API | Mozilla's own PDF.js, published directly — the engine the other two wrap | Modern, serverless/edge-oriented wrapper around pdf.js's extraction internals |
| API shape for this use case | `pdfParse(buffer) -> { text, numpages, info }` — minimal, exactly what's needed | Full document/page/rendering API — text extraction needs manual page-by-page `getTextContent()` wiring, worker setup | `extractText(buffer) -> { text, pages }`-shaped modern API, purpose-built for exactly this |
| Maintenance | Historically inconsistent — long gaps between releases under different maintainers | Actively maintained by Mozilla, very high confidence | Actively maintained (unjs ecosystem), smaller but current |
| License | MIT | Apache-2.0 | MIT |
| Server/Node fit | Good, designed for Node | Built primarily for browser rendering; server-only text use requires extra boilerplate (canvas/worker polyfills for some code paths) | Built specifically for serverless/Node, no rendering-path baggage |
| Bundle/dependency weight | Small | Large (full rendering engine) | Small — the point of the package |
| Real-world fit against the 2 verified fixtures | Should work — standard text-layer PDFs are exactly its target case | Would work, but disproportionate wiring for what's needed | Should work — same target case as `pdf-parse`, newer implementation |

**Recommendation:** `unpdf` as the primary candidate — smallest footprint, actively maintained,
purpose-built for exactly this (server-side text extraction, no rendering), avoids `pdf-parse`'s
maintenance-consistency history (a real, non-hypothetical concern for this project specifically:
two of this engagement's last five real production incidents were dependency/runtime-version
issues — the GitHub Actions Node 20→22 WebSocket failure being the most recent). `pdf-parse` is a
reasonable fallback if `unpdf`'s API proves awkward for the line-based menu-structure detector
this phase also needs to write. `pdfjs-dist` directly is not recommended for this phase — correct
but disproportionately heavy for a text-only extraction need.

No dependency has been installed or run. Empirically validating the recommendation against the two
real, already-downloaded Mahopac PDFs is this phase's own first implementation step and first real
acceptance check — not a decision finalized here without evidence.

---

## 10. Future compatibility — the seam for Evidence & Media Acquisition

Per CLAUDE.md's "Adapters are I/O only... one job each" principle, this phase's new code should
live in its own module (naming only, not committing to it: something like
`lib/adapters/pdf-evidence.ts`, called from the existing crawl-adapter fetch loop) rather than
being inlined into `crawl-adapter.ts`'s existing functions. That gives Phase 14 (visual/media
acquisition — image classification, visual-gap detection, stock-image fallback) and Phase 15
(external/social/review evidence) each their own equally-isolated adapter module, all converging
on the same two seams this phase establishes:

1. **The same normalization boundary** — `normalizeCrawlRawResult` (`types.ts:212`) stays the one
   read-boundary function every persisted-row consumer calls; each future evidence type gets its
   own honestly-defaulted field there, the same way `unparsedDocuments` does in §6.
2. **The same "evidence is evidence once normalized" principle from §8** — a future image-sourced
   or social-sourced piece of evidence should be exactly as invisible to
   `design-brief-service.ts`/`design-generation-service.ts` as a PDF-sourced menu item is once
   normalized, so Phase 14/15 shouldn't need their own "downstream behavior changes" section either
   unless they're introducing a genuinely new evidence *category* Design Intelligence has never
   rendered before (e.g. a review-quote section type that doesn't exist today) — in which case that
   integration work belongs to whichever phase introduces that new category, not to this one.

Nothing in this phase should require touching `lib/design-intelligence/*` at all — see the
strategic answer below for why that matters to the proposed phase ordering.

---

## Strategic question: is PDF extraction its own Phase 13, or the first sub-capability of a larger Evidence/Media Acquisition phase?

**Endorsed, with one refinement.** PDF/document evidence should be its own narrowly-scoped Phase
13, exactly as proposed — Phase 14 (visual/media), Phase 15 (external/social/review), then
whatever design-intelligence integration those two specifically require, then the Mission Control
dashboard work.

Reasoning:

- **This is a genuinely well-bounded, independently-acceptance-testable unit of work.** Sections
  1-9 above show the entire capability — detection, extraction, an explicit non-goal (OCR),
  normalization, provenance, honest failure — fits entirely inside the Crawl Adapter's existing
  boundary, with a concrete real-world acceptance test (the two actual Mahopac PDFs) already in
  hand before a line of code is written. That is exactly the shape of every other well-run phase
  in this project's history (Sprint 3's service-split model, Sprint 4's phase-by-phase review
  discipline) — bundling it with image/social work would dilute one clean acceptance test across
  three unrelated capabilities.
- **The one argument for bundling — shared plumbing — doesn't actually hold much weight here.**
  Per §10, the only thing Phases 13/14/15 truly need to share is the normalization/merge boundary
  contract (`normalizeCrawlRawResult`, "evidence is evidence once normalized"). That's a one-time,
  already-established interface decision, not a reason to build three different acquisition
  capabilities in lockstep. Phase 14 building against the seam Phase 13 leaves clean is a *better*
  outcome than the two being built simultaneously and having to reconcile design decisions neither
  one has validated in production yet.
- **One concrete correction to the proposed sequence, worth flagging before it causes wasted
  planning:** per §8/§10 above, Phase 13 requires **zero** design-intelligence integration work of
  its own — a PDF-sourced menu item is consumed by the existing `design-brief-service.ts`/
  `design-generation-service.ts` pipeline completely unchanged, the moment it's normalized into the
  same `menu: MenuCategory[]` shape real HTML-sourced items already use today. The
  "design-intelligence integration" step Robert's proposed sequence places after Phases 13-15 is
  real and necessary, but it belongs to Phase 14/15's new evidence *categories* (a photo-quality
  signal, a review/social-proof section type) that Design Intelligence has never rendered before —
  not to Phase 13's PDF work, which slots into an existing, already-rendered category. Scheduling
  design-intelligence work as a prerequisite-cleared step for Phase 13 specifically would be
  scheduling work this phase doesn't need.

---

## Recap: what happens if this phase is approved as scoped

A new, isolated PDF-detection-and-extraction module, called from one existing fetch loop in
`crawl-adapter.ts`, producing the same `MenuCategory[]`/`MenuItem` shape that already exists,
merged through the same `mergeMenu()` function that already exists, normalized through the same
`normalizeCrawlRawResult` boundary that already exists (plus one new, honestly-defaulted
`unparsedDocuments` field), with zero changes to scoring, qualification, opportunity logic, QA
verdicts, or generation. Proven against two real PDFs already pulled from the real Carriage House
Mahopac mission this session, before any implementation begins.
