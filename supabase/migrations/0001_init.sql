-- Obsidian OS — Sprint 1 schema.
-- Tables: profiles, missions, mission_events.
-- Least-privilege RLS throughout: every policy is scoped to the
-- authenticated user's own rows via auth.uid().

-- =========================================================================
-- profiles
-- =========================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can select their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can delete their own profile"
  on public.profiles for delete
  using (auth.uid() = id);

-- Automatically create a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================================================================
-- shared updated_at trigger helper
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- =========================================================================
-- missions
-- =========================================================================

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  business_name text not null,
  website_url text not null,
  status text not null default 'active'
    check (status in ('active', 'waiting_approval', 'completed', 'failed', 'archived')),
  stage text not null default 'recon'
    check (stage in (
      'recon',
      'research',
      'copywriting',
      'design',
      'seo',
      'performance',
      'proposal',
      'deployment',
      'outreach',
      'waiting_approval'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.missions enable row level security;

create index if not exists missions_owner_id_idx on public.missions(owner_id);
create index if not exists missions_status_idx on public.missions(status);

create policy "Users can select their own missions"
  on public.missions for select
  using (auth.uid() = owner_id);

create policy "Users can insert their own missions"
  on public.missions for insert
  with check (auth.uid() = owner_id);

create policy "Users can update their own missions"
  on public.missions for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Users can delete their own missions"
  on public.missions for delete
  using (auth.uid() = owner_id);

drop trigger if exists set_missions_updated_at on public.missions;
create trigger set_missions_updated_at
  before update on public.missions
  for each row execute procedure public.set_updated_at();

-- =========================================================================
-- mission_events
-- =========================================================================

create table if not exists public.mission_events (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.mission_events enable row level security;

create index if not exists mission_events_mission_id_created_at_idx
  on public.mission_events(mission_id, created_at);

create policy "Users can select events for their own missions"
  on public.mission_events for select
  using (
    exists (
      select 1 from public.missions
      where missions.id = mission_events.mission_id
        and missions.owner_id = auth.uid()
    )
  );

create policy "Users can insert events for their own missions"
  on public.mission_events for insert
  with check (
    exists (
      select 1 from public.missions
      where missions.id = mission_events.mission_id
        and missions.owner_id = auth.uid()
    )
  );
