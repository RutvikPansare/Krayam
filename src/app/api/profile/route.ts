// GET   /api/profile — the caller's full profile (user menu + My Profile page)
// PATCH /api/profile — update own editable fields; the team role is read-only
//                      here and only changes via /api/team/[id] (MD / IT admin)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamContext } from "@/lib/team";
import { logAudit } from "@/lib/approvals";

export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = ["full_name", "phone", "department"] as const;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Bootstraps the first user as owner / claims invited rows
  const ctx = await getTeamContext(user.id, user.email);

  const admin = createAdminClient();
  const { data: member } = ctx.memberId
    ? await admin
        .from("team_members")
        .select("id, email, full_name, phone, department, role, created_at")
        .eq("id", ctx.memberId)
        .maybeSingle()
    : { data: null };

  return NextResponse.json({
    profile: {
      member_id: ctx.memberId,
      email: user.email,
      full_name: member?.full_name ?? user.user_metadata?.full_name ?? null,
      phone: member?.phone ?? null,
      department: member?.department ?? null,
      role: ctx.role,
      member_since: member?.created_at ?? user.created_at,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getTeamContext(user.id, user.email);
  if (!ctx.memberId) {
    return NextResponse.json({ error: "No team profile found for this account." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = typeof body[field] === "string" && body[field].trim() === "" ? null : body[field];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  if ("full_name" in update && update.full_name == null) {
    return NextResponse.json({ error: "Full name cannot be empty" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("team_members")
    .select("full_name, phone, department")
    .eq("id", ctx.memberId)
    .single();

  const { data: member, error } = await admin
    .from("team_members")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", ctx.memberId)
    .select("id, email, full_name, phone, department, role, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compliance trail: which fields changed, old → new, by whom
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in update && (before as any)?.[field] !== update[field]) {
      changes[field] = { from: (before as any)?.[field] ?? null, to: update[field] };
    }
  }
  if (Object.keys(changes).length > 0) {
    await logAudit(admin, {
      entity_type: "team_member",
      entity_id: ctx.memberId,
      action: "profile_updated",
      actor: user.email,
      org_id: ctx.orgId,
      detail: { target_email: member.email, changes },
    });
  }

  return NextResponse.json({
    profile: {
      member_id: member.id,
      email: member.email,
      full_name: member.full_name,
      phone: member.phone,
      department: member.department,
      role: member.role,
      member_since: member.created_at,
    },
  });
}
