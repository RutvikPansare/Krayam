// GET /api/team/activity — governance audit trail for the team page.
// Role changes, invites, removals, profile edits and organization profile
// edits, newest first. Restricted to MD / IT admin — it exposes who did
// what to whom across the whole team.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamContext } from "@/lib/team";
import { MANAGER_ROLES } from "@/types/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getTeamContext(user.id, user.email);
  if (!MANAGER_ROLES.includes(ctx.role)) {
    return NextResponse.json({ error: "Only the Managing Director or IT Administrator can view the activity log." }, { status: 403 });
  }
  if (!ctx.orgId) return NextResponse.json({ entries: [] });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("audit_log")
    .select("id, entity_type, action, actor, detail, created_at")
    .eq("org_id", ctx.orgId)                 // tenant isolation
    .in("entity_type", ["team_member", "company_settings"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
