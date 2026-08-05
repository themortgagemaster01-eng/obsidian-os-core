# Vision Guardrails

**This is not an architecture document, not a code document, and not a database document.** It's a product-identity boundary — a short, deliberately non-technical checklist that exists to prevent drift as Obsidian OS grows across many sprints and, potentially, many different engineers or AI agents contributing to it over time. `docs/MASTER_BLUEPRINT.md` describes what the system *is* and *how it's built*; this document describes what the system is *not allowed to become*, and the one question every future feature proposal must answer before it's built.

**The check every future feature proposal must pass:** *does this move Obsidian OS toward or away from the vision below?* If the honest answer is "away," or "unclear," the feature does not ship as proposed — it gets reshaped until the answer is clearly "toward," or it gets rejected. This check applies regardless of who or what is proposing the feature: a human product decision, a sprint plan, or an AI agent extending this codebase are all equally bound by it.

---

## What Obsidian OS will NEVER become

**A generic AI website builder.** Website generation is one factory inside the Design stage of a nine-stage autonomous pipeline (Discovery → Qualification → Research → Design → Proposal → Email → CRM → Learning → Analytics — see `docs/MASTER_BLUEPRINT.md` §1). If a proposed feature's value proposition is "generate a website faster/better/cheaper" with no connection to discovery, qualification, research, proposal, or outreach, it belongs in a different product, not this one.

**A template marketplace.** Obsidian OS does not sell, license, or distribute reusable design templates to third parties. Every design a mission produces is bespoke work product for one specific prospect business, generated from that business's actual research and context — not a template pulled off a shelf and lightly customized. A feature that turns mission output into a sellable, reusable template library is a different business model and does not belong here.

**A Fiverr replacement / freelancer marketplace.** Obsidian OS is not a marketplace connecting agencies or freelancers to clients, and it never brokers a transaction between two parties who aren't already the product's own operator and their own prospects. There is no multi-sided marketplace here, even once the product is multi-tenant and white-label — each tenant runs their own autonomous pipeline for their own prospects, they don't compete for or get matched to jobs.

**A no-code drag-and-drop builder.** The product's entire value proposition is that a human does *less* manual work, not that manual work becomes easier to do. A visual page-builder, a drag-and-drop canvas, or any feature whose pitch is "now you can build it yourself, just easier" is the opposite of autonomous — it reintroduces the exact labor the system exists to remove. If a human is expected to spend meaningful time arranging elements on a canvas, the feature is wrong for this product.

**A prompt playground.** Obsidian OS does not expose a raw chat/prompt interface as its primary interaction model, and it does not ship a feature whose main affordance is "type a prompt and see what the AI does." Every AI system in this product (§4 of the blueprint) has a narrow, named responsibility, structured inputs from the event bus, and a structured, auditable output — never an open-ended prompt box standing in for a real, scoped agent. If a proposed feature's UI is fundamentally a text box and a "generate" button with no mission/pipeline context around it, it doesn't belong here.

---

## What Obsidian OS ALWAYS is

**An AI Agency Operating System** — precisely, an **Autonomous Client Acquisition Operating System** for a small digital agency (see `docs/MASTER_BLUEPRINT.md` §1 for why the more precise phrase is used in technical docs). The category is fixed; features either serve this category or they don't.

**Premium-first.** The product's design language, output quality, and positioning target the top of the market (Tesla/Apple/Linear/Vercel/Notion register — see `docs/09-UI-Design-System.md`), not a race to the bottom on price or volume. A feature whose pitch is "make it cheaper and rougher so we can serve more customers at lower quality" is misaligned with this vision, even if it would grow usage numbers.

**Human approval before any outreach — always, no exceptions, not a growth lever.** Nothing Obsidian OS produces reaches a prospect's inbox, a live domain, or any client-visible surface without a human explicitly approving it first. This is the single non-negotiable trust boundary in the product (`docs/MASTER_BLUEPRINT.md` §1). No future feature, no matter how good the agents get, is allowed to remove, soften, auto-confirm, or add a "trust the AI" bypass around this gate. More agent capability earns more *scope of work done before the gate*, never removal of the gate itself.

**Architecture before features.** Every sprint updates `docs/MASTER_BLUEPRINT.md` and `docs/ARCHITECTURE_DECISIONS.md` before or alongside code, not after (`docs/10-Development-Standards.md`). A feature proposal that requires guessing at undocumented architecture, or that would require an architecture change nobody wrote down first, is not ready to build yet — the documentation gap gets closed first.

**Mission-driven workflows.** Every unit of product value traces back to a **mission** — one prospect business tracked through the pipeline (`docs/02-Product-Requirements.md`). A feature that doesn't attach to a mission, or that creates a second, parallel unit of work alongside missions, needs a very strong justification before it's built, because it fragments the product's one organizing concept.

**Quality over quantity.** The product's success metric is the quality and close-worthiness of roughly ten finished opportunities a human reviews each morning, not the raw count of prospects discovered, missions started, or emails drafted (`docs/MASTER_BLUEPRINT.md` §1). A feature that improves volume metrics at the expense of per-mission quality — a weaker research pass to discover more businesses per night, for instance — works against the vision even if the dashboard numbers look better.

**Autonomous preparation, human judgment retained.** The system does the analytical and creative labor; the human makes the final judgment call on every prospect, every proposal, every dollar amount, and every message sent in their name. This is the same boundary as the approval-gate guardrail above, stated as a design principle rather than a hard rule: even *within* the approval flow, features should widen what the human can see and decide, not narrow their judgment down to a rubber-stamp click.

---

## How to use this document

Before proposing, scoping, or building any feature — whether in a sprint plan, an ad hoc code change, or an AI agent's own initiative extending this codebase — check it against both lists above. If it matches anything in "NEVER," it does not ship as proposed. If it doesn't clearly serve something in "ALWAYS," it needs a stated justification for why it belongs, not just a stated justification for why it's useful in isolation — usefulness alone is not sufficient reason to build something, alignment with this vision is.

This document is itself only as good as its own maintenance discipline: if the product's vision genuinely needs to change (not drift — change, deliberately and with justification), update this file explicitly, with an accompanying `docs/ARCHITECTURE_DECISIONS.md` entry explaining why, the same documentation-first discipline the rest of the project follows. A silent edit to this file without an ADR entry should be treated as a red flag by anyone reviewing the change.
