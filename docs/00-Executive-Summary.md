# 00 — Executive Summary

This is the shortest path to understanding Obsidian OS. For depth, follow the links; for the full synthesis, read `docs/MASTER_BLUEPRINT.md`.

## What it is

Obsidian OS is an **Autonomous Client Acquisition Operating System** for a small digital agency — a more precise label than the looser "AI Agency Operating System," and categorically not a website builder. The product runs an explicit pipeline (Discovery → Qualification → Research → Design → Proposal → Email → CRM → Learning → Analytics — see `docs/MASTER_BLUEPRINT.md` §1) end to end, autonomously, on a human's behalf. Website generation is one factory inside the Design stage, not the product's identity. The product's actual job is to run the analytical and creative pipeline a human strategist, designer, and copywriter would otherwise do by hand — discovery, qualification, research, design, proposal assembly, and outreach drafting — and hand a curated, finished set of opportunities to a human each morning for a fast approve/reject/edit decision.

## The core unit of work

Everything in the system organizes around a **mission**: one prospect business, tracked from first discovery through a proposed engagement. A mission has exactly one canonical `state` (see `docs/06-Database.md` and `docs/03-Software-Architecture.md`) that describes where it sits in the pipeline, and every meaningful thing that happens to it is recorded as a typed event on its timeline (`docs/03-Software-Architecture.md`, `docs/04-AI-Systems.md`).

## The one trust boundary that never moves

Nothing the system produces reaches a real prospect or client without a human explicitly approving it. No auto-send, no auto-deploy, ever — regardless of how capable the agents become. See `docs/01-Product-Vision.md` for the full reasoning.

## What's actually built vs. what's spec

As of Sprint 2 (commit `0a3a5f0`), the system has: working auth, a working Mission Control dashboard, a manual "create mission" flow, a unified 11-state mission state machine, multi-tenant organization scoping with row-level security, a typed event bus, and the database schema for Decision Memory and a CRM-anchoring Memory Vault. **No AI agent is implemented yet** — no discovery, no scoring, no research, no design generation, no proposal generation, no email drafting. Those are Sprint 3 and beyond. Every document in `/docs` is explicit about which parts of what it describes are live code versus forward-looking specification — do not assume a described capability exists without checking.

## Where to go next

- Building or changing the mission pipeline? Start with `docs/03-Software-Architecture.md` and `docs/06-Database.md`.
- Building an agent? Start with `docs/04-AI-Systems.md`.
- Touching the UI? Start with `docs/05-Mission-Control.md` and `docs/09-UI-Design-System.md`.
- Understanding why a past decision was made? `docs/ARCHITECTURE_DECISIONS.md`.
- Understanding what's next? `docs/11-Product-Roadmap.md` and `docs/SPRINT_STATUS.md`.
