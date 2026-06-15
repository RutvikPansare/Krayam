// POST /api/audit/clusters/[id]/review — admin confirms or rejects a suggested
// duplicate family. This NEVER changes SAP — it only records the human
// decision; any actual merge is a separate, explicit step. Admin-only, org-scoped.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamContext } from "@/lib/team";
import { logAudit } from "@/lib/approvals";
import { MANAGER_ROLES } from "@/types/roles";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getTeamContext(user.id, user.email);
  if (!MANAGER_ROLES.includes(ctx.role) || !ctx.orgId) {
    return NextResponse.json({ error: "Only the Managing Director or IT Administrator can review duplicates." }, { status: 403 });
  }

  const { action } = await req.json().catch(() => ({}));
  if (action !== "confirm" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'confirm' or 'reject'" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Tenant isolation: only this org's clusters.
  const { data: cluster } = await admin
    .from("audit_clusters").select("id, primary_code").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!cluster) return NextResponse.json({ error: "Cluster not found" }, { status: 404 });

  const review_status = action === "confirm" ? "confirmed" : "rejected";
  const { error } = await admin
    .from("audit_clusters")
    .update({ review_status, reviewed_by: user.email, reviewed_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("org_id", ctx.orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit(admin, {
    entity_type: "audit_cluster",
    entity_id: params.id,
    action: `duplicate_${review_status}`,
    actor: user.email,
    org_id: ctx.orgId,
    detail: { primary_code: cluster.primary_code },
  });

  return NextResponse.json({ ok: true, review_status });
}
