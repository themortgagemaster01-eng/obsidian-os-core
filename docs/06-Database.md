# 06 — Database

Ground truth is always the migrations themselves: `supabase/migrations/0001_init.sql` through `0006_memory_vault.sql`. This document summarizes them table by table, but if this doc and a migration ever disagree, the migration is right and this doc is stale — fix the doc.

All six migrations are Postgres/Supabase SQL, applied in numeric order, each idempotent-where-reasonable (`create table if not exists`, `add column if not exists`, `drop policy if exists` before `create policy`) even though there is no live production data yet — the team's stated intent is to ship these as-is once a real environment exists, not rewrite them as a single squashed migration later.

## `profiles` (0001, extended by 0002)

One row per Supabase Auth user, created automatically.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | = `auth.users.id`, `on delete cascade` |
| `email` | text | |
| `full_name` | text | |
| `avatar_url` | text | |
| `default_organization_id` | uuid | FK → `organizations.id`; added in 0002 |
| `created_at` / `updated_at` | timestamptz | `updated_at` maintained by the shared `set_updated_at()` trigger |

RLS: `auth.uid() = id` for select/insert/update/delete — profiles remain individually scoped, never organization-scoped (a profile belongs to exactly one person).

Created by the `handle_new_user()` trigger on `auth.users` insert (`security definer`, `search_path = public`). 0002 rewrote this function (not replaced the trigger — `create or replace function` is sufficient since the trigger references it by name) to also provision a personal organization in the same atomic flow: derive an org name from `full_name` or the email's local part (falling back to "My Agency"), slugify it with a random suffix for guaranteed uniqueness, insert the `organizations` row, insert the `organization_members` row with `role = 'owner'`, and set `default_organization_id`.

## `organizations` / `organization_members` (0002)

Multi-tenancy groundwork.

**`organizations`**: `id` (uuid PK), `name`, `slug` (unique), `plan` (`trial` | `starter` | `pro` | `agency` | `white_label`, default `trial`), `created_at`/`updated_at`.

**`organization_members`**: composite PK `(organization_id, user_id)`, `role` (`owner` | `admin` | `member`, default `owner`), `created_at`. Indexed on `user_id` for "which orgs am I in" lookups.

**RLS helper functions**, used by every membership-scoped policy from this migration forward:
- `is_org_member(org_id uuid) returns boolean` — `security definer stable`, checks `organization_members` for a matching row for `auth.uid()`.
- `is_org_admin(org_id uuid) returns boolean` — same shape, additionally requires `role in ('owner', 'admin')`.

Both are `security definer`, owned by the migration role, so they run with that role's implicit RLS exemption — the standard Supabase pattern to avoid "infinite recursion detected in policy" errors a naive self-referencing policy on `organization_members` would trigger.

RLS: members can select their organizations and their own memberships; owners/admins can update the organization and manage (`for all`) memberships. **There is deliberately no client-facing INSERT policy** for either table beyond the admin-management policy — the only way a row is created today is the `security definer` trigger. A future "invite a teammate" flow needs its own insert policy; not built.

## `missions` (0001, reshaped by 0003)

The mission's core table, after 0003's reshape:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `owner_id` | uuid | FK → `profiles.id`; who created/is assigned — no longer the RLS boundary |
| `organization_id` | uuid, NOT NULL | FK → `organizations.id`; added 0003, backfilled from owner's `default_organization_id`, then locked NOT NULL |
| `company_id` | uuid, nullable | FK → `companies.id`; added 0006, nullable because it postdates Sprint 1 missions |
| `business_name` | text, NOT NULL | |
| `website_url` | text, NOT NULL | |
| `state` | text, NOT NULL, default `'discovered'` | CHECK constraint, 11 values — see below |
| `state_changed_at` | timestamptz, NOT NULL, default `now()` | maintained by `set_mission_state_changed_at()` trigger, fires only when `state` actually changes |
| `created_at` / `updated_at` | timestamptz | |

**The `state` CHECK constraint** (`missions_state_check`): `discovered`, `analyzing`, `researching`, `designing`, `qa`, `proposal`, `email`, `approval`, `sent`, `archived`, `rejected`. This is a text column with a CHECK, not a native Postgres `enum` type — see `docs/ARCHITECTURE_DECISIONS.md` for why.

**Old columns removed:** `status` (`active`/`waiting_approval`/`completed`/`failed`/`archived`) and `stage` (`recon`/`research`/`copywriting`/`design`/`seo`/`performance`/`proposal`/`deployment`/`outreach`/`waiting_approval`) both existed in 0001 and were dropped in 0003 after backfilling `state` from them. The backfill CASE expression (status rules win over stage rules when both could apply):

```
status = 'completed'        -> sent
status = 'failed'           -> rejected
status = 'archived'         -> archived
stage  = 'recon'            -> discovered
stage  = 'research'         -> analyzing
stage  = 'copywriting'      -> researching
stage  = 'design'           -> designing
stage  = 'seo'               -> qa
stage  = 'performance'      -> qa
stage  = 'proposal'          -> proposal
stage  = 'deployment'       -> qa
stage  = 'outreach'         -> email
stage  = 'waiting_approval' -> approval
(else)                       -> discovered
```

Indexes: `missions_owner_id_idx`, `missions_organization_id_idx`, `missions_state_idx` (replacing the dropped `missions_status_idx`), `missions_company_id_idx`.

RLS: `is_org_member(organization_id)` for select/insert/update/delete, replacing Sprint 1's `owner_id = auth.uid()`.

## `mission_events` (0001, reshaped by 0004)

The mission timeline — as of Sprint 2, the persistence half of the formal event bus (`lib/events/event-bus.ts`), not a free-text log anyone can write to directly.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `mission_id` | uuid, NOT NULL | FK → `missions.id`, cascade delete |
| `organization_id` | uuid, NOT NULL | **Denormalized** from the parent mission; added 0004 |
| `event_type` | text, NOT NULL | CHECK constraint, 10 values matching `DomainEventType` exactly |
| `message` | text, NOT NULL | Human-readable, generated by `describeEvent()` in `event-bus.ts` |
| `metadata` | jsonb, NOT NULL, default `{}` | The event's typed payload, stored as JSON |
| `actor` | text, NOT NULL, default `'system'` | Added 0004: who/what published it — `system`, `user`, or a future `agent:<name>` |
| `created_at` | timestamptz | |

**The `event_type` CHECK constraint** (`mission_events_event_type_check`): `MissionStarted`, `WebsiteScanned`, `SEOComplete`, `ProposalReady`, `EmailDraftReady`, `MissionApproved`, `MissionRejected`, `MissionArchived`, `StateChanged`, `DecisionLogged` — exact PascalCase strings, no snake_case translation between the TS discriminant and the persisted value, by deliberate design (see `types.ts`'s doc comment).

Legacy backfill: Sprint 1's `event_type` values (`mission_created`, `stage_changed`, and any stray `note`) were mapped to `MissionStarted`/`StateChanged`/`StateChanged` respectively before the CHECK constraint was added, so no pre-existing row would violate it.

Indexes: `mission_events_mission_id_created_at_idx`, `mission_events_organization_id_idx`.

RLS: `is_org_member(organization_id)` for select/insert, using the denormalized column directly — no join to `missions` needed on every check, a deliberate performance/simplicity tradeoff (see the ADR log).

## `decisions` (0005)

The Decision Intelligence layer's storage. New table, no backfill.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `mission_id` | uuid, NOT NULL | FK → `missions.id`, cascade delete |
| `organization_id` | uuid, NOT NULL | Denormalized, same rationale as `mission_events` |
| `created_at` | timestamptz | |
| `decision_type` | text, NOT NULL | CHECK, 11 values (below) |
| `ai_recommendation` | text, nullable | free text |
| `user_action` | text, nullable | free text |
| `before_value` / `after_value` | jsonb, nullable | flexible, not rigid typed columns — see ADR log |
| `industry` | text, nullable | |
| `opportunity_score` | numeric, nullable | |
| `website_score` | numeric, nullable | |
| `proposal_price` | numeric(10,2), nullable | |
| `email_subject` | text, nullable | |
| `email_length` | integer, nullable | |
| `website_theme` | text, nullable | |
| `business_category` | text, nullable | |
| `metadata` | jsonb, NOT NULL, default `{}` | catch-all for anything not yet in a named column |

**`decision_type` CHECK values**: `approve`, `reject`, `not_a_fit`, `edit_subject`, `edit_email`, `edit_proposal`, `change_price`, `skip_industry`, `approve_immediately`, `wait_until_later`, `archive`.

Indexes: `decisions_mission_id_idx`, `decisions_organization_id_idx`, `decisions_decision_type_idx` (the last one specifically for future analytics queries like "how often is `edit_proposal` chosen").

RLS: full CRUD scoped to `is_org_member(organization_id)`.

## `companies` (0006)

The Memory Vault — the anchor of the future CRM. New table, no backfill (Sprint 1 missions have `company_id = null`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `organization_id` | uuid, NOT NULL | FK → `organizations.id` |
| `business_name` | text, NOT NULL | |
| `website_url` | text, NOT NULL | **Normalized** before storage — see `company-service.ts::normalizeWebsiteUrl` |
| `industry` / `business_category` | text, nullable | |
| `first_discovered_at` | timestamptz, default `now()` | |
| `last_mission_id` | uuid, nullable | FK → `missions.id`, `on delete set null` |
| `total_missions_count` | integer, default 0 | incremented by `findOrCreateCompany()` on repeat missions |
| `last_contacted_at` | timestamptz, nullable | |
| `last_proposal_amount` | numeric(10,2), nullable | |
| `last_proposal_sent_at` | timestamptz, nullable | |
| `follow_up_date` | date, nullable | |
| `design_preferences` | jsonb, NOT NULL, default `{}` | freeform, future design agents append here |
| `do_not_contact` | boolean, NOT NULL, default `false` | compliance/opt-out flag — must be checked before any future outreach |
| `notes` | text, nullable | |
| `created_at` / `updated_at` | timestamptz | |

**Unique constraint:** `(organization_id, website_url)` — one company row per business per organization, which is what makes `findOrCreateCompany()`'s lookup-or-insert logic correct.

Indexes: `companies_organization_id_idx`, `companies_last_mission_id_idx`.

RLS: full CRUD scoped to `is_org_member(organization_id)`.

`missions.company_id` (added here, not in 0001) links a mission to its company; nullable because Sprint 1 missions predate this table.

## RLS posture, summarized

Every table added or touched since 0002 is scoped by organization membership via `is_org_member()`/`is_org_admin()`, not by the requesting user's own rows. `profiles` remains the one exception (individually scoped — a profile is inherently personal, not shared). No table is reachable by an authenticated user for a row outside their organization's membership. There is no service-role bypass documented anywhere in application code — any future background job runner (Sprint 3+) that needs to act across organizations (e.g. a scheduler processing every organization's pending missions) will need to use the Supabase service-role key deliberately and audit that usage carefully, since it bypasses RLS entirely.

## Indexing philosophy

Every foreign-key-shaped column used in an RLS check or a common query filter has a matching index: `organization_id` on every org-scoped table, `mission_id` on every mission-child table, and `state` on `missions` (replacing the old `status` index) since "list missions by state" is the Mission Control dashboard's core query shape. No composite indexes exist yet beyond `mission_events(mission_id, created_at)` for timeline ordering — revisit as real query patterns emerge from Sprint 3's agents and any analytics work.
