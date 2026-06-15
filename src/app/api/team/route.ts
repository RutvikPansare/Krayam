// GET  /api/team — list all team members
// POST /api/team — invite a member (creates auth user + team_members row)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamContext } from "@/lib/team";
import { logAudit } from "@/lib/approvals";
import { MANAGER_ROLES, ROLE_LABELS, type TeamRole } from "@/types/roles";

export const dynamic = "force-dynamic";

const ASSIGNABLE: TeamRole[] = ["admin", "cfo", "purchase_officer", "engineer"];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Bootstraps a brand-new user into their own org as owner
  const ctx = await getTeamContext(user.id, user.email);
  if (!ctx.orgId) return NextResponse.json({ members: [], me: { role: ctx.role, memberId: ctx.memberId } });

  const admin = createAdminClient();
  // Tenant isolation: only this org's roster.
  const { data, error } = await admin
    .from("team_members")
    .select("id, user_id, email, full_name, role, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members: data ?? [], me: { role: ctx.role, memberId: ctx.memberId } });
}

interface InviteBody {
  email: string;
  full_name: string;
  role: TeamRole;
  password: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getTeamContext(user.id, user.email);
  if (!MANAGER_ROLES.includes(ctx.role)) {
    return NextResponse.json({ error: "Only the Managing Director or IT Administrator can invite members." }, { status: 403 });
  }
  if (!ctx.orgId) return NextResponse.json({ error: "No organization context for this account." }, { status: 400 });

  const body: InviteBody = await req.json();
  const { email, full_name, password } = body;

  if (!email?.trim()) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  if (!full_name?.trim()) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  if (!password?.trim() || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (!ASSIGNABLE.includes(body.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("team_members")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (existing) return NextResponse.json({ error: "This email is already a team member" }, { status: 409 });

  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name.trim(), team_role: body.role },
  });
  if (authErr || !authData.user) {
    return NextResponse.json({ error: authErr?.message ?? "Failed to create user" }, { status: 500 });
  }

  const { data: member, error: memberErr } = await admin
    .from("team_members")
    .insert({
      user_id: authData.user.id,
      org_id: ctx.orgId,                       // invited members join the inviter's org
      email: email.trim().toLowerCase(),
      full_name: full_name.trim(),
      role: body.role,
    })
    .select()
    .single();

  if (memberErr) {
    await admin.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }

  await logAudit(admin, {
    entity_type: "team_member",
    entity_id: member.id,
    action: "member_invited",
    actor: user.email,
    org_id: ctx.orgId,
    detail: {
      target_email: member.email,
      target_name: member.full_name,
      role: member.role,
      role_label: ROLE_LABELS[member.role as TeamRole]?.label ?? member.role,
    },
  });

  return NextResponse.json({ member });
}
