-- Fix: 0009_grant_table_privileges.sql's base-table GRANTs were never
-- extended to cover `leads` (0018_lead_hunter.sql), for the same reason
-- 0009 and 0013 were needed — RLS policies alone don't grant table-level
-- access; Postgres checks the coarser GRANT first. This surfaced running a
-- live query against a local Supabase instance: "permission denied for
-- table leads" (42501) for a table that RLS-wise was already correctly
-- configured, the exact same failure mode 0009 and 0013 document.

grant select, insert, update, delete on
  public.leads
to authenticated, service_role;
