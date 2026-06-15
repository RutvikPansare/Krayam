// GET   /api/notifications — latest 30 for the caller + unread count
// PATCH /api/notifications — mark read ({ id } for one, { all: true } for all)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: items }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, body, link, read, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false),
  ]);

  return NextResponse.json({ notifications: items ?? [], unread: count ?? 0 });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  let q = supabase.from("notifications").update({ read: true }).eq("user_id", user.id);
  if (body.id) q = q.eq("id", body.id);
  else if (!body.all) return NextResponse.json({ error: "Pass id or all:true" }, { status: 400 });

  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
