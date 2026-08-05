-- Obsidian OS — Sprint 2 / Decision 2.
-- Multi-tenancy groundwork: organizations + organization_members, wired into
-- the signup flow so every user gets a personal org automatically, with zero
-- extra steps. No team/billing UI exists yet — this is schema only, laying
-- the groundwork so every mission/company/decision from Sprint 2 onward
-- carries a real organization_id instead of retrofitting tenant isolation
-- later (which is far more painful than building it in from the start).

-- =========================================================================
-- organizations
-- =========================================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'trial'
    check (plan in ('trial', 'starter', 'pro', 'agency', 'white_label')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute procedure public.set_updated_at();

-- =========================================================================
-- organization_members
-- =========================================================================

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_id_idx
  on public.organization_members(user_id);

-- =========================================================================
-- RLS helper functions
--
-- Both helpers are SECURITY DEFINER, owned by the migration role (the same
-- role that owns organization_members), so their internal queries run with
-- that role's implicit RLS exemption as table owner. This is the standard
-- Supabase pattern for avoiding "infinite recursion detected in policy"
-- errors that a naive self-referencing policy on organization_members would
-- otherwise trigger — every membership-scoped policy in this and later
-- migrations (missions, mission_events, decisions, companies) should call
-- one of these rather than re-implementing the membership check inline.
-- =========================================================================

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

-- =========================================================================
-- organizations / organization_members RLS
-- =========================================================================

alter table public.organizations enable row level security;

drop policy if exists "Members can select their organizations" on public.organizations;
create policy "Members can select their organizations"
  on public.organizations for select
  using (public.is_org_member(id));

drop policy if exists "Owners and admins can update their organization" on public.organizations;
create policy "Owners and admins can update their organization"
  on public.organizations for update
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

alter table public.organization_members enable row level security;

drop policy if exists "Members can select memberships in their organizations" on public.organization_members;
create policy "Members can select memberships in their organizations"
  on public.organization_members for select
  using (public.is_org_member(organization_id));

drop policy if exists "Owners and admins can manage memberships" on public.organization_members;
create policy "Owners and admins can manage memberships"
  on public.organization_members for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Note: there is deliberately no client-facing INSERT policy for
-- organizations/organization_members beyond the admin-management policy
-- above — the only way a row is created today is the handle_new_user()
-- trigger below, which runs SECURITY DEFINER and is exempt from RLS as the
-- table owner. A future "invite a teammate" / "create a second org" flow
-- (Sprint-whenever team management ships) will need its own insert policy;
-- intentionally not building that UI or policy now.

-- =========================================================================
-- profiles.default_organization_id
-- =========================================================================

alter table public.profiles
  add column if not exists default_organization_id uuid references public.organizations(id);

-- =========================================================================
-- handle_new_user(): now also provisions a personal organization
--
-- Single atomic flow so signup UX is unchanged (still zero extra steps for
-- a solo user): create the profile, create a personal org, add the user as
-- its owner, and point profiles.default_organization_id at it.
-- =========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_org_name text;
  v_slug_base text;
  v_slug text;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  v_org_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'My Agency'
  );

  -- Slugify from the email local-part (or a fallback) plus a short random
  -- suffix so collisions are effectively impossible without needing a
  -- retry loop; slugs are never shown to users in Sprint 2.
  v_slug_base := lower(regexp_replace(
    coalesce(nullif(split_part(new.email, '@', 1), ''), 'org'),
    '[^a-z0-9]+', '-', 'g'
  ));
  v_slug := substr(v_slug_base, 1, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.organizations (name, slug, plan)
  values (v_org_name || '''s Organization', v_slug, 'trial')
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, new.id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  update public.profiles
  set default_organization_id = v_org_id
  where id = new.id;

  return new;
end;
$$;

-- Trigger already exists from 0001_init.sql and points at this function by
-- name, so no need to drop/recreate it — CREATE OR REPLACE FUNCTION above
-- is sufficient to change its behavior.
