# Phase 14 — Audit: Business/Domain Identity Verification

Audit only. No code, no schema change, no proposed implementation — per Robert's explicit
instruction, this document identifies and classifies signals; it does not design or authorize a
fix. The GitHub Actions schedule (`.github/workflows/nightly-batch.yml`) was not touched while
producing this audit, per the same instruction.

Prompted by a real, live failure this engagement found while investigating scheduled run #8: a
mission ("The Freight House Cafe") was built entirely from a squatted, redirected domain serving
unrelated Vietnamese football-livestream content. Robert's framing, which this audit takes as its
starting assumption: the pipeline currently treats "business → supplied domain → whatever that
domain currently serves" as equivalent to "business evidence," and that assumption is unsafe —
domains expire, get hijacked, redirect, or get compromised, independent of anything the pipeline
itself does wrong.

---

## How to read the classification

Every signal below is rated one of four ways:

- **Already protected** — a real, working check exists today that would have caught this specific
  failure mode.
- **Partially protected** — real extraction/signal exists, but nothing compares or acts on it in a
  way that would reliably have caught this failure.
- **Missing** — the signal isn't captured, compared, or acted on anywhere; a real gap to close, not
  a broken thing to fix.
- **Unsafe** — worse than merely missing: either a real signal was captured and then discarded
  before it could ever be used, or the current design produces active false confidence (a
  clean-looking pass) specifically because nothing checks this dimension.

Every claim below is grounded in a specific file/line read directly, or a specific database row
queried directly, during this audit — not inferred from documentation or memory.

---

## Signal inventory and protection classification

### 1. Business name — **Missing**

Captured at discovery (`leads.business_name`, from `DiscoveredBusiness.name`,
`lib/adapters/discovery-adapter.ts:156`) and again, independently, whenever the crawler reads a
page's `<title>` (`crawl-adapter.ts`'s `title` field) — but **the two are never compared anywhere**.
Confirmed by searching every service file for a `title`/`business_name` cross-check: the only
place `crawl.title` is read at all is `lead-scoring-service.ts:250`'s legitimacy gate, which checks
only that a title exists and is non-empty — never its content. A page titled "Xoilac TV | Xem Trực
Tiếp Bóng Đá HD" passes this exact check as readily as a page titled "The Freight House Cafe |
Home."

### 2. Address — **Unsafe**

`DiscoveredBusiness.address` (OSM's own address tag, an independent pre-crawl signal —
`discovery-adapter.ts:162`) is **extracted by the discovery adapter and then silently dropped**
before it ever reaches persistence: `leads` (`supabase/migrations/0018_lead_hunter.sql`) has no
`address` column at all, and `lead-hunter-service.ts:277-310`'s two `upsertLead` call sites never
write it. The crawler's own address extraction (`extractAddress`, JSON-LD or labeled,
`crawl-adapter.ts:438`) is real and well-provenanced — it correctly captured a Ho Chi Minh City,
Vietnam address for this exact lead — but with no independent OSM address ever persisted to compare
it against, and no plausibility check of any kind (e.g. country/region sanity), a geographically
impossible address for a claimed Mahopac, NY business sat in the data, fully captured, doing
nothing. This is rated **Unsafe** rather than merely Missing because the independent, corroborating
signal existed and was thrown away before it could ever help — the gap isn't "we never had this
information," it's "we had it and discarded it."

### 3. Phone — **Unsafe** (identical shape to Address)

`DiscoveredBusiness.phone` (`discovery-adapter.ts:159`) is extracted and likewise never persisted
to `leads` — no `phone` column exists there either. The crawler's own phone extraction
(`extractContact`, `crawl-adapter.ts:470`) is genuinely excellent — real provenance
(`phoneEvidence[].source: "json-ld"`), E.164 normalization — and it correctly captured
`+849078965432` (a Vietnamese number) for a business whose name and target market both say
Mahopac, NY. No country-code plausibility check exists anywhere, and there is no independent phone
to check it against, because the one independent phone this system already had access to (OSM's)
was discarded at the exact same point the address was.

### 4. Domain — **Unsafe** — this is the core assumption Robert named

Whatever `requestedUrl` currently resolves to is unconditionally treated as this business's real
website, for the entire lifetime of a lead and every mission built from it. No mechanism anywhere —
discovery, qualification, promotion, or mission-level crawl — ever asks "does this domain still
belong to this business." This single sentence is the precise architectural gap the rest of this
audit's findings are downstream symptoms of.

### 5. Title/meta tags — **Partially protected**

Existence is checked (`lead-scoring-service.ts:250`, `analysis-service.ts:150/166` penalize a
missing title). Content-relevance to the business name is **Missing** — see #1.

### 6. Contact page content — **Partially protected**

The extraction itself (`extractContact`, `crawl-adapter.ts:470-521`) is genuinely well-built: real
provenance per field (`phoneEvidence`/`emailEvidence`/`addressSource`), JSON-LD preferred over
DOM heuristics, E.164 normalization. The gap is entirely on the verification side, not extraction —
nothing reads this rich, well-provenanced data back against any independent signal. Excellent
plumbing, connected to nothing.

### 7. Structured data (schema.org/JSON-LD) — **Partially protected, with one specific cheap gap**

`telephone`, `email`, `address`, `openingHours`, `sameAs`, and `aggregateRating` are all extracted
with real provenance (`JsonLdEntity` interface, `crawl-adapter.ts:107-116`). **`name` and `@type` —
arguably the single cleanest identity signal a real business site can publish (schema.org
`LocalBusiness`/`Organization` with a `name` field) — are not even parsed.** `JsonLdEntity`'s own
type declaration has no `name` or `@type` field at all; if a squatted page's own JSON-LD declared
`"@type": "WebSite", "name": "Xoilac TV"` (a very plausible thing for a real site to do), that
information is discarded at the parsing step, before any comparison could ever happen. This is the
cheapest, highest-leverage gap in this entire inventory — the extraction mechanism to read it
already exists two lines away from every other JSON-LD field this file already extracts.

### 8. Social links — **Missing** (and partly blocked on future capability)

`extractSocials` (`crawl-adapter.ts:546`) captures Facebook/Instagram/etc. links from JSON-LD
`sameAs` and direct hrefs. Nothing verifies the linked profile's own declared name/category matches
the business — but that verification would require actually fetching those platforms' own data
(a Phase 15/media-acquisition-shaped capability that doesn't exist yet), not something buildable
purely from data already on hand. Flagged as Missing, with the caveat that closing it fully depends
on capability Phase 14 shouldn't try to pre-build.

### 9. Google/business-profile info — **Missing, categorically — no such integration exists**

Not "unused" — **absent from the codebase.** `discovery-adapter.ts`'s own header comment states
plainly: OpenStreetMap was chosen "specifically because Robert has no Google Places/Yelp Fusion API
key configured (`.env.local` has no business-directory credential at all)." There is no Google
Business Profile data anywhere in this pipeline to cross-check against, at any stage.

### 10. Redirect behavior — **Unsafe** — the single cheapest, highest-value fix in this whole audit

`CrawlRawResult.requestedUrl` and `finalUrl` are both captured, every single crawl, already
(`crawl-adapter.ts:1884-1899` construction, unchanged since Phase 1). Searching every service file
that consumes a `CrawlRawResult` confirms: **no production code — `business-intelligence-
service.ts`, `lead-scoring-service.ts`, `analysis-service.ts`, `design-brief-service.ts` — ever
reads or compares these two fields.** Every test fixture in the codebase that sets both fields sets
them equal to each other; none exercises a redirect-mismatch case. The data proving a redirect
happened is captured faithfully on every single crawl this system has ever run and has never once
been looked at. Rated Unsafe, not Missing, because the fix requires zero new extraction — only
reading a field that already exists.

### 11. Domain changes over time — **Missing**

No history/versioning of "what did this domain resolve to last time" exists anywhere. Proven
concretely by this exact case (see the trace below): the same lead's domain resolved to three
different unrelated targets across eight days, and nothing in the system has any way to notice the
target kept changing, because nothing persists a prior observation to compare a new one against.

### 12. Category/content mismatch — **Partially protected, late and expensive only**

The one place a mismatch actually got caught: Design QA's AI-derived `brandFit` and `conversion`
checks (`design-qa-service.ts`, run against the fully-generated design) graded **CRITICAL** for
this exact mission, correctly identifying that the assembled hero copy was "football live-stream
spam text" contradicting the stated business tone. This is real and worth crediting — but it is a
late, expensive, LLM-dependent catch, occurring only after Discovery, Qualification, Crawl,
Analysis, Design Brief generation (itself an LLM call), and Website Generation have all already
run to completion. The deterministic `trust` category — the mechanical, cheap, early check
structurally positioned to catch exactly this class of problem — **passed**, because it only
verifies "is this slot's value real crawled data," never "is this data about the right entity."
Nothing earlier and cheaper in the pipeline (crawl time, qualification time, promotion time) checks
for this at all.

---

## Summary table

| Signal | Classification |
|---|---|
| Business name (crawl vs. known) | Missing |
| Address (independent vs. crawled) | Unsafe |
| Phone (independent vs. crawled) | Unsafe |
| Domain (ownership/currency) | Unsafe |
| Title/meta tags | Partially protected |
| Contact page content | Partially protected |
| Structured data (JSON-LD) | Partially protected |
| Social links | Missing |
| Google/business-profile data | Missing (no integration exists) |
| Redirect behavior (`requestedUrl` vs `finalUrl`) | Unsafe |
| Domain-change history | Missing |
| Category/content mismatch | Partially protected (late, AI-derived only) |

Not one signal in this inventory is rated **Already protected**.

---

## Case trace: The Freight House Cafe, reconstructed from the real, persisted data

Every timestamp and value below was queried directly from the hosted database and the live domain,
during this audit — not reconstructed from memory of the earlier investigation.

**2026-08-27, 02:42:52 UTC — Discovery.** Lead Hunter's OSM/Overpass scan of "Mahopac" discovers a
business named "The Freight House Cafe" at `website_url: https://thefreighthousecafe.com/`.
Whatever OSM-tagged phone/address `DiscoveredBusiness` carried for this specific candidate is not
recoverable now — it was never persisted (see Signal #2/#3 above). This is itself a small,
concrete demonstration of the gap: the one independent corroborating signal this system had a
chance to keep is now unrecoverable precisely because nothing keeps it.

**2026-08-27, 02:43:13 UTC — Qualification crawl.** `thefreighthousecafe.com` already redirects —
`finalUrl` resolves to `https://www.ohmybot.io/`, serving Vietnamese football-livestream content
("Xoilac TV"). The crawler's own JSON-LD extraction faithfully captures, with real provenance:
phone `+849078965432` (source: `json-ld`), email `support@xoilac1.site`, address in Ho Chi Minh
City, Vietnam (source: `json-ld`). `leads.website_score: 100` (the squatted site is itself a
well-built, technically excellent site — the score is honestly measuring real structure, just of
the wrong entity), `opportunity_score: 0`, `confidence_score: 63`. `leads.status` is set to
`candidate`, not `rejected` — under the current legitimacy gate, a real, well-built, structurally
complete website (regardless of whose it is) does not trigger rejection; only a genuinely
missing/broken site does (`lead-scoring-service.ts:334`'s reject reasoning is specifically "no real,
verifiable evidence... no phone/email, address, services, internal site structure, or homepage
title captured" — this candidate has all of those, just for the wrong business). The obvious
geographic mismatch — a Ho Chi Minh City address and Vietnamese phone number for a business the
system itself geocoded to Mahopac, NY — sits fully captured in `leads.contact_evidence`, unused,
for the next seven days.

**2026-09-03, 11:51:23 UTC — Batch selection and promotion.** Scheduled run #8 calls
`findNextEligibleCandidate`, which orders `status = 'candidate'` leads for this location by
`opportunity_score DESC` (`lib/repositories/lead-repository.ts:71`). This lead — `opportunity_score:
0`, the lowest possible — is selected anyway, meaning it was very likely the only (or last)
remaining eligible candidate for "Mahopac" at that moment, not a case of it beating out better
options; a real, adjacent finding about candidate-pool depth, not this audit's core subject.
`promoteLeadToMission` (`lead-promotion-service.ts:60`) performs only a state-eligibility check
(`status === 'candidate'`, `website_url` present) — no re-verification of the domain's current
content happens at this step either.

**2026-09-03, 11:51:23 UTC — Mission-level crawl.** A fresh crawl runs as part of the mission
pipeline (separate from and independent of the qualification-time crawl nine days earlier).
`finalUrl` now resolves to `https://retrolog.io/` — **a third, different domain** than the one seen
at qualification (`ohmybot.io`) — same content network (Vietnamese football-streaming), different
specific squatter target. Nothing compares this crawl's `finalUrl` against the qualification-time
crawl's `finalUrl` to notice the redirect target had changed again; nothing compares either
`finalUrl` against `requestedUrl` at all (Signal #10).

**Design Brief generation (LLM step).** Built from the business's real, correct `business_name`
("The Freight House Cafe") plus the contaminated crawl evidence. The result: `heroThesis`: *"A café
built inside a real freight house — not a theme, an address"* — a plausible, confident narrative
with no basis in any real evidence about this business's actual space. `signatureElement
.justification` claims *"19 real photos of the actual space and food"* — every one of the 19 gallery
images is a football-related photo from the retrolog.io content network; none depict a café.

**Design QA.** `trust` category: **PASS**, zero findings — every slot's value is real crawled data,
which is all this deterministic check verifies. `brandFit`: **CRITICAL** — *"the assembled headline
copy has nothing to do with a café, freight-house setting, or food — it is football live-stream
spam text."* `conversion`: **CRITICAL** — *"will destroy trust and likely cause visitors to
bounce."* Overall QA verdict: **FAIL**.

**Founder-review gate.** Mission parks at `state: approval`, proposal `status: draft`. No
send/approval event exists in the mission's timeline. No email-sending capability exists anywhere
in this codebase at all (confirmed separately, unrelated to this audit) — so beyond the state gate
holding correctly, there was never any mechanism by which this could have reached a real inbox.

**2026-09-04 (today, live check during this audit) — the churn continues.**
`thefreighthousecafe.com` now redirects to a **fourth** domain, `yuanprofit.io` — confirming this
is an actively rotating squatter/parking operation, not a one-time incident that has since settled.

### What this trace demonstrates about the failure's shape

This was not a single point of failure. It was the *same* missing check — "does this domain still
represent this business" — absent independently at four separate, sequential stages (qualification,
promotion, mission-crawl, design generation), each of which had a real opportunity to catch it using
data it already had on hand. The one stage that did catch something (QA's AI-derived checks) caught
the downstream *symptom* (nonsensical hero copy), not the root cause, and only after four earlier
stages' worth of real compute and one real LLM call had already been spent generating a fully
fabricated proposal. The founder-review gate and the QA FAIL verdict are the reason nothing worse
happened — they are not evidence that identity verification is working; they are evidence that the
safety net downstream of it is.
