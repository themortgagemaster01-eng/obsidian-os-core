-- Obsidian OS — Sprint 2 / Decision 5.
-- Memory Vault: the `companies` table is the anchor of the future CRM, not
-- a bolt-on. Every business Obsidian OS ever discovers accumulates a
-- persistent record across every mission, proposal, communication, and
-- outcome here. Architecture only in Sprint 2 — no CRM list/detail UI.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  business_name text not null,
  website_url text not null,
  industry text,
  business_category text,
  first_discovered_at timestamptz not null default now(),
  last_mission_id uuid references public.missions(id) on delete set null,
  total_missions_count integer not null default 0,
  last_contacted_at timestamptz,
  last_proposal_amount numeric(10, 2),
  last_proposal_sent_at timestamptz,
  follow_up_date date,
  -- Freeform observed preferences (e.g. color/style leanings noticed across
  -- missions) — no fixed schema yet, future design agents append to this.
  design_preferences jsonb not null default '{}'::jsonb,
  -- Explicit compliance/opt-out flag. Must be checked (do_not_contact =
  -- false) before any future outreach, in the spirit of CAN-SPAM/GDPR-style
  -- consent hygiene — no outreach code exists yet in Sprint 2, but this
  -- flag is part of the schema from day one so it can never be bolted on
  -- as an afterthought once outreach ships.
  do_not_contact boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, website_url)
);

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
  before update on public.companies
  for each row execute procedure public.set_updated_at();

create index if not exists companies_organization_id_idx on public.companies(organization_id);
create index if not exists companies_last_mission_id_idx on public.companies(last_mission_id);

alter table public.companies enable row level security;

create policy "Org members can select companies"
  on public.companies for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert companies"
  on public.companies for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update companies"
  on public.companies for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete companies"
  on public.companies for delete
  using (public.is_org_member(organization_id));

-- =========================================================================
-- missions.company_id — Sprint 1 missions predate this table, so it's
-- nullable; new missions going forward populate it via
-- lib/services/company-service.ts::findOrCreateCompany, wired into
-- lib/workflow/mission-workflow.ts::createMission.
-- =========================================================================

alter table public.missions
  add column if not exists company_id uuid references public.companies(id);

create index if not exists missions_company_id_idx on public.missions(company_id);
