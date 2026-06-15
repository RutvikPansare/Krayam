// PATCH  /api/team/[id] — change a member's role (MD / IT admin only, audited)
// DELETE /api/team/[id] — remove member (+ delete their auth user, audited)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamContext, type TeamContext } from "@/lib/team";
import { logAudit } from "@/lib/approvals";
import { MANAGER_ROLES, ROLE_LABELS, type TeamRole } from "@/types/roles";
import type { User } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ASSIGNABLE: TeamRole[] = ["admin", "cfo", "purchase_officer", "engineer"];

async function authorize(): Promise<{ user: User; ctx: TeamContext } | { error: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const ctx = await getTeamContext(user.id, user.email);
  if (!MANAGER_ROLES.includes(ctx.role)) {
    return { error: NextResponse.json({ error: "Only the Managing Director or IT Administrator can manage the team." }, { status: 403 }) };
  }
  return { user, ctx };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;

  const { role: newRole } = await req.json();
  if (!ASSIGNABLE.includes(newRole)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Tenant isolation: a manager can only touch members of their own org.
  const { data: target } = await admin
    .from("team_members")
    .select("id, email, full_name, role")
    .eq("id", params.id)
    .eq("org_id", auth.ctx.orgId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (target.role === "owner") {
    return NextResponse.json({ error: "The Managing Director role cannot be changed" }, { status: 400 });
  }
  if (target.role === newRole) return NextResponse.json({ member: target });

  const { data: updated, error } = await admin
    .from("team_members")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compliance: who changed whose role, from what to what
  await logAudit(admin, {
    entity_type: "team_member",
    entity_id: target.id,
    action: "role_changed",
    actor: auth.user.email,
    org_id: auth.ctx.orgId,
    detail: {
      target_email: target.email,
      target_name: target.full_name,
      from: target.role,
      to: newRole,
      from_label: ROLE_LABELS[target.role as TeamRole]?.label ?? target.role,
      to_label: ROLE_LABELS[newRole as TeamRole]?.label ?? newRole,
    },
  });

  return NextResponse.json({ member: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  // Tenant isolation: can only remove a member of the caller's own org.
  const { data: target } = await admin
    .from("team_members")
    .select("id, email, full_name, role, user_id")
    .eq("id", params.id)
    .eq("org_id", auth.ctx.orgId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (target.role === "owner") {
    return NextResponse.json({ error: "The Managing Director cannot be removed" }, { status: 400 });
  }

  await admin.from("team_members").delete().eq("id", params.id);
  if (target.user_id) {
    await admin.auth.admin.deleteUser(target.user_id);
  }

  await logAudit(admin, {
    entity_type: "team_member",
    entity_id: target.id,
    action: "member_removed",
    actor: auth.user.email,
    org_id: auth.ctx.orgId,
    detail: {
      target_email: target.email,
      target_name: target.full_name,
      role: target.role,
      role_label: ROLE_LABELS[target.role as TeamRole]?.label ?? target.role,
    },
  });

  return NextResponse.json({ ok: true });
}
