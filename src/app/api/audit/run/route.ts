// POST /api/audit/run — start a new material-master deduplication audit.
// Admin-only (Managing Director / IT Administrator). Creates a versioned run,
// then drives it for up to ~50s; the worker cron resumes anything unfinished.
// GET — list this org's audit runs (versions), newest first.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamContext } from "@/lib/team";
import { MANAGER_ROLES } from "@/types/roles";
import { processAuditRun } from "@/lib/audit-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getTeamContext(user.id, user.email);
  if (!ctx.orgId) return NextResponse.json({ runs: [] });

  const admin = createAdminClient();
  const { data } = await admin
    .from("audit_runs")
    .select("id, version, status, step, materials_analyzed, confirmed_count, probable_count, review_count, duplicate_value_paise, error, started_at, finished_at")
    .eq("org_id", ctx.orgId)
    .order("version", { ascending: false });
  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getTeamContext(user.id, user.email);
  if (!MANAGER_ROLES.includes(ctx.role) || !ctx.orgId) {
    return NextResponse.json({ error: "Only the Managing Director or IT Administrator can run the audit." }, { status: 403 });
  }

  // Refuse to start a second run while one is already active for this org.
  const admin = createAdminClient();
  const { data: active } = await admin
    .from("audit_runs")
    .select("id, status, version")
    .eq("org_id", ctx.orgId)
    .not("status", "in", "(complete,failed)")
    .maybeSingle();
  if (active) {
    return NextResponse.json({ ok: true, run_id: active.id, version: active.version, status: active.status, already_running: true });
  }

  const body = await req.json().catch(() => ({}));
  const { data: version } = await admin.rpc("next_audit_version", { p_org: ctx.orgId });

  const { data: run, error } = await admin
    .from("audit_runs")
    .insert({
      org_id: ctx.orgId,
      version: version ?? 1,
      status: "queued",
      started_by: user.email,
      cfo_email: body?.cfo_email ?? null,
      heartbeat_at: new Date().toISOString(),
    })
    .select("id, version")
    .single();
  if (error || !run) return NextResponse.json({ error: error?.message ?? "Could not start audit" }, { status: 500 });

  // Drive it within the request budget; the cron worker resumes the rest.
  const status = await processAuditRun(run.id, 50_000);
  return NextResponse.json({ ok: true, run_id: run.id, version: run.version, status });
}
