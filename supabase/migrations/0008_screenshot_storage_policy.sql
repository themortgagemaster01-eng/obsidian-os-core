-- Obsidian OS — Sprint 3 Phase 3 polish.
-- Fixes design doc Open Question 6 / docs/TECH_DEBT.md item 2: the
-- `website-screenshots` bucket (0007_website_analysis.sql) was created
-- private with no storage.objects RLS policy, so every signed-URL
-- resolution (lib/presentation/resolve-screenshot-url.ts) failed
-- permission-denied and the Opportunity Report's Screenshot section always
-- rendered its "unavailable" fallback, regardless of whether a screenshot
-- was actually captured.
--
-- Screenshot objects are uploaded by the background worker (service-role
-- client, bypasses RLS entirely — see lib/services/analysis-service.ts's
-- uploadScreenshot) at path `${organizationId}/${missionId}/${analysisId}/
-- ${fileName}`. This policy only grants read access (`select`, the
-- operation createSignedUrl needs), scoped by org membership exactly like
-- every other table via `is_org_member()` (ADR-004) — no write/insert
-- policy is added since uploads never go through a user session.
-- `storage.foldername(name)` splits the object path on `/`; index 1 is the
-- organization_id segment.

create policy "Org members can read website screenshots"
  on storage.objects for select
  using (
    bucket_id = 'website-screenshots'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
