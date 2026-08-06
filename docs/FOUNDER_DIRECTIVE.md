# Obsidian OS
# MASTER DEVELOPMENT DIRECTIVE
## Founder Operating Instructions
### Version 3.0
### Status: ACTIVE
### Date: August 2026

---

# Executive Directive

Obsidian OS has officially transitioned from concept to production software.

The architecture is considered stable.

Future development should focus on delivering customer value rather than expanding architecture.

GitHub is now the canonical source of truth.

Claude sessions are disposable implementation environments.

Every development session should begin by pulling the latest code from GitHub.

---

# Canonical Repository

Repository:

obsidian-os-core

Status

✅ Private

✅ GitHub is Source of Truth

✅ README.md

✅ CONTRIBUTING.md

✅ CLAUDE.md

✅ CLAUDE_OPERATING_DIRECTIVE.md

⏳ FOUNDER_DIRECTIVE_V2.md (pending push if stalled)

✅ Complete commit history preserved

Do not continue development from long-running sandbox sessions.

---

# Repository Workflow

GitHub is now the official development environment.

Every new implementation session must:

1. Clone or pull latest repository.
2. Read project documentation.
3. Confirm current sprint status.
4. Implement only the approved phase.
5. Commit frequently.
6. Push to GitHub.
7. End the session.

Do not allow Claude sessions to exceed approximately 200–300 turns whenever possible.

Treat sessions as disposable workers.

GitHub owns project history.

---

# Required Startup Procedure

Every Claude session begins by reading:

README.md

CONTRIBUTING.md

CLAUDE.md

CLAUDE_OPERATING_DIRECTIVE.md

MASTER_BLUEPRINT.md

MISSION_ENGINE.md

ARCHITECTURE_DECISIONS.md

SPRINT_STATUS.md

Review the latest completed sprint.

Confirm understanding before implementation begins.

---

# Product Identity

Obsidian OS is NOT a website builder.

It is an

Autonomous Client Acquisition Operating System.

Website generation is only one deliverable produced by the platform.

---

# Product Mission

The founder should wake each morning to businesses that have already been:

Discovered

↓

Analyzed

↓

Scored

↓

Documented

↓

Redesigned

↓

Packaged into a proposal

↓

Prepared as a draft email

↓

Ready for founder approval

The founder reviews opportunities.

The system performs the work.

---

# Mission Pipeline

Business Discovery

↓

Mission Created

↓

Opportunity Intelligence

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

Every feature must support this workflow.

---

# Mission Engine Rules

Mission Engine owns workflow.

Nothing else.

Only:

transitionMissionState()

and

EventBus.publish()

may change workflow state.

React never owns workflow.

React only renders state.

---

# Service Architecture

Maintain strict responsibility boundaries.

AnalysisService

↓

BusinessInsightService

↓

OpportunityScoringService

↓

OpportunityReportService

↓

Presentation Layer

↓

Founder

Never merge responsibilities.

---

# Adapter Rules

Adapters gather information only.

Adapters never contain business logic.

Approved adapters:

• Crawl

• SEO

• Accessibility

• Mobile

• Lighthouse

• Technology Detection

• Screenshot

Business logic belongs in services.

---

# Processing Pipeline

Raw Analysis

↓

Normalized Analysis

↓

Business Insights

↓

Opportunity Score

↓

Opportunity Report

↓

Presentation Layer

Every layer owns one responsibility.

---

# Opportunity Report Philosophy

The Opportunity Report is the product.

Everything else supports it.

The report must answer:

What was discovered?

Why does it matter?

What business opportunity exists?

Why should the founder contact this business?

How could the business improve?

The report should read like it was written by a senior digital consultant.

Avoid technical jargon.

Business language always wins.

---

# Evidence First

Evidence First is now a permanent architectural principle.

Every recommendation must reference measurable evidence.

Examples

Slow loading

↓

Lighthouse

Missing H1

↓

SEO Adapter

Accessibility issue

↓

Accessibility Adapter

No evidence

=

No recommendation.

---

# Confidence

Each report section should expose confidence metadata.

Example

Performance

Confidence: High

Measured directly.

Business Opportunity

Confidence: Medium

Derived from measurable indicators.

Never imply certainty beyond available evidence.

---

# Decision Memory

Decision Memory remains a future core capability.

Eventually capture:

Proposal edits

Email edits

Pricing changes

Founder approvals

Founder rejections

Recommendation edits

Never overwrite history.

Historical decisions become learning.

---

# Current Sprint Status

## Sprint 1

✅ Complete

Mission Engine

Architecture

Documentation

Database

---

## Sprint 2

✅ Complete

Decision Memory Foundation

Organizations

Architecture refinement

Documentation

---

## Sprint 3

Opportunity Intelligence

Phase 1

✅ Complete

Infrastructure

Adapters

Migration

Analysis Service

Async execution

---

Phase 2

✅ Complete

BusinessInsightService

OpportunityScoringService

OpportunityReportService

22 unit tests

Real runtime validation

Regression tests

---

Phase 3

⏸ HOLD

Presentation Layer

Mission Detail Page

Opportunity Report UI

Loading States

Progress Indicators

Failure States

Report Rendering

---

Phase 4

Pending

Real-world validation

Five benchmark reports

Founder review

---

# IMPORTANT

Phase 3 is intentionally paused.

Do NOT begin Phase 3 until local repository validation is complete.

This is the only temporary exception to the Founder Directive.

---

# Immediate Priority

Validate the repository locally.

Steps:

Clone repository

↓

npm install

↓

Generate package-lock.json

↓

npm test

↓

npm run build

↓

Verify application starts

↓

Commit package-lock.json

↓

Push to GitHub

Once completed:

Phase 3 is automatically authorized.

No additional architecture review required.

---

# Testing Standards

Every feature requires:

Unit Tests

↓

Integration Tests

↓

Real Website Validation

↓

Founder Review

Never fake successful analysis.

Failures must be reported honestly.

Engineering honesty is a permanent project principle.

---

# Benchmark Reports

Sprint 3 validation will use:

Restaurant

Dentist

Law Firm

HVAC

Landscaping

These become permanent benchmark reports.

Future improvements should improve these reports.

---

# Development Principles

Prefer:

Simple

Readable

Maintainable

Testable

Evidence-based

Customer-focused

Avoid unnecessary abstraction.

Avoid architecture for architecture's sake.

Customer value always wins.

---

# Repository Standards

Maintain:

README.md

CONTRIBUTING.md

CLAUDE.md

CLAUDE_OPERATING_DIRECTIVE.md

FOUNDER_DIRECTIVE_V2.md

MASTER_BLUEPRINT.md

MISSION_ENGINE.md

ARCHITECTURE_DECISIONS.md

CHANGELOG.md (after Sprint 3)

Documentation must always describe implemented reality.

---

# Git Standards

Small commits.

Frequent pushes.

Clean history.

No force pushes.

GitHub Releases after major milestones.

Suggested releases:

v0.3.0-alpha

Sprint 3 Complete

v0.4.0

Website Generation

v0.5.0

Proposal Engine

---

# Original Repository

The existing repository:

obsidian-os

is considered an earlier prototype.

Do not overwrite it.

After Sprint 3, compare:

Architecture

UI

Components

Database

Documentation

Services

Reusable code

Technical debt

Then recommend:

Merge

Replace

Keep Separate

Do not automatically overwrite history.

---

# Development Session Rules

One implementation phase per session.

Example:

Session A

Phase 1

Commit

Push

End Session

Session B

Phase 2

Commit

Push

End Session

Session C

Phase 3

Commit

Push

End Session

This prevents large-context degradation.

---

# Future Roadmap

Sprint 3

Opportunity Intelligence

↓

Sprint 4

Premium Website Generation

↓

Sprint 5

Proposal Generation

↓

Sprint 6

Draft Email Generation

↓

Sprint 7

Approval Queue

↓

Sprint 8

Decision Memory

↓

Sprint 9

Learning Engine

↓

Sprint 10

Founder Dashboard

↓

Future

AI Vision Layer

Video Outreach

Multi-Agent Collaboration

Analytics

---

# Future Enhancements

These are NOT Sprint 3 work items.

Evaluate after Version 1:

• AI-generated personalized outreach videos
• Optional local video generation (e.g., Wan2GP or equivalent)
• AI Vision assessment (Visual Quality, CTA quality, Brand Strength)
• Advanced Learning Engine
• Automated outreach scheduling

These remain future enhancements and must not delay core product delivery.

---

# Success Definition

Sprint 3 is complete when:

A founder pastes a business URL.

↓

Analysis completes.

↓

Opportunity Report is generated.

↓

The founder says:

"I would confidently send this report to a prospective client."

That is the definition of done.

---

# Engineering Philosophy

Always report:

What works.

What failed.

What was tested.

What remains unverified.

Never hide uncertainty.

Never fake success.

Engineering honesty is one of Obsidian OS's defining principles.

---

# Final Founder Directive

The architecture is complete.

The engineering process is established.

GitHub is the source of truth.

Claude sessions are disposable.

Customer value comes before engineering ceremony.

Validate locally.

Resume Phase 3.

Complete Sprint 3.

Test with real businesses.

Learn.

Iterate.

Ship.

This document supersedes previous operational directives and should serve as the master development guide for all future Obsidian OS implementation.
