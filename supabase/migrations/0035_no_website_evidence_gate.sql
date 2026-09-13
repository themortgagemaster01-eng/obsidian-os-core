-- No-Website Evidence Gate + Unified Creative Pipeline (Robert's locked spec).
--
-- A confirmed no-website lead (leads.website_url IS NULL, already supported)
-- must be able to become a mission/company with no website_url of its own —
-- today missions.website_url and companies.website_url are both NOT NULL,
-- which is the sole schema-level blocker identified by the read-only audit.
-- Existing rows are untouched: every mission/company created from a real
-- website keeps writing a real, non-null website_url exactly as before —
-- this migration only removes a constraint, it never rewrites data.

alter table public.missions
  alter column website_url drop not null;

alter table public.companies
  alter column website_url drop not null;
