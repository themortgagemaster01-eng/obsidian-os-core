-- Fix: local Supabase never had base table privileges granted to `authenticated`
-- (or `anon`) for any table created since Sprint 1. Every table has correct RLS
-- policies, but RLS only filters rows an already-permitted role can see — Postgres
-- still checks the coarser table-level GRANT first, and none of 0001-0008 ever
-- issued one. This went unnoticed because prior testing ran against a hosted
-- Supabase project, where the platform's own bootstrap grants these by default;
-- it surfaced the moment the schema was first applied to a bare local instance
-- (`supabase start`), as "permission denied for table profiles" on first login.
--
-- RLS remains the actual access-control layer — these grants just let the
-- `authenticated` role attempt the operation at all, matching what the hosted
-- project already grants implicitly.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.profiles,
  public.organizations,
  public.organization_members,
  public.missions,
  public.mission_events,
  public.decisions,
  public.companies,
  public.website_analyses
to authenticated, service_role;
