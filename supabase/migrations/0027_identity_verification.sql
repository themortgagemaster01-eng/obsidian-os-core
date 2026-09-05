-- Obsidian OS — Phase 14: Business/Domain Identity Verification.
--
-- Two independent fixes to a real, live gap the Phase 14 audit found
-- (docs/PHASE_14_IDENTITY_VERIFICATION_AUDIT.md) while investigating a real
-- production failure (The Freight House Cafe): a squatted/redirected domain's
-- content silently became "business evidence" because nothing in the
-- pipeline ever checked whether the crawled domain still represented the
-- named business.
--
-- =========================================================================
-- 1. leads.discovery_phone / discovery_address — restoring a signal that
--    already existed and was already being thrown away.
-- =========================================================================
--
-- lib/adapters/discovery-adapter.ts's DiscoveredBusiness already extracts a
-- real, independent phone/address from OpenStreetMap's own tagging for
-- every candidate — a signal gathered BEFORE any website is ever crawled,
-- and therefore untouched by whatever that website's domain later does
-- (expires, gets hijacked, redirects). lib/services/lead-hunter-service.ts's
-- two upsertLead call sites never persisted either field — confirmed by the
-- audit, this was a real, live gap, not a hypothetical one. Nullable: a real
-- OSM-tagged business with no phone/address on record is real and already-
-- handled elsewhere in this codebase's own "never fabricated into having
-- one" discipline (see website_url's own nullable-with-the-same-reasoning
-- precedent, 0018_lead_hunter.sql).
alter table public.leads
  add column if not exists discovery_phone text,
  add column if not exists discovery_address text;

-- =========================================================================
-- 2. identity_verifications — one row per identity check, the same "keep
--    entities separated" precedent 0018/0021/0025's own header comments
--    already document (a mission batch run is not a lead scan run is not an
--    identity check — three real, separate concerns, never conflated into
--    one table or one jsonb blob).
-- =========================================================================
--
-- verdict: the tri-state outcome docs/PHASE_14_IMPLEMENTATION_PLAN.md §3
-- defines — confirmed (proceed normally), uncertain (proceed, but the
-- specific evidence categories the check itself flagged get cleared before
-- Design Brief generation ever sees them), failed (rejectMission() is
-- called instead of transitioning analyzing -> researching; Design Brief,
-- Website Generation, and QA never run for this mission at all).
--
-- signals: real, disclosed per-signal reasoning — {signal, verdict, detail}[]
-- — the same "every claim traces to something checkable" discipline
-- design-qa-service.ts's own category reasoning already holds itself to.
-- Never just a bare verdict with no explanation.
--
-- suppressed_evidence_categories: populated only when verdict = 'uncertain'
-- — which NormalizedAnalysis fields runDesignBrief cleared to their honest-
-- empty defaults before building citedInsights, so a founder (or a future
-- audit) can see exactly what was withheld and why, not just that something
-- was.
create table if not exists public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),

  verdict text not null check (verdict in ('confirmed', 'uncertain', 'failed')),
  signals jsonb not null default '[]'::jsonb,
  suppressed_evidence_categories text[] not null default '{}',

  created_at timestamptz not null default now()
);

create index if not exists identity_verifications_mission_id_idx on public.identity_verifications(mission_id);
create index if not exists identity_verifications_organization_id_idx on public.identity_verifications(organization_id);

alter table public.identity_verifications enable row level security;

create policy "Org members can select identity verifications"
  on public.identity_verifications for select
  using (public.is_org_member(organization_id));

create policy "Org members can insert identity verifications"
  on public.identity_verifications for insert
  with check (public.is_org_member(organization_id));

-- RLS policies alone don't grant table-level access — Postgres checks the
-- coarser GRANT first (0009/0013/0019's own documented failure mode).
grant select, insert on
  public.identity_verifications
to authenticated, service_role;
