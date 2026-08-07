-- Fix: 0009_grant_table_privileges.sql's base-table GRANTs were never
-- extended to cover design_briefs/website_designs (0010_design_engine.sql),
-- for the same reason 0009 itself was needed — RLS policies alone don't
-- grant table-level access; Postgres checks the coarser GRANT first. This
-- surfaced running a live smoke test against a local Supabase instance:
-- PostgREST returned "Could not find the table 'public.design_briefs' in
-- the schema cache" for a table that RLS-wise was already correctly
-- configured, the exact same failure mode 0009 documents.

grant select, insert, update, delete on
  public.design_briefs,
  public.website_designs
to authenticated, service_role;
