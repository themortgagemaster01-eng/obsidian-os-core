-- Obsidian OS — Sprint 2 / Decision 3.
-- Upgrades mission_events from an ad-hoc free-text log into the persistence
-- side of a real, typed event bus (see lib/events/). Adds `actor` (who/what
-- published the event) and a denormalized `organization_id` (avoids a join
-- to missions in every RLS check and every analytics query — a deliberate
-- performance/simplicity tradeoff for a high-volume table), backfills the
-- old event_type vocabulary to the new PascalCase catalog, and locks the
-- column down with a CHECK constraint.

-- =========================================================================
-- actor
-- =========================================================================

alter table public.mission_events
  add column if not exists actor text not null default 'system';

-- =========================================================================
-- organization_id (+ backfill via join to missions)
-- =========================================================================

alter table public.mission_events
  add column if not exists organization_id uuid references public.organizations(id);

update public.mission_events me
set organization_id = m.organization_id
from public.missions m
where m.id = me.mission_id
  and me.organization_id is null;

alter table public.mission_events
  alter column organization_id set not null;

create index if not exists mission_events_organization_id_idx
  on public.mission_events(organization_id);

-- =========================================================================
-- event_type: backfill Sprint 1 values to the new PascalCase catalog
-- =========================================================================

update public.mission_events
set event_type = case
    when event_type = 'mission_created' then 'MissionStarted'
    when event_type = 'stage_changed' then 'StateChanged'
    else event_type
  end;

-- Catch-all for any other legacy value (e.g. the Sprint 1 'note' type,
-- never actually written by app code but present in the old type union) —
-- map defensively to StateChanged rather than leaving a value that would
-- violate the CHECK constraint below.
update public.mission_events
set event_type = 'StateChanged'
where event_type not in (
  'MissionStarted',
  'WebsiteScanned',
  'SEOComplete',
  'ProposalReady',
  'EmailDraftReady',
  'MissionApproved',
  'MissionRejected',
  'MissionArchived',
  'StateChanged',
  'DecisionLogged'
);

alter table public.mission_events
  drop constraint if exists mission_events_event_type_check;
alter table public.mission_events
  add constraint mission_events_event_type_check check (event_type in (
    'MissionStarted',
    'WebsiteScanned',
    'SEOComplete',
    'ProposalReady',
    'EmailDraftReady',
    'MissionApproved',
    'MissionRejected',
    'MissionArchived',
    'StateChanged',
    'DecisionLogged'
  ));

-- =========================================================================
-- RLS: org-membership scoped (using the denormalized organization_id
-- directly, no join to missions needed)
-- =========================================================================

drop policy if exists "Users can select events for their own missions" on public.mission_events;
drop policy if exists "Users can insert events for their own missions" on public.mission_events;

create policy "Org members can select mission events"
  on public.mission_events for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert mission events"
  on public.mission_events for insert
  with check (public.is_org_member(organization_id));
