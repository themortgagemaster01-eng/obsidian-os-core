# Obsidian OS
# Claude Operating System Directive
## Development Workflow Standard
### Version 1.0

---

# Executive Direction

After reviewing additional AI engineering workflows and our own Sprint 1–3 experience, we are adopting a refined development process for Obsidian OS.

This is not a change to the product vision.

It is a refinement of how Claude should build the platform going forward.

The goal is to maximize development speed, maintainability, review quality, and long-term scalability.

---

# Product Identity

Obsidian OS is **not** a website builder.

Obsidian OS is an **Autonomous Client Acquisition Operating System**.

Website generation is only one artifact produced by the system.

The complete workflow remains:

Business Discovery

↓

Mission Created

↓

Website Analysis

↓

Business Insights

↓

Opportunity Score

↓

Opportunity Report

↓

Website Generation

↓

Proposal Generation

↓

Draft Email

↓

Founder Review

↓

Approval

↓

Send

↓

Decision Memory

↓

Learning

↓

Analytics

Every feature should support this pipeline.

---

# Core Philosophy

Always optimize for customer value.

Architecture exists to support customer outcomes.

Avoid unnecessary complexity.

Avoid engineering for hypothetical future problems.

Build only what advances the customer journey.

---

# Claude Responsibilities

Claude acts as a senior engineering partner.

Responsibilities include:

- Designing architecture
- Writing production-quality code
- Maintaining documentation
- Updating architecture decisions
- Creating tests
- Explaining implementation decisions
- Identifying technical debt honestly
- Reporting implementation risks

Claude should never hide failures or uncertainty.

Engineering honesty is a core principle.

---

# Design → Code → GitHub Workflow

Going forward every major feature follows this workflow.

## Phase 1

Design

Architecture

Workflow

Acceptance Criteria

Review

Approval

↓

## Phase 2

Implementation

Claude Code

↓

## Phase 3

GitHub

Commit

Push

Review

↓

## Phase 4

Validation

Real-world testing

↓

## Phase 5

Approval

Merge

Next Sprint

GitHub is now the canonical source of truth.

Claude sessions are disposable implementation environments.

---

# Repository Standards

GitHub owns project history.

Requirements:

- Small commits
- Frequent pushes
- No rewritten history
- No force pushes without approval
- Every phase committed separately
- Every sprint review committed

Repository should always be recoverable from GitHub.

---

# Repository Structure

Recommended layout:

```
docs/

architecture/

adrs/

design/

src/

lib/

services/

adapters/

mission/

tests/

scripts/
```

Keep documentation synchronized with implementation.

Documentation should always describe reality.

---

# CLAUDE.md

Every implementation session should begin by reading:

CLAUDE.md

This file should summarize:

- Product mission
- Coding standards
- Repository rules
- Mission Engine rules
- Architecture principles
- Development philosophy
- Testing expectations

It should be short enough to understand in under five minutes.

---

# Mission Engine Rules

Mission Engine owns workflow.

No service may directly modify workflow state.

Only:

transitionMissionState()

and

EventBus.publish()

may change mission progression.

React never owns workflow.

React only renders state.

---

# Service Architecture

Maintain strict responsibility boundaries.

AnalysisService

Collects facts.

↓

BusinessInsightService

Explains facts.

↓

OpportunityScoringService

Evaluates facts.

↓

OpportunityReportService

Presents facts.

↓

UI

Displays report.

Never merge responsibilities.

---

# Adapter Rules

Adapters communicate with external systems.

Adapters never contain business logic.

Examples:

- Crawl Adapter
- SEO Adapter
- Lighthouse Adapter
- Screenshot Adapter
- Accessibility Adapter
- Technology Adapter

Adapters gather information only.

---

# Opportunity Report Rules

The Opportunity Report is the primary product.

The report must answer:

What was discovered?

Why does it matter?

What business opportunity exists?

How could the business improve?

Every recommendation must reference measurable evidence.

No unsupported statements.

No exaggerated marketing language.

Business language always takes priority over technical jargon.

---

# Evidence First

Evidence is now a permanent architectural principle.

Every recommendation must identify its source.

Examples:

Slow loading

↓

Lighthouse

Missing H1

↓

SEO Adapter

Accessibility issue

↓

Accessibility Adapter

If evidence does not exist,

the statement should not exist.

---

# Confidence Ratings

Each report section should include confidence metadata.

Example:

Performance

Confidence: High

Reason:

Measured directly.

Business Opportunity

Confidence: Medium

Reason:

Derived from multiple measurable indicators.

AI-generated conclusions should never imply greater certainty than the available evidence supports.

---

# Decision Memory

Decision Memory remains a core long-term capability.

Every founder edit should eventually become learning data.

Examples:

- Proposal edits
- Email edits
- Pricing changes
- Recommendation changes
- Opportunity approvals
- Opportunity rejections

Never overwrite historical decisions.

Always preserve learning history.

---

# Design System

Use Claude Design to rapidly explore user experience when appropriate.

Claude Design should answer:

"What should this look like?"

Claude Code should answer:

"How does it work?"

The same design system should be shared across implementation.

Do not create inconsistent components.

---

# Testing Standards

Every phase requires testing.

Preferred order:

Unit Tests

↓

Integration Tests

↓

Real Website Validation

↓

Founder Review

Mock data is acceptable for development.

Real public websites are required before completion.

---

# Sprint Workflow

Every sprint follows:

Design

↓

Review

↓

Approval

↓

Implementation

↓

Testing

↓

Sprint Review

↓

Merge

↓

Next Sprint

Avoid implementing multiple sprints simultaneously.

---

# Phase Reviews

Large sprint reviews should be avoided.

Review every phase separately.

Example:

Phase 1

Infrastructure

↓

Review

↓

Phase 2

Business Logic

↓

Review

↓

Phase 3

Presentation

↓

Review

↓

Phase 4

Validation

Smaller reviews improve quality and reduce risk.

---

# Development Principles

Prefer simplicity.

Prefer readability.

Prefer maintainability.

Avoid unnecessary abstraction.

Avoid premature optimization.

Customer value always wins.

---

# Founder Approval

Nothing customer-facing should be automated without founder approval.

Generated assets should be reviewed before:

- Sending emails
- Publishing proposals
- Contacting businesses

Founder approval remains part of the platform.

---

# Roadmap

Current priority:

Sprint 3

Opportunity Intelligence

Next:

Sprint 4

Premium Website Generation

Then:

Sprint 5

Proposal Generation

Then:

Sprint 6

Draft Email Generation

Future:

Decision Memory

Learning Engine

Automation

Analytics

Multi-Agent Collaboration

AI Vision Layer

---

# Success Standard

Every implementation decision should support one objective:

The founder wakes up each morning to a queue of high-quality business opportunities that have already been analyzed, documented, and prepared for outreach.

The founder's role becomes reviewing opportunities and deciding which businesses to contact.

Everything else exists to support that mission.

---

# Final Directive

Continue implementing Obsidian OS using this operating model.

Do not redesign the platform unless implementation reveals a genuine architectural issue.

Keep GitHub as the source of truth.

Keep documentation synchronized with implementation.

Keep engineering honest.

Ship customer value.

Review.

Learn.

Iterate.

This is now the standard operating procedure for all future Obsidian OS development.
