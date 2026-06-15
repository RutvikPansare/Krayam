import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgId } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * Active cost centers for the public PR form. Read-only, served through the
 * API (the form is unauthenticated, so it cannot query the table directly
 * under RLS). Scoped to the install org so one tenant's cost centers never
 * appear on another's form.
 */
export async function GET() {
  let orgId: string;
  try {
    orgId = await getOrgId();
  } catch {
    return NextResponse.json({ cost_centers: [] });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cost_centers")
    .select("code, name")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("code");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cost_centers: data ?? [] });
}
