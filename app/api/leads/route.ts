import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { profileRepository } from "@/lib/repositories/profile-repository";
import { leadRepository } from "@/lib/repositories/lead-repository";

/**
 * GET /api/leads — lists this organization's real, persisted leads,
 * ranked highest opportunity_score first (leadRepository.listByOrganization
 * already orders this way). Read-only; RLS (supabase/migrations/
 * 0018_lead_hunter.sql) is the real access boundary, same as every other
 * list endpoint in this app.
 */
export async function GET() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await profileRepository.findById(supabase, user.id);
  const organizationId = profile?.default_organization_id;
  if (!organizationId) {
    return NextResponse.json({ error: "No default organization found for this user." }, { status: 400 });
  }

  const leads = await leadRepository.listByOrganization(supabase, organizationId);
  return NextResponse.json({ leads });
}
