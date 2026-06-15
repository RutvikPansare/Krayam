// GET   /api/company — organization profile
// PATCH /api/company — update it (owner / IT admin only)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamContext } from "@/lib/team";
import { getSessionOrgId } from "@/lib/org";
import { logAudit } from "@/lib/approvals";
import { MANAGER_ROLES } from "@/types/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ company: null });

  const admin = createAdminClient();
  const { data } = await admin.from("company_settings").select("*").eq("org_id", orgId).maybeSingle();
  return NextResponse.json({ company: data ?? null });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getTeamContext(user.id, user.email);
  if (!MANAGER_ROLES.includes(ctx.role)) {
    return NextResponse.json({ error: "Only the Managing Director or IT Administrator can edit the organization profile." }, { status: 403 });
  }

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context for this account." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["company_name", "address", "gstin", "cin", "logo_url", "po_prefix", "delivery_address", "standard_terms"] as const) {
    if (key in body) patch[key] = body[key] === "" ? null : body[key];
  }
  if (typeof patch.company_name === "object" && patch.company_name === null) {
    return NextResponse.json({ error: "Company name cannot be empty" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: before } = await admin.from("company_settings").select("*").eq("org_id", orgId).maybeSingle();

  const { data, error } = await admin
    .from("company_settings")
    .upsert({ org_id: orgId, ...patch }, { onConflict: "org_id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compliance: org profile edits with old → new per field
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ["company_name", "address", "gstin", "cin", "logo_url"] as const) {
    if (key in patch && (before as any)?.[key] !== patch[key]) {
      changes[key] = { from: (before as any)?.[key] ?? null, to: patch[key] };
    }
  }
  if (Object.keys(changes).length > 0) {
    await logAudit(admin, {
      entity_type: "company_settings",
      entity_id: orgId, // the org whose profile changed
      action: "organization_updated",
      actor: user.email,
      org_id: orgId,
      detail: { changes },
    });
  }

  return NextResponse.json({ company: data });
}
