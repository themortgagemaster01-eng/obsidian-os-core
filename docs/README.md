# Obsidian OS — /docs

**Start at `docs/MASTER_BLUEPRINT.md`.** It is the entry point for this project — the single document every future engineering session (human or AI) should read before making an architectural or implementation decision. Everything else in this folder is a focused deep-dive the blueprint links out to.

## Index

| File | What it covers |
|---|---|
| `MASTER_BLUEPRINT.md` | **Start here.** The project constitution — executive summary of every major area, linking to the detail docs below. |
| `00-Executive-Summary.md` | The shortest possible summary of what Obsidian OS is and what's actually built vs. spec. |
| `01-Product-Vision.md` | The full product narrative — mission, daily workflow, agent roster, design language, roadmap. Supersedes `VISION.md`. |
| `02-Product-Requirements.md` | Functional/non-functional requirements, core user journeys, business workflows, "done" acceptance criteria. |
| `03-Software-Architecture.md` | The layering rules, dependency directions, independent-subsystems model, folder structure. |
| `04-AI-Systems.md` | The 11-agent roster (all unbuilt), the event-bus contract each must honor, the event catalog, and the Decision Memory layer. |
| `05-Mission-Control.md` | The dashboard spec — stat cards, mission list, and the unbuilt activity feed / Approval Queue. |
| `06-Database.md` | Every table, column, index, and RLS policy across migrations 0001–0006, with the full state backfill mapping. |
| `07-API.md` | The `POST /api/missions` contract, the auth model, error-handling conventions, and the template for future endpoints. |
| `08-Integrations.md` | What's live (Supabase, OAuth sign-in) vs. env-placeholder (Anthropic/OpenAI) vs. not started (Gmail, Stripe, GitHub, Cloudflare). |
| `09-UI-Design-System.md` | The dark-mode-only glass/graphite/navy language — tokens, typography, motion constraints, component inventory, accessibility posture. |
| `10-Development-Standards.md` | TypeScript strictness, the components-never-own-business-logic rule, the (currently empty) testing story, commit and documentation conventions. |
| `11-Product-Roadmap.md` | Sprint 1 (done), Sprint 2 (done), Sprint 3 (next — the first real agents), and the arc beyond. |
| `ARCHITECTURE_DECISIONS.md` | The ADR log — every major engineering decision across Sprint 1 and 2, with context, decision, and alternatives considered. Update this every sprint. |
| `MISSION_ENGINE.md` | The canonical Mission Engine spec — lifecycle, state machine enforcement, event bus, retry/failure handling, worker architecture, queue, approval flow, logging. Honest about what's built vs. stubbed. |
| `VISION_GUARDRAILS.md` | The non-technical product-identity boundary — what Obsidian OS never becomes and always is. Check every future feature proposal against it. |
| `CHATGPT_ARCHITECTURE_REVIEW.md` | External architecture review (ChatGPT, acting as Chief Product & Systems Architect) of Sprint 2 — status APPROVED. Kept verbatim as the review artifact. |
| `FOUNDER_DIRECTIVE.md` | The authoritative post-Sprint-2 product direction doc from the founder — canonical source for product identity, architecture principles, and the sprint roadmap. Kept verbatim. |
| `SPRINT_2_REVIEW.md` | The Sprint 2 Architecture Review Gate deliverable — schema, mission engine, decision memory, multi-tenancy, build validation evidence, technical debt, Sprint 3 recommendation, and a self-critical CTO assessment. This gate now happens after every sprint, before merge. |
| `SPRINT_3_DESIGN_REVIEW.md` | Design-only spec for Sprint 3 (Business URL Analysis) — architecture, DB/API changes, UI wireframe, Mission Engine integration, acceptance criteria, risks, open questions. Awaiting approval; no implementation yet. |
| `SPRINT_STATUS.md` | Sprint-by-sprint status tracking — what's actually done, what's next. Update this every sprint. |
| `VISION.md` | Superseded — now a short pointer to `01-Product-Vision.md`, kept only so existing links don't break. |

## The rule this folder follows

Every numbered doc is a genuine deep-dive grounded in the real code (migrations, TypeScript source, components) as it exists at the time of writing — not aspirational descriptions of unbuilt features presented as if they work. Where a doc describes something forward-looking (an unbuilt agent, an unwired integration), it says so plainly. Keep it that way: update the relevant doc in the same change that changes the code it describes.
