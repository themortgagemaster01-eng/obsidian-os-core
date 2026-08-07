# Obsidian OS — Design Intelligence

**Status:** Living document, philosophy and standards, not implementation. Companion to `docs/MISSION_ENGINE.md` — where that document describes the subsystem that owns a mission's *workflow*, this document describes the standard a mission's *creative output* is held to once the Design stage exists. **Nothing in this document is implemented today.** It exists ahead of code, per `CLAUDE.md`'s workflow (design precedes implementation), so that when the Design Engine (`docs/SPRINT_4_DESIGN_REVIEW.md`) is eventually built and reviewed, "premium" has an actual written definition to build and grade against, rather than being decided ad hoc inside a generation prompt. Read alongside `docs/SPRINT_4_RESEARCH_SUMMARY.md` (the research this document draws on), `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md` (the architectural evaluation of how much of this should be codified in software now versus later), and `docs/09-UI-Design-System.md` (Obsidian's *own* product UI standard — related in spirit, not in specific values; see §3–§7 for why).

**This document is philosophy and standards. It does not propose file names, service boundaries, database schemas, or code.** That's `docs/SPRINT_4_DESIGN_REVIEW.md` and `docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md`'s job. This document answers a different question: once something builds a website, what is it actually trying to achieve, and how would a human — or, eventually, an AI — know whether it succeeded?

---

## 1. Design Philosophy

**The founder isn't buying HTML. They're buying confidence.** No one who uses Obsidian OS is paying for a website; they're paying for the moment a prospect's owner looks at what was generated and thinks, before reading a single word of the pitch, *this company deserves a better website.* That reaction — immediate, pre-rational, felt before it's reasoned about — is the actual product of the Design stage. A technically correct, on-brief, accessible site that doesn't produce that reaction has failed at the one thing this stage exists for, regardless of how many mechanical checklist items it satisfies (§12).

This sits alongside, and is a different kind of claim than, the evidence-first philosophy Sprint 3 established for the Opportunity Report (`docs/ARCHITECTURE_DECISIONS.md` ADR-013). The report's job is to be *trusted* — every claim traceable, every confidence rating honest, nothing overstated. The design's job is to *produce confidence in the reader*, immediately, on sight. These are not in tension, and neither substitutes for the other: a report a founder can trust, describing a redesign that doesn't actually look like it deserves that trust, fails just as completely as an impressive-looking design built on fabricated claims (§8's hardest rule). Both serve the same premise underneath every ADR in this codebase (ADR-000): the system prepares work good enough that a human can delegate labor to it without delegating judgment, in a five-minute review. A design that requires the founder to talk themselves into confidence — "well, it's fine once you get used to it" — has already lost. This document exists to make "does this produce that reaction" as close to a checkable, teachable standard as a qualitative judgment can be, rather than leaving it as an unexaminable vibe.

**Premium is not decoration.** `docs/VISION_GUARDRAILS.md` already commits Obsidian OS to a "premium-first" position — top-of-market register, not a race to the bottom on price or volume. Applied to generated output specifically: premium means the design demonstrates that real thought was given to *this* business, not that it carries more visual flourish than a competitor's output. A restrained, quiet, perfectly-typeset single page can be more premium than a heavily animated, densely decorated one — restraint is frequently the more expensive-looking choice, not the cheaper one, which is exactly why it's this document's repeated position rather than an aesthetic preference stated once and forgotten.

---

## 2. Premium Design Principles

The qualities that separate output worth showing a prospect from output that merely compiles:

- **Typography that does the hierarchy's work**, not size alone. Per typographic-hierarchy practice (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §7): contrast and spacing carry more of the perceptual weight than font size does. §3 below is the standard.
- **Whitespace as an active design decision**, not unused leftover space. Generous, deliberate space is what makes a design read as considered rather than compressed to fit content. §4 below is the standard.
- **Real hierarchy** — a reader's eye should land on the most important thing first without being told which thing that is. A page where everything is emphasized has emphasized nothing.
- **Editorial composition over templated assembly.** A page built section-by-section from a fixed template reads as assembled; a page whose structure follows the specific content and story of one business reads as composed. §5 below is the standard.
- **Restrained motion.** Motion that clarifies (what changed, what's now in focus) rather than motion that performs (movement for its own sake, to seem alive or modern). §6 below is the standard.
- **Business storytelling, not a feature dump.** The site's structure should follow the narrative order that makes sense for *this* business's actual value proposition, not a fixed section checklist executed in the same order regardless of what the business does.
- **Executive presentation.** The output should be something a founder would be comfortable putting in front of their own board, or the prospect's — a bar closer to "would this survive scrutiny from someone with real taste and real stakes" than "does this look acceptable at a glance."
- **Conversion-focused, not decoration-only.** Premium and functional are not in tension — the site still has to do its job (§9). A beautiful site that fails to make its CTA findable has not achieved a premium result, it has achieved an expensive-looking failure.

---

## 3. Typography Standards

**Heading hierarchy.** A small number of named type roles — display, heading (h1/h2/h3), body, caption/label — each with a defined relationship to the ones around it, not an unbounded set of ad hoc sizes chosen per page. Per the research, contrast between roles (weight, size, sometimes color/opacity) should do most of the differentiation work; spacing above and below a heading should scale with the heading's level in the hierarchy, not stay constant regardless of importance.

**Font pairing philosophy.** At most two type families per generated site — one for display/heading work, one for body, or a single well-chosen family used across weights if that better fits the business's register. The pairing is a per-mission decision made in the Design Brief (`docs/SPRINT_4_DESIGN_REVIEW.md` §3), informed by the business's industry and positioning, never a single fixed pair reused for every mission regardless of business — reusing one pairing everywhere is exactly the kind of drift toward templated sameness this whole document exists to prevent.

**Readability.** Body text line length in the range that's been standard practice for as long as readability's been studied for a reason — roughly 45–75 characters per line, not edge-to-edge on a wide viewport. Body line-height loose enough to read comfortably (roughly 1.4–1.6× the type size), tightening slightly for headings where the line length is short enough that looser leading reads as disconnected.

**Rhythm.** A consistent vertical rhythm — spacing between typographic elements that follows the same scale sitewide (§4), so a reader's eye can predict where the next unit of content starts without every section inventing its own spacing logic.

---

## 4. Spacing Standards

**Whitespace is an active element, not unused leftover space.** Per the research (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §7): whitespace gives the eye a place to rest, separates distinct sections without needing a visible divider to do the work, and is one of the two dominant levers (with contrast) for establishing hierarchy. Compressed, minimal-margin layouts read as budget, not efficient — this is a direct, repeated finding across the research, not a single source's opinion.

**Section spacing.** Generous, consistent vertical rhythm between major sections — enough that each reads as its own compositional unit, not so much that the page feels disconnected. A single spacing scale (a numeric proportion system) applied sitewide, the same discipline `docs/09-UI-Design-System.md` already holds Obsidian's own UI to, with mission-specific values rather than Obsidian's own specific numbers (§9 of the Design Review covers this distinction in full).

**Card/component spacing.** Internal padding and inter-element spacing within a component should be proportional to the component's role in the hierarchy — a hero's internal spacing is not the same scale as a footer link list's.

**Grid rhythm.** A consistent column/gutter system carried through the whole page, so alignment reads as intentional. Asymmetric layouts (§5) are not exempt from this — asymmetry achieved by deliberately breaking a grid reads differently, and better, than asymmetry achieved by having no grid at all.

**Visual balance as a measurable quality metric, not just a felt one.** Per Awwwards' precedent (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §7) of scoring design on named weighted dimensions rather than a single holistic impression: balance, hierarchy, and spacing consistency can be graded against explicit criteria in a QA pass (§12), the same way Sprint 3's Opportunity Report grades confidence per category rather than asserting an unexamined overall impression.

---

## 5. Layout Standards

**Avoid generic SaaS templates, named specifically so "avoid" is checkable rather than a vibe.** The pattern this document means: a centered hero with a headline/subhead/two-button row, followed by a row of icon-plus-short-text feature cards, a logo strip, a testimonial carousel, a pricing table, an FAQ accordion, and a footer — in that order, regardless of what the business actually does or needs to communicate. This structure exists because it's a safe default for software products with an unclear buyer; it is very rarely the right structure for a restaurant, a law firm, or a landscaping company (§10), and defaulting to it for those businesses is a primary way generated output ends up looking generic even when every individual section is well-executed.

**Prefer editorial layouts — asymmetric balance, visual storytelling, content hierarchy driven by the business.** Section order and relative visual weight should follow what actually matters most for *this* business's story — a restaurant might lead with imagery and atmosphere before a menu; a law firm might lead with credibility and outcomes before anything else; a fitness studio might lead with a class schedule and energy over either. This is the direct, positive counterpart to the Never Generate list's ban on cookie-cutter sections (§11) — not "never use a hero section," but "never use one because it's the default, only because it's the right choice for this business's story."

**External validation that this is a real, current concern.** A visible backlash against "AI sameness" — interchangeable dashboards, generic gradients — is a live, named concern in the wider design community as of this research (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §7), not a concern specific to this codebase. This doesn't license "visible imperfection" as a technique — that cuts against Obsidian's own restraint-over-cleverness register — but it does confirm the failure mode this document organizes against is real and currently active, not hypothetical.

---

## 6. Motion Standards

**Subtle, meaningful, restrained — motion reinforces clarity, never seeks attention.** A generated site's motion should answer "what just changed, what should I notice now" — a state transition, an entrance as content scrolls into view, feedback on interaction — and never exist purely to seem alive, modern, or impressive. No auto-playing carousels, no parallax scrolling used for spectacle rather than depth cues, no animation with no functional purpose.

**A restrained default band, adaptable per mission.** `docs/09-UI-Design-System.md` already establishes Obsidian's own product UI's motion discipline — roughly 200–300ms, `ease`/`ease-in-out` timing, never bounce or spring. That specific discipline, not the specific product it governs, is the right default starting point for generated output too, per `docs/SPRINT_4_DESIGN_REVIEW.md` §9's schema-vs-values distinction — deviated from only when a specific business's positioning genuinely calls for something more energetic (a fitness studio, a nightlife venue), and that deviation should be a deliberate Design Brief decision, not an unconstrained default.

**A tunable intensity, not a fixed absolute.** TasteSkill.dev's approach (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §7) of treating motion as a numeric dial — adjustable per project within a bounded range, rather than either globally fixed or globally unconstrained — is a useful model for how this standard could eventually be applied per mission: a bounded range, not a single fixed value, with the *bound itself* (never bounce/spring, never motion with no functional purpose) being the non-negotiable part.

---

## 7. Mobile Standards

**Mobile-first is the expectation, not an accommodation.** Most of a small local business's actual prospective customers browse on mobile — and this is not just a general web-industry truism for this product specifically: Mobile is already one of the five categories the Analysis Engine measures and scores (`docs/ARCHITECTURE_DECISIONS.md` ADR-011, `opportunity-scoring-service.ts`). A generated redesign that scores poorly on the same axis the Opportunity Report used to justify the redesign in the first place would be a direct, embarrassing self-contradiction — not just a quality gap.

**Touch targets.** Interactive elements sized and spaced for a finger, not a cursor — no controls so small or close together that mobile interaction becomes error-prone.

**Scrolling rhythm.** Sections should collapse cleanly to a single column at mobile widths with no orphaned or cut-off content, and the section-to-section rhythm (§4) should hold at mobile scale, not just desktop scale — a spacing system that only looks considered on a wide viewport isn't actually a system.

**Readability at mobile scale.** Type sizes shouldn't shrink below a genuinely readable floor just to preserve a desktop layout's proportions; line length (§3) needs its own mobile-scale treatment, not a naive scale-down of desktop values.

**Performance.** A generated redesign that is slower than the original site it's replacing is not a credible pitch for a business whose actual problem, per the Analysis Engine, may well have been a slow-loading site. Performance discipline here should be treated with the same seriousness Sprint 3 treats it as a measured category, not an afterthought specific to the Design stage's own output.

---

## 8. Trust Patterns

**The single hardest rule in this document: never fabricate a trust signal.** A testimonial, a certification, an award, a client name, a years-in-business claim — every one of these must be sourced from real company/mission data or omitted. This is not a stylistic extension of ADR-013's "no unsupported claims" principle, it's arguably the single most damaging thing this system could ever generate if violated: a fabricated testimonial attributed to a real or plausible-sounding person, on a real business's prospective website, is a fabrication with real reputational and potentially legal consequence for both the business and Obsidian OS, in a way a merely-generic layout is not. Where real trust data doesn't exist yet (no captured testimonials, no known certifications), the correct behavior is the same evidence-first pattern the Opportunity Report already uses for a failed measurement (ADR-013) — omit the section, or mark it as a placeholder the business needs to supply, never invent a plausible-sounding substitute.

**What's real to draw from.** `companies` table fields, whatever the original site's own content genuinely stated (captured during the Analysis stage's crawl), and anything the founder or the business has explicitly supplied. Certifications, licenses, and awards specifically must trace to a real, checkable source — this is a category where "sounds right for this industry" is exactly the failure mode to guard against (a plausible-sounding but invented license number or certification body is worse than no certification section at all).

**Contact clarity.** Phone number, address, and hours visible without hunting, especially for the local-service industries this pipeline is aimed at (§10) — a premium design that hides how to actually reach the business has failed a basic functional requirement regardless of how polished it looks.

**Social proof and professionalism markers**, real ones only: review counts/ratings if genuinely known, years in business if genuinely known, service-area coverage if genuinely known. The standard throughout this section is identical: real and cited, or absent — never invented to fill a section that "should" have content.

---

## 9. Conversion Patterns

Principles, not one prescribed layout — the founder's own framing, restated as a firm constraint on this section: there is no single correct booking-flow or lead-form shape that fits Restaurant, Law Firm, and HVAC alike, and this document should not pretend otherwise.

- **CTA placement.** One clear primary action per page emphasized consistently, not the same action repeated so many times its emphasis dilutes, and not several competing actions given equal visual weight.
- **Booking flows and lead forms.** Ask for the minimum information needed to take the next real step, not everything a business might eventually want to know — friction in the form is friction in the actual pipeline this design exists to feed.
- **Service presentation.** Structured so a prospective customer can scan and understand what's offered without reading dense paragraph text — the specific shape (a grid, a list, a menu-style layout) is an industry- and content-driven Design Brief decision, not fixed here.
- **Pricing.** Transparent where the business's industry norm supports showing pricing (many home-service and retail-adjacent businesses), request-a-quote framed as the default where it doesn't (most professional services, custom/high-ticket work) — an industry-adaptive judgment (§10), not a single rule applied everywhere.
- **FAQ placement and content.** FAQ content should answer real, evidence-grounded objections — informed by what the Analysis stage's Insights actually surfaced about the business or its category, not a generic filler FAQ assembled from category stereotypes.

---

## 10. Industry Adaptation

Design priorities shift meaningfully by industry — this section names the shifts this document is aware of today as a starting reference, not an exhaustive or final list. Every row below is a direction to weigh in the Design Brief, not a rule that overrides real evidence about a specific business.

| Industry | What shifts |
|---|---|
| **Restaurant** | Imagery and atmosphere lead; menu/hours/reservation clarity is functionally critical; tone is warm, sensory, often locally-rooted rather than corporate. |
| **Law Firm** | Credibility and outcomes lead; tone is measured, authoritative, calm — not urgent or high-energy; case results/practice areas need clear, scannable structure; regulatory/advertising rules for legal marketing may constrain claims (a genuinely new compliance dimension this pipeline hasn't had to reason about for restaurants or landscapers). |
| **Dentist / Medical** | Trust and cleanliness read visually as much as verbally; patient comfort and approachability matter alongside credibility; genuine regulatory/compliance constraints apply to health claims specifically — this is the one category where §8's "never fabricate" rule has real legal teeth, not just reputational risk. |
| **HVAC / Landscaping / home-service trades** | Urgency and reliability lead (emergency service, response time); pricing transparency is generally expected and rewarded, unlike professional services; service-area and local-SEO signals matter more than for a destination business; mobile weighting is especially high — this is a category people search for from a phone, often urgently. |
| **Real Estate** | Imagery-heavy, individual-listing/agent presentation matters; trust in the individual agent/broker is often as important as the brokerage brand; local-market credibility signals matter. |
| **Fitness** | Energy and motion tolerance is higher than this document's general restraint default (§6) — a legitimate, evidence-grounded case for the "bolder direction" option `docs/SPRINT_4_DESIGN_REVIEW.md` Open Question 3 raises; class schedules and a clear trial/signup path are functionally critical. |
| **Luxury Services** | The strictest application of this whole document's restraint principle — understatement communicates luxury more effectively than visible effort or decoration; pricing transparency is typically low (request/consultation-framed, not listed); typography and whitespace discipline (§3, §4) carry more of the "premium" signal than anywhere else on this list, since there's little else the design is allowed to lean on. |

---

## 11. Never Generate List

A permanent guardrail list — each entry concrete and named, per the research finding that vague negative constraints ("don't look generic") don't reliably work while specific, named ones do (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §3). Each is paired with the positive standard it protects, elsewhere in this document, per the same finding that negative constraints work best paired with a positive alternative.

| Never generate | Why, and what to do instead |
|---|---|
| **A generic SaaS hero layout** (centered headline/subhead/two buttons) used without a content-driven reason | §5 — section order and structure should follow the business's actual story |
| **Cookie-cutter feature grids** — icon-plus-short-text cards used as a default filler pattern | §5, §9 — service/offering presentation should be shaped by the actual content, not a fixed grid reached for by default |
| **Random or decorative gradients with no semantic role** | §2, §6 of `docs/09-UI-Design-System.md`'s already-established discipline, extended here — color choices should be deliberate and tied to the mission's chosen palette (§9 of the Design Review), not applied for visual interest alone |
| **Generic AI-style illustrations** (the recognizable, interchangeable "AI stock art" look) | Use real photography of the business where available, or restrained, purposeful graphic treatment tied to the business's actual identity — never filler illustration whose only role is to occupy empty space |
| **Emoji used as icons** | Real iconography or none — emoji-as-icon reads as unconsidered and undermines §1's "executive presentation" bar immediately on sight |
| **Weak typography** — no real hierarchy, arbitrary sizes, no considered pairing | §3 is the positive standard |
| **Poor spacing** — cramped, inconsistent, or copy-pasted spacing values with no underlying scale | §4 is the positive standard |
| **Repetitive sections** — the same visual pattern (a card row, an icon list) reused multiple times on one page out of habit rather than need | §5's editorial-composition standard — vary structure to match varying content, don't force every content type into the same visual container |
| **Template-looking pages generally** — output indistinguishable, structurally, from another mission's output for a different business in a different industry | The clearest possible restatement of `docs/VISION_GUARDRAILS.md`'s "not a template marketplace" boundary — if two generated sites for different businesses could have their content swapped without the structure needing to change, that's a violation of this rule, not a coincidence to shrug off |
| **Visual clutter** — too many competing focal points, no clear resting point for the eye | §2, §4 — whitespace and hierarchy are what prevent this; clutter is what happens when they're skipped |

**This list is permanent in spirit, not frozen in wording.** Real generated output will surface failure modes this list doesn't yet name — this document should be updated when that happens, the same living-document discipline `docs/MISSION_ENGINE.md` and `docs/09-UI-Design-System.md` already hold themselves to, not treated as complete on the day it was first written.

---

## 12. Design QA Checklist

The final gate before founder review (`docs/SPRINT_4_DESIGN_REVIEW.md` §11's Human Approval Points, gate #4) — repeatable, measurable categories, each graded rather than impressionistically judged, per Awwwards' precedent of scoring named weighted dimensions instead of a single holistic score (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §7) and Sprint 3's own precedent of a discrete, named grading scale rather than a pass/fail binary.

| Category | What it checks | Target threshold |
|---|---|---|
| **Typography** | Hierarchy present and consistent (§3); pairing is deliberate, not default; line length/leading within readable range | No CRITICAL; MINOR acceptable only with a stated reason |
| **Spacing** | Consistent scale sitewide (§4); no cramped or arbitrary values; whitespace used deliberately | No CRITICAL |
| **Hierarchy** | A reader's eye has an obvious first landing point; nothing over-emphasized to the point everything competes equally | No CRITICAL |
| **Mobile** | Touch targets, scroll rhythm, readability, and performance verified at mobile viewport, not assumed from desktop (§7) | No CRITICAL — this category cannot pass on assumption, only on an actual rendered check |
| **Accessibility** | Baseline accessibility of the *generated output* itself — contrast, semantic structure, keyboard/screen-reader basics — distinct from the *target business's original site's* accessibility, which is what the Analysis Engine's accessibility adapter measures | No CRITICAL |
| **Performance** | Generated site's real load performance, not assumed acceptable because it's newly built (§7) | No CRITICAL; should not regress versus the original site's measured performance |
| **Trust** | Every trust signal present traces to real data (§8); no fabricated testimonial, certification, or claim anywhere | Any fabrication is an automatic CRITICAL and blocks handoff — the one category in this table with zero tolerance, not just a low tolerance |
| **Conversion** | A clear primary CTA; a low-friction path to the business's actual next step (§9) | No CRITICAL |
| **Executive presentation** | The qualitative bar from §1 and `docs/SPRINT_4_DESIGN_REVIEW.md` §12 — does this produce the "this company deserves a better website" reaction, on sight, without needing to be argued for | Explicitly the hardest category to grade mechanically (`docs/SPRINT_4_DESIGN_REVIEW.md` §7, §13 already name this gap honestly) — a human review point, not fully automatable today |

**A CRITICAL grade on any category blocks founder handoff**, mirroring the Opportunity Report's own rule that a failed measurement reads as "Unavailable" rather than shipping a plausible-looking but unearned result. Iteration against this checklist is capped at a small, fixed number of passes (`docs/SPRINT_4_ARCHITECTURE_RECOMMENDATION.md` §2's recommendation), not an unbounded loop chasing a perfect score.

---

## 13. Future AI Creative Director — long-term vision, not a build plan

Named explicitly as aspirational and out of scope for Sprint 4 or any near-term implementation — this section documents a direction worth having on record, not a commitment or an authorization to build any of it.

**Visual reasoning.** An AI component that can look at an actually-rendered page — not just the token values and structured data that produced it — and reason about whether it works, the way a human reviewer looks at a finished page rather than reading its CSS. Everything in §12 today is checkable mechanically or by a human; a genuine visual-reasoning capability would be what eventually makes categories like "executive presentation" checkable by the system itself rather than requiring a human gate for that judgment specifically.

**Design critique.** Not just grading against §12's checklist, but producing the kind of specific, actionable critique a skilled human reviewer gives — "the hero's type scale is too close to the body copy's, weakening the hierarchy" rather than a bare CRITICAL flag with no explanation. TasteSkill.dev's own stated purpose (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §7) — pushing sharper questions about audience and constraints rather than just generating — is the closest existing analogue to what this capability would need to do.

**Reference selection.** Autonomous, reasoned selection from a reference library (`docs/SPRINT_4_DESIGN_REVIEW.md` §8) — not just a tag-based lookup, but genuine judgment about which reference direction actually fits a specific business's positioning, with the reasoning behind that choice visible and reviewable, not a black-box recommendation.

**Typography evaluation and layout scoring.** An Awwwards-shaped weighted score (`docs/SPRINT_4_RESEARCH_SUMMARY.md` §7), computed automatically rather than requiring a human panel — the long-term version of §12's checklist, once visual reasoning is mature enough to trust for categories that today require a human.

**Creative recommendations.** Proactively suggesting a bolder or more conventional direction than a first pass produced, when evidence supports it — the long-term answer to `docs/SPRINT_4_DESIGN_REVIEW.md`'s Open Question 3 (should some missions get bolder, less restrained treatment) becoming a reasoned, per-mission judgment rather than either a fixed default or an unreviewed AI decision.

**What doesn't change, even in this long-term vision.** Every principle in §1–§11 remains the standard an AI Creative Director would be building and grading toward — this section describes a more capable *evaluator and collaborator*, never a relaxation of §8's zero-fabrication rule, §11's guardrails, or ADR-000's non-negotiable human-approval-before-anything-customer-facing commitment. A more capable AI Creative Director grades against a stricter, more nuanced version of this document's standards, not a looser one.
