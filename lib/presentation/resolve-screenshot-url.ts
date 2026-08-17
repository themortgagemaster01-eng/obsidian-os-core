import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

const SCREENSHOT_BUCKET = "website-screenshots";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Resolves a `website_analyses.screenshot_url` storage path (private
 * bucket — see supabase/migrations/0007_website_analysis.sql) into a
 * short-lived signed URL the browser can actually load, per
 * lib/services/analysis-service.ts's note that this resolution is UI work,
 * not the analysis service's job (design doc §16 Open Question 6).
 *
 * Uses the caller's own RLS-scoped client (never falls back to a
 * service-role client here — lib/supabase/service-role.ts is documented as
 * being for the background worker only). A storage.objects RLS policy for
 * this bucket was added in 0008_screenshot_storage_policy.sql — this
 * doc comment previously (incorrectly) said no policy existed yet; correcting
 * that here rather than leaving it stale. A null return still means an
 * honest "unavailable" state (no screenshot path at all, or a real resolve
 * failure), never a broken image.
 */
export async function resolveScreenshotUrl(
  client: SupabaseClient<Database>,
  screenshotPath: string | null
): Promise<string | null> {
  if (!screenshotPath) return null;

  const { data, error } = await client.storage
    .from(SCREENSHOT_BUCKET)
    .createSignedUrl(screenshotPath, SIGNED_URL_TTL_SECONDS);

  if (error || !data) return null;
  return data.signedUrl;
}
