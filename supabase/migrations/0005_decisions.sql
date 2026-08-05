-- Obsidian OS — Sprint 2 / Decision 4.
-- Decision Intelligence layer: captures every meaningful human decision made
-- in the (future) Approval Queue as structured training data from day one,
-- even though that UI doesn't exist yet. Architecture only — no ML/scoring
-- happens here, just a well-shaped table and a typed logging service
-- (lib/services/decision-service.ts) ready for that UI to call.

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  -- Denormalized, same rationale as mission_events.organization_id: avoids
  -- a join to missions in every RLS check and every analytics query over
  -- what is expected to become a high-volume table.
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  decision_type text not null check (decision_type in (
    'approve',
    'reject',
    'not_a_fit',
    'edit_subject',
    'edit_email',
    'edit_proposal',
    'change_price',
    'skip_industry',
    'approve_immediately',
    'wait_until_later',
    'archive'
  )),
  ai_recommendation text,
  user_action text,
  before_value jsonb,
  after_value jsonb,
  industry text,
  opportunity_score numeric,
  website_score numeric,
  proposal_price numeric(10, 2),
  email_subject text,
  email_length integer,
  website_theme text,
  business_category text,
  -- Catch-all for anything not yet in a named column, so future signals can
  -- be captured without another migration.
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists decisions_mission_id_idx on public.decisions(mission_id);
create index if not exists decisions_organization_id_idx on public.decisions(organization_id);
create index if not exists decisions_decision_type_idx on public.decisions(decision_type);

alter table public.decisions enable row level security;

create policy "Org members can select decisions"
  on public.decisions for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert decisions"
  on public.decisions for insert
  with check (public.is_org_member(organization_id));

create policy "Org members can update decisions"
  on public.decisions for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Org members can delete decisions"
  on public.decisions for delete
  using (public.is_org_member(organization_id));
