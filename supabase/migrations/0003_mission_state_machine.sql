-- Obsidian OS — Sprint 2 / Decision 1.
-- Collapses missions.status + missions.stage (two overlapping fields that
-- could drift out of sync) into a single canonical `state` column, and adds
-- missions.organization_id so every mission is tenant-scoped. Written as
-- real, idempotent-where-reasonable backfill logic even though there's no
-- live data yet — this ships as-is later.

-- =========================================================================
-- missions.organization_id (+ backfill)
-- =========================================================================

alter table public.missions
  add column if not exists organization_id uuid references public.organizations(id);

-- Backfill from the mission owner's default organization. After 0002, every
-- profile has a default_organization_id set by handle_new_user(), so this
-- covers all rows created through the normal signup flow.
update public.missions m
set organization_id = p.default_organization_id
from public.profiles p
where p.id = m.owner_id
  and m.organization_id is null
  and p.default_organization_id is not null;

-- Any remaining rows (an owner profile with no default org somehow) block
-- the NOT NULL below with a clear error rather than silently dropping data
-- — surfacing a bad backfill is safer than hiding it.
alter table public.missions
  alter column organization_id set not null;

create index if not exists missions_organization_id_idx
  on public.missions(organization_id);

-- =========================================================================
-- missions.state (+ state_changed_at) — replaces status + stage
-- =========================================================================

alter table public.missions add column if not exists state text;
alter table public.missions add column if not exists state_changed_at timestamptz not null default now();

-- Backfill state from the old stage/status vocabulary. Status-based rules
-- win over stage-based rules when both could apply (status was the more
-- authoritative field for terminal outcomes in the Sprint 1 schema).
update public.missions
set state = case
    when status = 'completed' then 'sent'
    when status = 'failed' then 'rejected'
    when status = 'archived' then 'archived'
    when stage = 'recon' then 'discovered'
    when stage = 'research' then 'analyzing'
    when stage = 'copywriting' then 'researching'
    when stage = 'design' then 'designing'
    when stage = 'seo' then 'qa'
    when stage = 'performance' then 'qa'
    when stage = 'proposal' then 'proposal'
    -- No standalone top-level "deployment" state in the new vocabulary:
    -- publishing a preview build is a sub-activity of QA/design review,
    -- tracked via events (e.g. WebsiteScanned) rather than a pipeline gate.
    when stage = 'deployment' then 'qa'
    when stage = 'outreach' then 'email'
    when stage = 'waiting_approval' then 'approval'
    else 'discovered'
  end,
  state_changed_at = coalesce(updated_at, now())
where state is null;

alter table public.missions alter column state set not null;
alter table public.missions alter column state set default 'discovered';

alter table public.missions
  drop constraint if exists missions_state_check;
alter table public.missions
  add constraint missions_state_check check (state in (
    'discovered',
    'analyzing',
    'researching',
    'designing',
    'qa',
    'proposal',
    'email',
    'approval',
    'sent',
    'archived',
    'rejected'
  ));

-- Keep state_changed_at accurate independent of updated_at (which can
-- change for other reasons, e.g. a future notes/edit field) — this is what
-- lets "Completed Today" correctly use state_changed_at instead of
-- created_at.
create or replace function public.set_mission_state_changed_at()
returns trigger
language plpgsql
as $$
begin
  if new.state is distinct from old.state then
    new.state_changed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_missions_state_changed_at on public.missions;
create trigger set_missions_state_changed_at
  before update on public.missions
  for each row execute procedure public.set_mission_state_changed_at();

-- =========================================================================
-- Drop old stage/status columns (and their CHECK constraints, dropped
-- automatically with the columns)
-- =========================================================================

drop index if exists public.missions_status_idx;

alter table public.missions drop column if exists status;
alter table public.missions drop column if exists stage;

create index if not exists missions_state_idx on public.missions(state);

-- =========================================================================
-- RLS: org-membership scoped, replacing the Sprint 1 owner_id-only policies
-- =========================================================================

drop policy if exists "Users can select their own missions" on public.missions;
drop policy if exists "Users can insert their own missions" on public.missions;
drop policy if exists "Users can update their own missions" on public.missions;
drop policy if exists "Users can delete their own missions" on public.missions;

create policy "Org members can select missions"
  on public.missions for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert missions"
  on public.missions for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update missions"
  on public.missions for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete missions"
  on public.missions for delete
  using (public.is_org_member(organization_id));
