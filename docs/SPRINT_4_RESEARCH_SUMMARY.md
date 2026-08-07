# Sprint 4 Research Summary — Modern AI-Assisted Design Workflows

**Status:** Research deliverable, design-only sprint. This document is the source material `docs/SPRINT_4_DESIGN_REVIEW.md` and `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md` are built on — findings here, judgment (what's adopted, adapted, or rejected for Obsidian OS specifically) there. Kept separate deliberately: this document reports what the current external practice looks like, honestly and without editorializing; the review documents apply judgment to it. Conflating the two would make it hard to tell, later, whether a decision was "the research said so" or "this project decided so" — and per `docs/VISION_GUARDRAILS.md`, this project should never treat an external practice as binding just because it's common.

**Method:** targeted web search (2026) across four question areas the founder specified — curated reference libraries, industry-specific design inspiration, design system constraints for AI generation, multi-pass refinement, plus two follow-up searches specifically for the Design Intelligence evaluation (negative/"never generate" constraints, and multi-brand design token architecture). Not a literature review — a scan for the current shape of practice, cross-checked against this codebase's own already-validated patterns (Sprint 3's service split, evidence-first architecture, banned-terms testing) wherever one existed. **Extended for `docs/DESIGN_INTELLIGENCE.md`** with a second pass specifically covering the platforms the founder named — TasteSkill.dev, Design Spells, Awwwards, Land-book, Dribbble, Refero, Mobbin — reported in §7 below in the same principles-only, no-copying discipline as everything above it: extract what these platforms reveal about how design quality gets defined and evaluated in practice, never a specific design, layout, or brand asset from any real site surfaced through them.

---

## 1. The core diagnosis: generic output is a workflow problem, not a model problem

The most consistent finding across sources: when a single generation pass is asked to decide *what this should look like* and *build it* at the same time, the output tends toward the statistical average of its training distribution — which is what "looks like AI" means in practice. The fix proposed across multiple independent sources is the same: separate the *direction* decision (a creative/taste call, ideally made or reviewable by a human before generation) from the *execution* decision (turning an agreed direction into actual layout/code). One source states this almost exactly as a workflow prescription: plan the creative in text with a reasoning-focused pass first, then hand an explicit spec to a separate builder pass — rather than one prompt doing both.

**Relevance to this codebase:** this is not a new idea here. It's the same lesson Sprint 3 already learned and formalized as `docs/ARCHITECTURE_DECISIONS.md` ADR-011 — normalization, insight generation, scoring, and report assembly are four separate services precisely because folding "what did we measure" and "what does it mean" into one function made the "no jargon leaks into customer text" guarantee much harder to enforce. The research confirms the same structural principle generalizes to design.

## 2. Multi-pass, graded refinement instead of generate-once-and-ship

A recurring pattern: render the current output, compare it against explicit named criteria across several independent dimensions (layout, typography, spacing, color, motion are the dimensions that came up most consistently), grade each dimension on a discrete scale (one source used PASS/MINOR/MODERATE/CRITICAL), fix what graded poorly, re-render, and repeat up to a capped number of iterations rather than looping until a subjective "looks good" is reached.

**Relevance to this codebase:** this is functionally identical, in shape, to two things this codebase already does and has already validated work: Sprint 3's five-stage analysis pipeline (raw → normalized → insight → score → report, each a distinct, gradable stage) and `opportunity-report-service.test.ts`'s enforcement pattern (grade the *output* against an explicit, checkable rule — a banned-terms scan — rather than trusting the process that produced it). Applying the same "grade the artifact, don't trust the process" discipline to visual output is a natural extension, not an import of an unfamiliar idea.

## 3. Explicit, structured design constraints improve AI output quality, not just consistency

Sources converge on giving a generation pass explicit constraints up front — named font choices, hex values with semantic roles (not just raw color values), pixel-level spacing scale, defined component conventions — rather than letting a generation pass free-associate on every request. One source's framing: telling a model what *not* to do removes the default patterns it would otherwise fall back on; this is described as "as much about blocking the defaults as it is about defining the positives." A second, more specific finding: **negative constraints (`NEVER do X`) are harder for a model to reliably follow than positive constraints (`MUST do Y`)** — the practical guidance is to pair a small number (3–5) of concrete, specific negative constraints with positive instructions, and to make sure every negative constraint names an actual concrete pattern, library, or behavior rather than a vague aesthetic judgment ("don't look generic" is not specific enough to act on; "don't use a centered hero + three icon cards + testimonial carousel without a stated reason" is).

**Relevance to this codebase:** `docs/09-UI-Design-System.md` already is this kind of structured constraint document for Obsidian's own product surfaces (exact hex values with named roles, a defined spacing/radius scale, an explicit animation-duration band). The research confirms this is the right *shape* of document to also produce for generated client output — but see the Design Intelligence Recommendation for why the same *values* should not simply be reused (Obsidian's own navy/dark palette is not appropriate for every client industry).

## 4. Design tokens have a standard three-tier architecture, directly relevant to multi-brand generation

Modern design-token practice organizes tokens into three layers: **primitive** tokens (raw values — a specific hex code, a specific pixel value), **semantic** tokens (what a value *means* — "primary action color," "body text size" — mapped to a primitive), and **component** tokens (a specific component's use of a semantic token). The point of the separation: a semantic/component layer can stay stable while the primitive layer underneath it changes per brand — which is exactly the shape a system generating visually distinct output for many different client businesses needs, as opposed to a single-brand product like Obsidian's own UI, which only ever needs one primitive layer.

Token coverage in current practice extends beyond color/typography/spacing to include **motion parameters and elevation/shadow values** as first-class tokens, not just visual afterthoughts — relevant given the founder's explicit "restrained animation" design principle names motion as something that needs the same rigor as color or type.

**Relevance to this codebase:** this is the clearest concrete architectural finding of this research pass, and it's the central argument in the Design Intelligence Recommendation for treating "the shape of the constraint system" (the token schema itself — what categories of decisions get made, always) as something Obsidian OS should own and keep stable, while the specific *values* within that schema vary per mission/industry.

## 5. Curated, industry-tagged reference libraries are a real, established category

Industry-sorted landing-page galleries and searchable design-reference tools exist as a mature category — some organize thousands of real sites by industry/category/color/typography specifically to support "conversion-oriented" or industry-appropriate design research; others are positioned explicitly as AI-agent-facing tools that extract and structure color/typography/component patterns from real sites into a machine-readable reference format, searchable by brand, mood, or URL.

**Relevance to this codebase:** real and useful as a *taste/direction* input — but this is the single point in the research with the most direct tension against this project's own stated boundaries. `docs/VISION_GUARDRAILS.md` explicitly rules out becoming "a template marketplace," and a reference-library tool used carelessly (letting a generation pass lean on a cited reference's actual structure, not just its mood) is exactly the mechanism that guardrail exists to prevent. This tension is treated as a first-class risk in `docs/SPRINT_4_DESIGN_REVIEW.md` §7 and in the Design Intelligence Recommendation, not resolved by this research alone.

## 6. A separate exploration step for unconventional layouts exists as a technique, not a universal default

One pattern surfaced: using an image-generation model (not a coding agent) to explore layout directions a coding agent tends to avoid by default — tilted compositions, glass/blur effects, 3D treatments — because these are harder for a coding agent to implement correctly and so it defaults away from proposing them at all, independent of whether they'd actually be the right call for a given brief.

**Relevance to this codebase:** useful as an available technique, not adopted as a default. Obsidian's own established design language is explicit about restraint over cleverness (`docs/09-UI-Design-System.md`: "no loud gradients, no cartoon graphics... restraint and confidence, not minimalism for its own sake"), and reaching for maximalist layout techniques by default would contradict that, even applied only to generated client output rather than Obsidian's own UI. Held as a per-mission direction option in the Design Review, not a pipeline default.

## 7. Named-platform pass — TasteSkill.dev, Design Spells, Awwwards, Land-book, Dribbble, Refero, Mobbin

Extracted as generalizable principles only. No specific design, layout, section, or brand asset surfaced by any of these platforms during this research is described, reproduced, or referenced below — only what each platform reveals about how design quality gets defined, evaluated, or referenced in current practice.

**TasteSkill.dev** is the closest existing analogue to what `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md` proposes building: a portable instruction set that gives an AI coding agent "taste" by combining *named negative constraints* (banned fonts, banned colors, forced-asymmetry rules) with *tunable parameters* — three named dials (design variance, motion intensity, visual density), each on a numeric scale, adjusted per project rather than fixed globally. **This is the single most directly relevant finding of the entire research pass for `docs/DESIGN_INTELLIGENCE.md`'s structure**: it validates that "banned patterns + a small number of adjustable intensity dials" is a real, working shape for a design-constraint system, not a theoretical one — and it independently arrived at exactly the combination `docs/SPRINT_4_RESEARCH_SUMMARY.md` §3's negative-prompting finding (concrete bans, paired with positive tunable range) already surfaced from separate sources. Its stated purpose — "critique," pushing a model to ask sharper questions about audience and constraints rather than just generating — also reinforces §1's workflow-separation finding from a different angle: taste is applied as a *review lens*, not baked into a single generation call.

**Design Spells / general typography-hierarchy practice** confirms the standard vocabulary this codebase should use rather than inventing its own: contrast and spacing are named, specifically, as the two principles with the most influence on typographic hierarchy — not size alone. Whitespace is treated as "an active design element," not empty leftover space — language directly usable in `docs/DESIGN_INTELLIGENCE.md`'s Spacing Standards section.

**Awwwards** is notable less for its design opinions than for its *scoring structure*: a published, weighted rubric (Design 40%, Usability 30%, Creativity 20%, Content 10%), scored numerically by a panel, with outlier scores mechanically discarded before averaging. This is a real precedent for "premium design quality, graded on named weighted dimensions by an explicit rubric rather than a single holistic vibe judgment" — directly relevant to `docs/DESIGN_INTELLIGENCE.md`'s Design QA Checklist and to `docs/SPRINT_4_DESIGN_REVIEW.md` §7's graded-dimension QA pass.

**Land-book** confirms the industry-tagged, section-level reference-library pattern already covered in §5 above, with one additional detail worth flagging as a risk, not adopted: its Pro tier lets users copy referenced sections directly into a design tool. That specific capability is the clearest possible real-world illustration of the exact failure mode `docs/VISION_GUARDRAILS.md`'s "not a template marketplace" guardrail exists to prevent — a reference library one click away from becoming a copy-paste template source. Named here explicitly so the risk isn't abstract.

**Dribbble**, read for 2026 trend commentary rather than as a reference source, surfaces a finding worth taking seriously as an outside check on this codebase's own instincts: a visible, named backlash against "AI sameness" — dark dashboards, generic gradients, interchangeable interfaces — with designers now deliberately reaching for visible imperfection (asymmetry, slightly-off typography, hand-made touches) as a counter-reaction. This is independent, external confirmation that the generic-AI-look problem this entire sprint is organized around is a real, currently-live concern in the wider design community, not a concern specific to this codebase. It does **not** argue for adopting "visible imperfection" as a technique — that would cut against Obsidian's own established restraint/confidence design language — but it does strengthen the case that the Never Generate list (§11 below) is addressing a real, current failure mode, not a hypothetical one.

**Refero** — covered in the original research pass (§5 above) — is confirmed by this second pass as squarely in the same category as Land-book and Mobbin: a structured, AI-agent-facing reference tool extracting color/typography/pattern data from real sites, searchable by mood/brand/URL. Same taste-not-structure treatment applies.

**Mobbin** extends the reference-library pattern from static sections (Land-book) to full tagged *user flows and journeys* across a large, weekly-updated corpus. Relevant less for visual style than for a structural idea: a reference library organized around *flows* (onboarding, checkout, booking) rather than only static sections could inform how `docs/DESIGN_INTELLIGENCE.md`'s eventual Conversion Patterns guidance is structured — a booking flow or lead-form flow is arguably a more useful unit of reference than a single static hero section, since it captures sequence and decision points a screenshot alone doesn't.

---

## What this research does and doesn't establish

**Establishes:** a consistent external shape of practice — separate direction from execution, use graded multi-pass refinement, constrain generation with explicit structured tokens (three-tier, extending to motion), industry-tagged reference libraries exist and are usable as inputs, negative constraints need to be concrete and paired with positive ones to actually work.

**Does not establish:** that any of this is correct *for Obsidian OS specifically* — none of these sources were evaluating against `docs/VISION_GUARDRAILS.md`'s constraints, ADR-000's philosophy, or this codebase's own already-validated patterns. That evaluation is `docs/SPRINT_4_DESIGN_REVIEW.md` §1's job, and the Design Intelligence build-or-not question is `docs/SPRINT_4_DESIGN_INTELLIGENCE_RECOMMENDATION.md`'s. Nothing in this document should be read as a recommendation on its own.

---

## Sources consulted

- [Building Premium AI-Built Websites: 2026 Design Guide](https://www.aifire.co/p/building-premium-ai-built-websites-2026-design-guide)
- [How to Make AI UI Look Less Generic: 5 Fixes (2026) | Superdesign](https://superdesign.dev/blog/how-to-make-ai-ui-look-less-generic)
- [10 AI in Web Design Trends to Watch in 2026 | Elementor](https://elementor.com/blog/10-ai-web-design-trends-watch-2026/)
- [How AI Is Changing Web Design in 2026: From Prompt to High-Fidelity UI](https://ginfomedia.in/knowledge-hub/web-development/ai-web-design-2026-prompt-to-ui)
- [The AI Design Pipeline Nobody Told You About: Motion Studio MCP + Google Stitch + Claude Code](https://medium.com/@karthikmulugu/the-ai-design-pipeline-nobody-told-you-about-motion-studio-mcp-google-stitch-claude-code-9ce15aef45b2)
- [Layout — The compiler between design systems and AI coding agents](https://layout.design/)
- [Building design system components with agent teams](https://www.kaelig.fr/design-system-components-with-ai-agent-teams/)
- [Your AI coding agent is only as good as your design system](https://medium.com/@aliafsah1988/your-ai-coding-agent-is-only-as-good-as-your-design-system-6055e4667fa9)
- [Design Resources for AI Agents | Refero Styles](https://styles.refero.design/ai-agents/design-resources)
- [30 Best Design Inspiration Websites in 2026: The Complete List](https://www.inspoai.io/blog/design-inspiration-websites-list)
- [Best Design Inspiration Sites in 2026 | Inspo AI](https://www.inspoai.io/blogs/design-inspiration-sites)
- [How to Avoid AI Slop When Using Claude Design (The Design System Approach) | MindStudio](https://www.mindstudio.ai/blog/claude-design-avoid-ai-slop-design-system)
- [How to align AI-generated designs with your design system - LogRocket Blog](https://blog.logrocket.com/ux-design/align-ai-designs-with-design-system/)
- [Negative Prompting and How to Tell AI What NOT to Do](https://blog.vibecoder.me/negative-prompting-telling-ai-what-not-to-do)
- [How to Use Design Tokens with AI Agents: Consistent Brand Visuals Across Every Output | MindStudio](https://www.mindstudio.ai/blog/design-tokens-ai-agents-consistent-brand-visuals)
- [What Is a Design Token System for AI Agents? | MindStudio](https://www.mindstudio.ai/blog/design-token-system-ai-agents-brand-visuals)
- [What Are Design Tokens? A Complete Guide (2026) | UXPin](https://www.uxpin.com/studio/blog/what-are-design-tokens/)
- [AI-powered prototyping with design systems - Vercel](https://vercel.com/blog/ai-powered-prototyping-with-design-systems)
- [Design Tokens and Theming in AI-Generated UI Systems: A Complete Guide](https://ehga.org/design-tokens-and-theming-in-ai-generated-ui-systems-a-complete-guide)
- [GitHub - suboss87/taste-skill-Design: gives your AI good taste](https://github.com/suboss87/taste-skill-Design)
- [Taste Skill - AI Design Rules for Coding Agents | EveryDev.ai](https://www.everydev.ai/tools/taste-skill)
- [Taste Skill Review: Anti-Slop Frontend Skill for AI — andrew.ooo](https://andrew.ooo/posts/taste-skill-anti-slop-ai-frontend-review/)
- [Typography Hierarchy Basics | NoLimit Creatives](https://nlc.com/university/unpacking-typography-hierarchy-the-basics-of-designing-with-type)
- [How to Structure an Effective Typographic Hierarchy | Toptal](https://www.toptal.com/designers/typography/typographic-hierarchy)
- [Typographic Hierarchy in Print, Web & App Design - Pimp my Type](https://pimpmytype.com/hierarchy/)
- [Awwwards - Evaluation System](https://www.awwwards.com/about-evaluation/)
- [Awwwards Judging Criteria: How Scoring Works (2026)](https://www.hontran.dev/blog/awwwards-judging-criteria)
- [Land Book Review — Freemium Design Tool for Startups | Tiny Startups](https://www.tinystartups.com/tools/land-book)
- [Design Trends 2026! Imperfection, Rebellion, and the Return of Human Work](https://lindsaymarsh.substack.com/p/design-trends-2026-imperfection-rebellion)
- [12 Product Design Trends for 2026](https://uxpilot.ai/blogs/product-design-trends)
- [Mobbin — UI & UX design inspiration for mobile & web apps](https://mobbin.com/)
- [Mobbin Free Alternative | App UI Screen References | Banani](https://www.banani.co/references)
