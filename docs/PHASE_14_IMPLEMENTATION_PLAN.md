# Phase 14 — Implementation Plan: Business/Domain Identity Verification Gate

Planning document only. No code written, no migration run, no dependency installed, no commit.
Governed by the already-reviewed `docs/PHASE_14_IDENTITY_VERIFICATION_AUDIT.md` — this document
turns that audit's 12-signal inventory into a concrete architecture: where the gate sits, how
signals combine into a verdict, what each verdict actually does to a mission, and how The Freight
House Cafe resolves under it. Where this plan names a file/line, it was read directly from the
current codebase during this planning pass, not assumed.

Central framing, Robert's own: this is a **confidence/risk gate**, not a brittle "everything must
match" rule. Real businesses legitimately get new phone numbers, move addresses, rebrand domains,
or run their entire web presence through a parent company's site or a third-party ordering
platform. A design that fails a mission over any single mismatched field would create a different,
equally bad failure mode — rejecting good prospects. Every design choice below is checked against
that constraint, not just against catching Freight House.

---

## 1. Exact architecture touchpoints

### 1.1 Where the gate sits, precisely

The gate runs inside `runDesignBrief()` (`lib/services/design-brief-service.ts:300`), at the exact
point where a completed website analysis has just been confirmed (line 327: `if (!analysisRow ||
analysisRow.status !== "complete")`) and **before** the existing `analyzing -> researching`
transition (line 321-323) and before `normalized`/`citedInsights`/the Design Brief LLM call (line
337+).

This is the one function every mission path funnels through before Design Brief or Website
Generation ever runs, regardless of entry path — confirmed by tracing both callers:
`mission-batch-service.ts:128-129` (`createDesignBriefRun` → `runDesignBrief`, the scheduled/manual
batch path) and the same two functions' own doc comment naming `POST /api/missions/:id/design-
brief` as the second, independent manual-dashboard entry point. Both converge on the identical
`runDesignBrief()` call — inserting the gate there, once, covers every path. Inserting it only in
`mission-batch-service.ts` instead would miss manually-created missions entirely; that was
considered and rejected.

### 1.2 What data the gate reads

Not just `NormalizedAnalysis` (`analysis-types.ts`) — that type does not currently carry
`requestedUrl`/`finalUrl`/`title` at all (confirmed: absent from its field list, `analysis-
types.ts:151-190`). The gate needs the **raw** `CrawlRawResult`, via `normalizeCrawlRawResult()`
(`lib/adapters/types.ts:212`) on `website_analyses.crawl_result` — the same jsonb column
`runDesignBrief` already loads (`analysisRow`, line 326) — for `requestedUrl`, `finalUrl`, `title`,
`metaDescription`, `contact` (with its `phoneEvidence`/`emailEvidence`/`addressSource`
provenance), `socials`, and (once §5 below is built) JSON-LD `name`/`@type`. It also reads the
mission's own already-known identity: `mission.business_name` (always present, set at
`createMission` time) and, where available, the lead's preserved OSM signal (§4) and the batch's
own known location/geography (`mission_batch_runs.location`, or the lead's own `latitude`/
`longitude` reverse-geocoded).

### 1.3 New module: `lib/services/identity-verification-service.ts`

A new, single-purpose service, mirroring the "services have one job each" split this codebase
already holds every other stage to (`OpportunityScoringService` is separate from `AnalysisService`
for the identical reason). One exported function, shaped like:

```
verifyBusinessIdentity(input: {
  businessName: string;
  expectedLocation: { raw: string; latitude: number | null; longitude: number | null } | null;
  osmPhone: string | null;      // §4
  osmAddress: string | null;    // §4
  crawl: CrawlRawResult;        // requestedUrl, finalUrl, title, contact, socials, jsonLd (§5)
}): IdentityVerificationResult
```

Never calls the database itself, never calls an LLM, never mutates anything — a pure function over
already-gathered evidence, same shape as `resolveIndustryBucket`/`generateInsights`/every other
deterministic decision function in this codebase. `runDesignBrief()` calls it, reads the verdict,
and acts on it (§7); the module itself has no opinion on what a verdict *does* to a mission.

### 1.4 New persistence: a dedicated table, not a mission column

Following the exact precedent `supabase/migrations/0025_mission_batch_runs.sql`'s own header
comment states explicitly ("the same 'keep entities separated' precedent 0018/0021's own header
comments already document... conflating the two funnels would be exactly the mistake those two
migrations' own comments already warn against") — a new table, not a jsonb blob bolted onto
`missions`. Proposed (naming/shape only, not written): `identity_verifications` — `id`,
`mission_id` (FK), `organization_id`, `verdict` (`'confirmed' | 'uncertain' | 'failed'`), `signals`
(jsonb — every individual signal's own verdict and short reasoning, for founder/audit visibility),
`suppressed_evidence_categories` (text[], §8), `created_at`. One row per identity check; a mission
whose analysis is ever re-run gets a new row, same "append, never overwrite" discipline
`mission_batch_runs.results` already uses. Would land as `supabase/migrations/0027_...sql` — the
next unused number (`0026` is the current latest).

---

## 2. Identity signals used, and how each is computed

All eight of Robert's named signals, plus how each maps to data that either already exists or is
newly preserved/extracted by this plan:

| Signal | Data source | New or existing? |
|---|---|---|
| Requested-vs-final URL (redirect) | `CrawlRawResult.requestedUrl`/`finalUrl` | **Existing**, unread until now (audit §10) |
| Business name match | `mission.business_name` vs. crawled `title`/JSON-LD `name`/H1 | Existing name; new comparison |
| Address match | Crawled `contact.address` vs. preserved OSM address (§4) or expected-region sanity | New comparison; §4 restores the independent side |
| Phone match | Crawled `contact.phones`/`phoneEvidence` vs. preserved OSM phone (§4) or country-code sanity | New comparison; §4 restores the independent side |
| JSON-LD name/type | New `JsonLdEntity.name`/`@type` fields (§5) | New extraction |
| Domain/brand relationship sanity | Normalized business name vs. the registrable domain's own SLD text | New comparison, needs no new data |
| Content/category match | Crawled page's real content vs. the mission's own known industry bucket | New comparison, reuses existing category vocabulary (§9) |
| Redirect destination classification | `finalUrl`'s registrable domain + a small parked/spam-pattern check (§9) | New, deliberately narrow heuristic |

Redirect handling itself is detailed separately in §6, since it's both a signal and a
classification problem with its own sub-cases (same-domain, different-registrable-domain,
known-third-party-platform, parked/spam).

---

## 3. Scoring/confidence methodology — not a brittle exact-match rule

Directly modeled on a pattern this codebase already uses and Robert has already approved:
`lead-scoring-service.ts`'s `computeMakeoverPotential` combines multiple real signals into a
five-tier verdict (Reject/Low/Medium/High/Very High), never a single brittle rule. Identity
verification reuses that shape, collapsed to three tiers.

**Step 1 — each signal resolves independently to one of three states**, never a binary
pass/fail on its own: `match` (positive evidence this is the right business), `mismatch` (evidence
against it), or `inconclusive` (the signal wasn't available or doesn't apply — e.g. no JSON-LD on
this site at all, or no independent OSM address ever existed for this lead). A signal that's
merely absent is `inconclusive`, never silently treated as `mismatch` — this is the single most
important rule for avoiding brittleness: a legitimate business missing structured data isn't
evidence against it.

**Step 2 — combine into a verdict by corroboration, not by counting or averaging:**

- **`IDENTITY_FAILED`** requires **at least two independent `mismatch` signals that corroborate
  each other**, at least one of which is a *structural* signal (redirect to an unrelated
  registrable domain, or a redirect classified as parked/spam per §9) — never a single mismatched
  field alone. Concretely: "redirected to a different domain" *and* "JSON-LD name/type is
  unrelated or the target's own content matches a known spam/parked pattern" together are strong
  enough; "redirected to a different domain" alone is not (that alone could be a legitimate
  rebrand or a third-party platform — see §6/§8).
- **`IDENTITY_CONFIRMED`** requires **at least one `match` signal with no corroborated `mismatch`**
  — e.g. the business name appears in the title or JSON-LD `name`, or there was no redirect at
  all and the content matches the expected category. The bar to confirm is deliberately lower than
  the bar to fail: an ordinary, unremarkable crawl (the overwhelming majority of real missions)
  should resolve `CONFIRMED` without needing every signal to fire — most sites don't publish
  JSON-LD, don't redirect, and that's fine.
- **`IDENTITY_UNCERTAIN`** is the default for everything in between: a single uncorroborated
  `mismatch` (e.g. a new phone number with no other red flag — a legitimate rebrand/address-change
  case), or a genuinely thin evidence set (nothing matches, but nothing contradicts either — most
  signals `inconclusive`). This is intentionally the largest, "catch-all" bucket — resolving
  ambiguity honestly to a human rather than forcing a confident-sounding answer either direction is
  the entire point of a three-state model instead of a boolean one.

**Step 3 — every verdict carries its reasoning**, not just a label: which signals fired, what they
found, in plain language — stored in `identity_verifications.signals` (§1.4), so a founder
reviewing an `UNCERTAIN` mission (or, later, auditing a `FAILED` one) sees exactly why, the same
transparency discipline `design-qa-service.ts`'s own `reasoning` fields already model.

---

## 4. OSM data preservation (fixing the audit's "Unsafe" finding)

The audit found `DiscoveredBusiness.phone`/`.address` (`discovery-adapter.ts:159,162`) extracted
and then silently dropped before `leads` insert (`lead-hunter-service.ts:277-310`). This plan
restores it:

- **New columns on `leads`**: `discovery_phone text`, `discovery_address text` (nullable — Discovery
  finding a business with neither is real and already-handled elsewhere in this codebase's own
  "never fabricated into having one" discipline for `website_url`). Migration only — no existing
  column changes, no backfill needed for historical rows (they simply have `null`, correctly
  meaning "not captured," the same honest-gap convention every other late-added optional field in
  this codebase already uses).
- **One-line addition** to both `upsertLead` call sites in `lead-hunter-service.ts` (lines 277-310)
  to pass `discovery_phone: candidate.phone, discovery_address: candidate.address` through —
  `candidate` (the `DiscoveredBusiness`) already has both fields; this is wiring, not new
  extraction.
- **Consumption**: `identity-verification-service.ts` reads these two columns (via the mission's
  linked lead, where one exists — a manually-created mission with no lead has neither, and that's
  an honest `inconclusive` for this signal, never a fabricated one).

This is the one signal-preservation fix with zero ambiguity about whether it's worth doing: the
data is already extracted today, for free, by code that already runs — this only stops it being
thrown away immediately afterward.

---

## 5. JSON-LD business identity extraction (fixing the audit's second "Partially protected" gap)

`JsonLdEntity` (`crawl-adapter.ts:107-116`) currently types `telephone`, `email`, `address`,
`openingHours`, `openingHoursSpecification`, `sameAs`, `aggregateRating`, `@graph` — never `name`
or `@type`. This plan adds both:

```
interface JsonLdEntity {
  name?: string;
  "@type"?: string | string[];
  // ...existing fields unchanged
}
```

Two new fields, read the same defensive way every existing field already is (`entities.map(e =>
e.name).find(...)`, mirroring `crawl-adapter.ts:512`'s existing `formatJsonLdAddress` pattern for
address). This is the cheapest fix in this entire plan: the parsing mechanism (`parseJsonLdEntities`,
line 118) is completely generic already — it captures the whole parsed JSON-LD object per entity —
so `entity.name`/`entity["@type"]` are already sitting in memory at the exact point this file reads
seven other fields off the same object; only the type declaration and one small extraction call
are new. `identity-verification-service.ts` (not `crawl-adapter.ts` itself) is where this data
actually gets *compared* against `mission.business_name` — the extraction and the verification
logic stay in their own separate layers, same "adapters are I/O only" split this whole engagement
has held to since Phase 13.

**Note on scope**: this makes the raw JSON-LD `name`/`@type` values available on `CrawlRawResult`
for the identity gate to read — it does not add them to `NormalizedAnalysis` or thread them into
the Design Brief's own evidence bundle, since nothing there needs a business's self-declared
schema.org name as design content.

---

## 6. Redirect handling specifics

`requestedUrl` vs `finalUrl` classifies into four cases, each with a different weight in §3's
combination step:

1. **No redirect, or redirect within the same registrable domain** (`www.` prefix, a path change,
   an `http`→`https` upgrade) — the overwhelming common case. Neutral: contributes nothing to
   either `match` or `mismatch` on its own.
2. **Redirect to a different registrable domain whose own content corroborates the business**
   (business name appears in the new domain's title/JSON-LD, e.g. a genuine rebrand from
   `oldname.com` to `newname.com`) — `match` on the redirect-destination signal specifically, via
   the *content* corroboration, not the redirect itself.
3. **Redirect to a recognized third-party business-hosting platform** (§8) — `inconclusive` for
   the domain-mismatch signal specifically (a real business legitimately having its entire web
   presence on such a platform is common and not itself suspicious); other signals (does the
   platform page's own content name the business? does it match the expected category?) still
   apply independently and can still resolve the check either way.
4. **Redirect to an unrelated domain with no corroborating content, or a domain classified as
   parked/spam (§9)** — `mismatch`, and (per §3) a *structural* mismatch specifically, meaning it
   counts toward `IDENTITY_FAILED` when corroborated by one more independent mismatch (e.g. JSON-LD
   `name`/`@type` also unrelated) — exactly Freight House's shape (see §11).

The registrable-domain comparison (case 2-4's "different domain" test) uses the public-suffix-aware
root, not a bare string compare of full hostnames — `www.example.com` and `example.com` must never
register as "different domains" the way `example.com` and `unrelated-domain.io` correctly do.
(Implementation detail deferred: a public-suffix-list-aware parse, not a naive
`hostname.split('.')`, since multi-part TLDs like `.co.uk` would otherwise misclassify.)

---

## 7. Mission behavior — the three verdicts, precisely

### `IDENTITY_CONFIRMED`

No behavior change from today. `runDesignBrief()` proceeds exactly as it does now: transitions
`analyzing -> researching` (line 321-323), builds `citedInsights`, calls the Design Brief LLM,
transitions to `reviewing`. A row is written to `identity_verifications` (verdict `confirmed`,
signals recorded) purely for visibility/audit — it changes nothing about the mission's own path.

### `IDENTITY_UNCERTAIN`

Mission **proceeds** — this is deliberately not a stop. Two concrete, disclosed effects:

1. A row is written to `identity_verifications` with verdict `uncertain` and the specific
   reasoning. This is what a founder sees at the **already-existing** `reviewing` state — the
   Founder Approval Gate between Design Brief and Generation (`mission-state.ts:12-19`) — before
   ever approving the mission into `designing`/Generation. Phase 14 does not need to invent a new
   human checkpoint for `UNCERTAIN`; one already exists at exactly the right point in the sequence,
   and this plan reuses it rather than duplicating it (a dashboard surface for this is Phase 16's
   concern, not built here).
2. **"Don't let questionable evidence into the generated proposal"** — the one deliberate,
   narrowly-scoped second touch to `design-brief-service.ts`: when the verdict is `uncertain`,
   `runDesignBrief()` clears the *specific* `NormalizedAnalysis` fields the identity check itself
   flagged as suspect (e.g. `gallery`, `contactEvidence`) to their honest-empty defaults (`[]`, and
   the same `{ phones: [], emails: [], address: null, hours: null }` shape `analysis-types.ts`'s own
   private `EMPTY_CONTACT_EVIDENCE` constant already uses — a local equivalent, not an import of
   an unexported symbol) **before** building `citedInsights` or calling
   `generateDesignIntelligence` — never a partial edit of evidence content, only a substitution
   with the exact same "no real evidence here" shape this codebase already uses for a business that
   genuinely has none. `generateInsights`/`buildCitations`/`design-intelligence-service.ts` do not
   change at all — they keep working on whatever `normalized` object they're handed, exactly as
   today; they have no awareness identity verification ran.

### `IDENTITY_FAILED`

Mission **stops before `researching`, before any Design Brief work happens at all.**
`runDesignBrief()` calls the existing `rejectMission()` (`lib/workflow/mission-workflow.ts:209`)
instead of `transitionMissionState(..., "researching")` — using the state machine's own existing,
unmodified `rejected` side-transition (`canReject("analyzing")` is already `true`; no new mission
state is invented). `rejectMission`'s existing `reason` parameter carries the identity verdict's
own reasoning (e.g. *"Redirects to an unrelated domain (retrolog.io) with no corroborating business
identity; JSON-LD identifies the target as unrelated football-streaming content."*). The existing
`MissionRejected` event fires, exactly as it already does for any other rejection reason. A row is
written to `identity_verifications` with verdict `failed`. `design_briefs`, Website Generation, and
QA never run for this mission at all — not "run and then discarded," genuinely never invoked. This
is the literal mechanism that would have stopped Freight House before its 19 football-table photos
ever became "business evidence" (§11).

---

## 8. Third-party legitimate domain handling

A small, explicit, named allowlist of recognized business-hosting platform domains (Facebook,
Instagram, a small set of known ordering/menu platforms — Toast, Square, Clover, Linktree — the
exact list is an implementation-time detail, not fixed here) that the redirect classifier (§6 case
3) treats specially: redirecting to one of these is never itself treated as a structural mismatch,
regardless of registrable-domain difference, because it's a common and legitimate real-world
pattern this system has no business penalizing. Every *other* signal still applies independently —
a Facebook redirect whose page content has nothing to do with the named business is still eligible
to resolve `UNCERTAIN` or (with enough independent corroboration) `FAILED` on its own separate
merits, just never purely because "the domain changed to facebook.com."

This list is deliberately narrow and explicit rather than a heuristic ("looks like a big platform")
— an unrecognized redirect target gets no special treatment and falls through to the ordinary
case-4 classification in §6.

---

## 9. Parked/squatted/spam domain detection approach

Two independent, narrow, deterministic checks — never a machine-learning classifier, matching this
codebase's existing "mechanical, evidence-first, no black-box judgment" discipline everywhere else:

1. **Parking-page boilerplate detection**: a small, explicit phrase list matching real domain-
   parking/for-sale page conventions ("this domain may be for sale", "buy this domain", "domain
   parking", registrar-branded placeholder text) checked against the crawled page's own visible
   text — the same `cleanTextExcludingScripts`-style extraction this file already uses elsewhere,
   not a new fetch or a new dependency.
2. **Known spam-network content category detection**: a small, explicit keyword/structural
   signature for content categories that essentially never legitimately overlap with a local
   service business (illegal-streaming, gambling/casino, and pharmaceutical-spam vocabulary being
   the well-documented common ones squatted/hijacked domains redirect to) — real and demonstrated
   necessary by this exact case (the crawled title/metaDescription were literally in Vietnamese,
   about football livestreams, containing zero food/hospitality vocabulary).

Both checks are explicitly probabilistic, disclosed as such, and **never used alone** to reach
`IDENTITY_FAILED` per §3's corroboration rule — they're one of the two independent signals
`FAILED` requires, always combined with at least one more (redirect-to-different-domain, JSON-LD
mismatch, or business-name absence).

---

## 10. Mismatch handling — worked through the corroboration rule

Restating §3 concretely against the specific signal combinations Robert asked to see handled
without brittleness:

| Scenario | Signals fired | Verdict |
|---|---|---|
| New phone number, same domain, name matches | 1 `mismatch` (phone) only | `UNCERTAIN` |
| Rebranded domain, new name in title/JSON-LD corroborates | Redirect `match` (content corroborates) | `CONFIRMED` |
| New address (business moved), everything else matches | 1 `mismatch` (address) only | `UNCERTAIN` |
| Redirects to Facebook, Facebook page names the business | Domain `inconclusive` (allowlisted), name `match` | `CONFIRMED` |
| Redirects to Facebook, page content unrelated to the business | Domain `inconclusive`, name `mismatch`, content-category `mismatch` (2 corroborating) | `FAILED` |
| Redirects to unrelated domain, JSON-LD also unrelated | 2 corroborating structural `mismatch`es | `FAILED` |
| No JSON-LD, no redirect, thin content, name doesn't clearly appear | Mostly `inconclusive`, no strong `match` or `mismatch` | `UNCERTAIN` |

---

## 11. Freight House Cafe as the primary regression/acceptance test

Traced against this exact design, using the real signals the audit already recovered:

- **Redirect**: `requestedUrl: https://thefreighthousecafe.com/` → `finalUrl:
  https://retrolog.io/` (at the Sep 3 mission-level crawl) — a different registrable domain, not
  an allowlisted third-party platform → structural `mismatch`.
- **JSON-LD name/type** (once §5 exists): the crawled page's own JSON-LD, if present, would
  identify itself as unrelated to a café (the real page was Vietnamese football-streaming content;
  even without JSON-LD specifically, `title`/`metaDescription` alone — "Xoilac TV | Xem Trực Tiếp
  Bóng Đá HD" — corroborate independently) → `mismatch`.
- **Business name match**: "The Freight House Cafe" appears nowhere in the crawled title, meta
  description, or content → `mismatch`.
- **Content/category mismatch**: expected category (restaurant/café) vs. actual crawled content
  (sports-streaming) → `mismatch`, and independently flaggable via §9's spam-content-category check.
- **Phone/address** (once §4 exists — not recoverable for the historical row, but would be for any
  future one): even without an OSM phone/address to compare against for this specific historical
  case, the crawled contact evidence itself (`+849078965432`, a Ho Chi Minh City address) combined
  with the mission's own known expected geography (Mahopac, NY, from the batch's own `location`)
  is a further independent corroborating `mismatch`.

**Result: at minimum two, in practice four, independent corroborating structural mismatches —
resolves `IDENTITY_FAILED`.** `runDesignBrief()` calls `rejectMission()` instead of transitioning to
`researching`. `citedInsights` are never built, `generateDesignIntelligence` is never called, no
gallery of football photos is ever mislabeled as "the actual space and food," Website Generation
never runs, QA never runs. The mission reaches `state: rejected` directly from `analyzing`, with a
real, specific reason recorded, instead of reaching `state: approval` with a `FAIL`-graded but
fully-generated, fabricated proposal. This is the concrete, mechanical difference this phase
produces for the exact case that started it.

---

## 12. Test cases beyond Freight House

Described, not written, matching this plan's own no-code instruction.

1. **Freight House Cafe** (§11) — primary regression case. Expected: `IDENTITY_FAILED`, mission
   rejected before `researching`.
2. **Legitimate rebrand**: a fixture where `finalUrl` is a different registrable domain, but that
   domain's own title/JSON-LD `name` contains the business's name (a real "we changed our domain"
   case). Expected: `CONFIRMED` — the redirect's content corroboration wins, no penalty for the
   domain having changed.
3. **Legitimate address/phone change**: same domain throughout, `contact.phones`/`address` differ
   from whatever independent OSM value exists (§4), nothing else mismatches. Expected: `UNCERTAIN`
   — a single uncorroborated mismatch, never `FAILED` alone.
4. **Parked domain, no content at all**: `finalUrl` differs, page is a bare registrar placeholder
   matching §9's phrase list, no business-name content anywhere. Expected: `FAILED` — parking-page
   detection plus business-name absence, two corroborating signals.
5. **Third-party ordering platform (legitimate)**: `finalUrl` redirects to an allowlisted platform
   domain (§8), whose own page content clearly names the business. Expected: `CONFIRMED`.
6. **Third-party platform, wrong page (real risk case)**: redirects to an allowlisted platform
   domain, but the specific page found has no relation to the named business (e.g. a stale/wrong
   Facebook Page ID). Expected: `UNCERTAIN`, not `FAILED` — the domain itself is allowlisted
   (inconclusive), and only one corroborating mismatch (content) exists.
7. **Genuinely correct match, ordinary case**: no redirect, title contains the business name,
   content matches expected category. Expected: `CONFIRMED` — this must be the overwhelmingly
   common outcome; a regression suite heavy on this case matters as much as the failure cases, to
   prove the gate doesn't become a false-positive machine.
8. **Ambiguous/thin evidence**: a real but very sparse site (no JSON-LD, generic single-page
   content, business name not clearly present but nothing contradicts it either). Expected:
   `UNCERTAIN` — mostly `inconclusive` signals, correctly resolved to "ask a human," not forced
   either direction.
9. **No lead/no OSM data at all** (a manually-created mission via the plain "new mission" dialog,
   never went through Lead Hunter): `osmPhone`/`osmAddress` are both `null` by construction (§4's
   own honest-gap convention). Expected: those two signals resolve `inconclusive`, never treated as
   a mismatch merely for being absent — the rest of the signal set (redirect, name match, content
   category) still functions normally.
10. **Multiple missions for the same company over time**: a `companies` row whose domain was
    `CONFIRMED` on a prior mission now resolves `FAILED` on a new one (the domain changed hands
    since). Expected: each mission's identity check is independent — no caching of a prior
    verdict as if domain trustworthiness were permanent. (Whether a *prior* `CONFIRMED` verdict for
    the same domain should ever count as a positive signal for a subsequent mission is a real,
    separate design question this plan deliberately leaves open rather than deciding here — it
    would require the `identity_verifications` table to be queried cross-mission, which is a
    reasonable future refinement, not required for this phase's own acceptance criteria.)

---

## 13. Protected files — must remain untouched

- `lib/services/lead-scoring-service.ts` — qualification/opportunity scoring math, entirely
  unmodified. Identity verification is a separate, independent verdict; it never changes
  `website_score`/`opportunity_score`/`confidence_score` or any makeover-potential tier.
- `lib/services/opportunity-scoring-service.ts`, `lib/services/opportunity-report-service.ts` —
  untouched; identity verification has no opinion on a business's opportunity.
- `lib/services/design-qa-service.ts` — untouched. QA's existing `trust`/`brandFit`/`conversion`
  checks keep working exactly as they do today; this plan doesn't change what QA does, only what
  reaches QA in the first place (a `FAILED` mission never gets there at all).
- `lib/services/design-generation-service.ts` — untouched. Website Generation is unreachable for a
  `FAILED` mission (rejected before `researching`, long before `designing`) and runs completely
  unmodified for `CONFIRMED`/`UNCERTAIN` missions.
- `lib/design-references/reference-library.ts` — untouched.
- `lib/design-intelligence/*` (composition-variants.ts, experience-planner.ts,
  capability-selector.ts) — untouched. None of this plan's logic touches motion/experience/hero-
  pattern decisions.
- `lib/adapters/crawl-adapter.ts`'s own extraction/merge functions — **unchanged in behavior**,
  except the one additive JSON-LD field described in §5 (two new optional fields read off data
  the file already parses; no existing field's extraction logic changes).
- `.github/workflows/nightly-batch.yml` — untouched, per Robert's explicit instruction this
  session; nothing about this plan requires a workflow change.

## Deliberate, disclosed exception: `lib/services/design-brief-service.ts`

Unlike Phase 13 (which held this file at zero diff), **this plan requires two small, precisely
-scoped changes inside `runDesignBrief()`**, stated plainly rather than avoided:

1. One new call to `verifyBusinessIdentity()` plus one new conditional branch, inserted before the
   existing `analyzing -> researching` transition (line 321) — on `FAILED`, calls `rejectMission()`
   and returns instead of proceeding; on `CONFIRMED`/`UNCERTAIN`, falls through to the function's
   existing, completely unmodified behavior.
2. On `UNCERTAIN` specifically, the specific `NormalizedAnalysis` fields the verdict flags are
   reset to their existing honest-empty defaults before `citedInsights`/`generateDesignIntelligence`
   are called (§7).

Everything below that point in the function — `buildCitations`, `resolveIndustryBucket`,
`selectReferenceDirections`, `findWeakestMeasuredCategory`, the `generateDesignIntelligence` LLM
call itself, and the `DesignBrief` object construction — is untouched. No change to
`design-intelligence-service.ts`'s own LLM prompt/logic, which has no awareness identity
verification exists.

---

## 14. Proof this doesn't alter qualification/scoring/opportunity/generation logic

Traced the same way Phase 13's plan proved its own "zero downstream changes" claim — by reading
every consumer, not asserting it:

- **Qualification/scoring**: `lead-scoring-service.ts` computes `website_score`/
  `opportunity_score`/`confidence_score`/makeover-potential entirely from `NormalizedAnalysis` and
  runs at Lead Hunter qualification time — **before** a lead is ever promoted into a mission, and
  therefore before `runDesignBrief()` (where this plan's gate lives) ever runs. The identity gate
  cannot retroactively change a score that was already computed and persisted long before promotion.
  Confirmed: this file has zero references to `identity_verifications`, `verifyBusinessIdentity`,
  or any new field this plan introduces.
- **Opportunity**: same reasoning — `opportunity-scoring-service.ts`/`opportunity-report-service.ts`
  operate on `NormalizedAnalysis` fields that are unrelated to and unmodified by this plan (the
  `UNCERTAIN` evidence-clearing in §7 touches `gallery`/`contactEvidence` specifically — neither
  feeds opportunity scoring, which is driven by SEO/mobile/accessibility/lighthouse/technical-health
  scores, confirmed by re-reading `opportunity-scoring-service.ts`'s own five category weights).
- **Generation**: `design-generation-service.ts` is unreachable for `FAILED` (mission never leaves
  `analyzing`) and receives an unmodified `DesignBrief` for `CONFIRMED` (nothing changed) and
  `UNCERTAIN` (only specific evidence fields honestly emptied, in exactly the shape the generator
  already handles for any business that genuinely lacks that evidence — `design-generation-
  service.ts` has no way to distinguish "gallery is empty because none exists" from "gallery is
  empty because identity verification cleared it," and doesn't need to; both are the same honest
  input it already knows how to handle).

**One deliberate, disclosed exception to "zero downstream changes," stated plainly rather than
avoided**: `design-brief-service.ts` itself gains a new early gate check and one conditional
evidence-clearing step (§13). This is not qualification, scoring, opportunity, or generation logic
— it is the identity-verification gate's own necessary integration point, exactly where Robert
asked it to sit ("stop the mission before generation"). No other file in the four protected
categories is touched.

---

## Recap: what happens if this phase is approved as scoped

One new service (`identity-verification-service.ts`, pure/deterministic, no LLM, no new
dependency), one new table (`identity_verifications`), two new nullable columns on `leads`
(`discovery_phone`/`discovery_address`, wired from data already extracted and previously
discarded), two new optional fields on `JsonLdEntity` (`name`/`@type`, parsed from data already in
memory), and one small, precisely-scoped, disclosed pair of changes inside
`design-brief-service.ts`'s `runDesignBrief()`. Every other file this engagement has held
protected across Phase 13 stays protected here. The Freight House Cafe mission, re-run under this
design, resolves `IDENTITY_FAILED` and stops before `researching` — before a single dollar of LLM
spend or a single fabricated sentence about "the actual space and food" is ever produced.
