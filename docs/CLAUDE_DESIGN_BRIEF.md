# Obsidian OS — Claude Design Brief
## High-End Hero + UI Intelligence Pack
### Copy this entire document to Claude when designing prospect preview websites.

> Status: Operational brief for Claude
> Audience: Claude designing Obsidian OS prospect previews
> Date compiled: 2026-09-12
>
> See also: `docs/DESIGN_INTELLIGENCE.md` — the canonical reference for this system's design intelligence (Fix #1–8 production status, the wiring matrix, disclosed gaps). This document is the operational, step-by-step version meant to be copied directly into a Claude session; that one is the reference for what's actually built and verified.
>
> Core rule (do not violate):
> **Evidence determines WHAT to claim. Design intelligence determines HOW to present it. The renderer determines WHAT THE PROSPECT SEES.**

---

# 0. HOW TO USE THIS DOCUMENT

When designing a prospect preview:

1. Read **Section 1** (hard constraints).
2. Run **Section 2** (14-step decision framework) out loud in your reasoning.
3. Choose only from **Section 3** (existing hero/composition capabilities).
4. Apply **Section 4** (premium look rules distilled from current X + design research).
5. Validate with **Section 5** (quality test).
6. Do **not** invent content, new layout engines, stock photos, testimonials, or WebGL gimmicks.

This brief does **not** authorize production-code architecture changes. Prefer wiring existing capabilities.

---

# 1. HARD CONSTRAINTS (NON-NEGOTIABLE)

## 1.1 Evidence only
You may use only verified prospect evidence:

- business name, location, address, phone, hours
- real photographs
- real menu items / services / products
- verified website copy and public information
- verified business characteristics

You must **not** manufacture:

- testimonials, awards, credentials, certifications
- reviews, quotes, statistics
- services, menu items, history
- claims of quality
- stock or AI lifestyle photography presented as the business
- fake social proof

**When evidence is weak, the design becomes MORE restrained, not more imaginative.**

## 1.2 Existing production capabilities only
Reuse these renderer capabilities. Do not invent a competing layout system.

Hero / composition archetypes:

1. `image-full-bleed`
2. `split-media-text`
3. `oversized-typographic`
4. `editorial-typographic`
5. `centered-cinematic`
6. `offset-overlap`

Preserve existing production fixes:

- Fix #1 Adaptive typography
- Fix #2 Composition variants (nav / CTA / footer treatment)
- Fix #3 Industry-constrained hero patterns
- Fix #4 Adaptive spacing
- Fix #5 Narrative arc spacing (not automatic section reordering)
- Fix #6 Typography reasoning → production type
- Fix #7 Color resolution into existing palette tokens
- Fix #8 Semantic color roles + contrast safety

## 1.3 Narrative arc (spacing, not reshuffle)
ESTABLISH → REVEAL → DEMONSTRATE → VALIDATE → DEEPEN → CONVERT

Trust / contact / footer may receive more breathing room than dense informational sections.
Do **not** reorder sections just because the narrative sounds sophisticated.

## 1.4 Motion and special treatments
- Motion is restrained and purposeful.
- Shader hero is a **special** treatment, not default.
- Do not expand GSAP / WebGL / cursor-tracking / emerald-glow / glassmorphism stacks to look "premium."
- Those X trends sell to designers. They make local-business previews look like AI slop.

## 1.5 Differentiation must be earned
Do not produce five unrelated websites for variety.
Ask: *Would this business naturally justify this visual treatment?*
If no, do not force it.

---

# 2. DECISION FRAMEWORK (RUN IN THIS ORDER)

### STEP 1 — Evidence
What do we actually know?

### STEP 2 — Visual evidence
What real photography, branding, colors, type, or visual material exists?
Rate photo strength: none / weak / usable / dominant.

### STEP 3 — Business character (evidence-supported only)
warm / refined / editorial / energetic / minimal / traditional / modern / authoritative / playful  
Do not invent personality.

### STEP 4 — Industry constraints
What patterns are appropriate? Some industries legitimately converge (e.g. real estate). Do not manufacture uniqueness.

### STEP 5 — Design intelligence
Which principles below apply?

### STEP 6 — Composition
Pick **one** existing archetype from Section 3.

### STEP 7 — Typography
Display hierarchy + readable body. Type establishes character.

### STEP 8 — Color
Resolve natural-language colors into existing tokens.
Assign **semantic roles**, not "lightest / darkest hex":
- calm/base page background
- strongest hero surface
- supporting / footer surface
- foreground / text
- accent
- secondary

Accent must not automatically become the page background.
Contrast safety is mandatory.

### STEP 9 — Spacing
Rhythm and breathing room communicate hierarchy. Do not just make everything bigger.

### STEP 10 — Imagery
Treat real photos as art direction, not identical gallery cards.
If photos are weak, design around the limitation.

### STEP 11 — Narrative
Visitor should understand the business progressively.

### STEP 12 — CTA
One primary action. No competing primary buttons.

### STEP 13 — Motion
Only if it supports hierarchy and remains restrained.

### STEP 14 — Validation
If the input changed, did the rendered preview change?
If not, the intelligence is not wired.

---

# 3. HERO SELECTION RULES

The hero must immediately establish:
- who this is
- what this is
- where this is (when location matters)
- strongest available message
- visual character
- one appropriate CTA relationship

## 3.1 Choose the archetype from evidence

| Photo strength | Text / brand identity | Default hero |
|---|---|---|
| Dominant, high quality, atmospheric | Any | `image-full-bleed` |
| Usable but not cinematic | Offer needs explaining | `split-media-text` |
| Weak or none | Strong name / positioning line | `oversized-typographic` |
| Mixed / editorial character | Refined service, hospitality, studio | `editorial-typographic` |

Industry can constrain the choice. It cannot invent a fifth engine.

*(Note: this table currently maps evidence to 4 of the 6 real archetypes — `centered-cinematic` and `offset-overlap` exist in production but aren't yet given their own row here. Left as originally authored rather than inventing new evidence-mapping rules; flagged for Robert's own judgment call, not silently decided here.)*

## 3.2 Hero triangle (premium pattern)
Every high-end hero is a triangle of attention:

1. Visual anchor (photo **or** oversized type — not both fighting)
2. Precise headline
3. One refined CTA

Do not put features, long paragraphs, logo clouds of invented clients, or 3 buttons in the hero.

## 3.3 What "expensive" actually looks like
Premium is not more effects. Premium is:

- intentional hierarchy
- intentional composition
- intentional type
- intentional whitespace
- intentional imagery
- intentional CTA placement
- restrained motion
- industry-appropriate density

A prospect should feel: *someone designed this for MY business* — not *a template was filled in*.

---

# 4. RESEARCH INTERNALIZED AS RULES
Compiled from Obsidian OS design intelligence + current X / public design research (Refero, Supahero, Land-book, hero carousels, agency homepage audits, 2026 hero anatomy writing).

Treat these as **principles**, never as templates to copy.

## 4.1 Current "expensive hero" patterns worth absorbing

From X hero carousels and premium-brand writing, the bookmarked heroes share:

1. **One focal point.** Photo-led **or** type-led.
2. **Editorial restraint.** Few words. Generous margins. One CTA.
3. **Typography as brand.** Display type carries identity; body stays calm.
4. **Full-bleed only when the photo can carry the page.**
5. **Whitespace as confidence**, especially around trust and convert moments.
6. **Semantic color**, not decorative palettes.
7. **Motion budget of one idea**, not every element animating.

## 4.2 Patterns to reject for local-business previews
Do **not** import these from viral X posts unless prospect evidence + visual character explicitly justify the existing shader hero:

- WebGL / Three.js cursor-tracking heroes
- emerald glow, sci-fi techwear, glassmorphism card stacks
- multiple corner radii / mixed button styles / mixed type systems
- AI lifestyle people who are not the business
- dual primary CTAs
- "awards / 10k clients / 5-star" blocks with no evidence
- decorative complexity added to look sophisticated

If a layout would look identical on a SaaS startup and a Mahopac contractor, it is the wrong layout.

## 4.3 Industry density
- Restaurant / salon / venue with real photography: larger images, more visual storytelling, tighter image-to-image rhythm.
- Professional services (legal, medical, lending, advisory): stronger credibility hierarchy, lower visual density, more type and spacing, more trust.
- Real estate: narrower appropriate set. Prefer industry-constrained heroes. Do not force experimental composition.

## 4.4 CTA intelligence
Primary CTA supports the business purpose:
- call / visit / book / inquire / get directions
Not "Learn more" repeated five times.
Nav may include phone when the industry expects it.
Nav stays restrained. Do not add links because templates have them.

**Disclosed gap.** CTA visual treatment (filled/outline/text-link, nav style) is wired sitewide and deterministic. CTA copy is not: DesignMemory's stated primary/secondary CTA text is real design-intelligence output, but the rendered hero and contact CTA labels are currently fixed strings and do not read it. This is a known, disclosed limitation, not solved behavior — do not assume CTA copy is production-wired without checking.

## 4.5 Image intelligence
Real photography is evidence and art direction.
Vary:
- prominence, crop, aspect, scale, grouping, sequence, relationship to type

Do not:
- treat every image as the same card
- invent a stock/AI image system to "fill" empty heroes
- put a weak photo full-bleed and hope overlay text saves it

**Disclosed gap.** Photo count is a heavily-wired production input — it gates hero-pattern eligibility, experience mode, motion budget ceiling, and motion reveal style. Photo content and quality are not assessed anywhere in the pipeline: no vision-model call exists, and the LLM only ever receives a count and a source URL, never the images themselves. A business with weak, blurry, or off-brand photos is treated identically to one with excellent photos, so long as the count clears the same bar. This is a known, disclosed limitation, not solved behavior.

## 4.6 Color intelligence examples
Natural language (terracotta, olive, cream, charcoal, aged wood, amber, brass) must resolve to existing tokens, then roles.

Example palette: cream / charcoal / terracotta / olive
- cream = calm page background
- charcoal = text / foreground
- terracotta = accent (CTA, small emphasis)
- olive = secondary / supporting

Never auto-pick terracotta as the whole page background because it is "the interesting color."

## 4.7 Visual rhythm
Avoid stacked identical sections of identical density.
Controlled variation via:
- section height, whitespace, image scale, text density, type scale, alignment, composition, emphasis

Rhythm ≠ randomness.

---

# 5. HIGH-END QUALITY TEST
Judge the preview by these questions, not by "does it have all the usual sections?"

- **Identity** — Does it immediately feel like THIS business?
- **Hierarchy** — Is it obvious what matters most?
- **Composition** — Does the page feel composed, not templated?
- **Typography** — Does type establish character and hierarchy?
- **Spacing** — Does whitespace create confidence and rhythm?
- **Imagery** — Are real images treated as assets?
- **Color** — Are roles semantic and contrast-safe?
- **Narrative** — Does understanding build ESTABLISH → CONVERT?
- **CTA** — Is the next action clear without being aggressive?
- **Restraint** — Did we avoid unnecessary effects?
- **Evidence** — Can every factual claim be traced?
- **Differentiation** — Did we differ only where evidence justified it?

---

# 6. CLAUDE OUTPUT FORMAT (REQUIRED)

Before designing, write a short design memo:

```
EVIDENCE
- What we know
- Photo strength: none | weak | usable | dominant
- Strongest true message

CHARACTER
- Evidence-supported character (one or two words)

INDUSTRY CONSTRAINT
- What this industry allows / forbids

HERO DECISION
- Archetype: image-full-bleed | split-media-text | oversized-typographic | editorial-typographic | centered-cinematic | offset-overlap
- Why this archetype (one sentence tied to evidence)
- Headline approach
- Primary CTA

COLOR ROLES
- background / hero surface / footer / text / accent / secondary

SPACING / NARRATIVE
- Where breathing room increases
- Where density stays tight

WHAT WE WILL NOT DO
- List rejected gimmicks and invented content
```

Then design only inside those decisions.

---

# 7. FREE RESEARCH SOURCES (FOR HUMANS, NOT RUNTIME)

Obsidian OS must **not** depend on these at runtime.
Use them offline to sharpen judgment. Do not copy layouts literally.

## 7.1 X / Twitter accounts to study
Study composition, type scale, crop, and restraint. Do not clone.

| Account | Use for |
|---|---|
| @uixhassan | Monthly hero carousels; compare full-bleed vs type-led |
| @GreySaurabh | Concept heroes where type + background do the work |
| @hussain_mu20778 | Framer hero grids; judge density and cleanliness |
| @interfacely_ | High-volume UI scan; filter to local / editorial / hospitality |
| @UiSavior | Fast live-site visual scans |
| @Abhinavstwt | Living list of inspiration libraries |
| @ayushsoni_io | Weekly "well-executed sites" roundups |
| @AdhamDannaway | Practical UI + points to Supahero |
| @bbssppllvv / @referodesign | Refero founder; real-product UI research |
| @supaheroio | Dedicated hero-section library account |
| @101babich | Refero / UI pattern commentary |

X search queries (Latest + Media):

```
"hero section" (editorial OR typographic OR "full bleed") filter:images
"hero section" (restaurant OR salon OR dentist OR realtor OR contractor) filter:images
premium website (whitespace OR "negative space" OR serif) filter:images
from:uixhassan OR from:GreySaurabh hero
```

## 7.2 Free galleries and libraries
- Refero — https://refero.design
- Supahero — https://supahero.io
- Land-book, SiteInspire, Lapa Ninja, One Page Love
- Godly, Minimal Gallery, SaaSFrame (use SaaSFrame only to learn hierarchy, not visual language for local SMBs)
- Awwwards / CSS Design Awards (study restraint on winners; do not copy award-site excess)
- Muzli web-design collections
- GetLayers / UX archives as research inputs only

## 7.3 Principle sources already named in Obsidian OS
X design research, Refero, Supahero, GetLayers, UX Pro Max, Claude design skills, internal prospect-preview analysis.

Pipeline that must remain true:

RESEARCH → INTERNAL DESIGN INTELLIGENCE → PROSPECT-SPECIFIC REASONING → EXISTING DESIGN SYSTEM → RENDERED PREVIEW

Not:

RESEARCH → GENERIC AI OPINION → TEMPLATE

---

# 8. WHAT CLAUDE MUST NOT DO

- Copy a website from X, Refero, or Supahero
- Recreate a gallery example literally
- Randomly vary layouts for novelty
- Invent content to fill empty sections
- Manufacture testimonials, credibility, services, or imagery
- Add decorative complexity without a reason
- Create a new layout engine
- Add runtime dependencies on external research sites
- Generate multiple concepts just for variety
- Redesign the dashboard while designing a prospect site
- Introduce stock-image systems for appeal
- Expand GSAP / shaders / WebGL without a validated production need
- Use glassmorphism + glow + 3D as a substitute for evidence

---

# 9. IMPLEMENTATION RULE (IF ASKED TO CHANGE THE SYSTEM)

This document is a DESIGN INTELLIGENCE SOURCE.
It is not permission to immediately modify production code.

Before any new behavior:

1. Identify the existing renderer capability.
2. Identify the existing design-intelligence input.
3. Trace whether that input already reaches production.
4. Decide if a new implementation is actually required.
5. Preserve Fixes #1–#8.
6. Use real prospect data.
7. Add deterministic tests.
8. Demonstrate a visible rendered consequence.
9. Do not introduce redundant architecture.

When in doubt:
**Wire existing intelligence into existing capabilities.**

---

# 10. ONE-LINE DIRECTIVE FOR CLAUDE

Given what we actually know about this business, choose the strongest existing composition, type, color roles, spacing, and CTA — and make the preview feel deliberately designed for them, not filled into a template.

Evidence determines WHAT.
Design intelligence determines HOW.
The renderer determines WHAT THEY SEE.
If the intelligence does not reach the renderer, it is not production intelligence.
