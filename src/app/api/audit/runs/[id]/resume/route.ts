// POST /api/audit/runs/[id]/resume — resume a failed/stalled audit run from
// its last completed step. Admin-only, org-scoped.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamContext } from "@/lib/team";
import { MANAGER_ROLES } from "@/types/roles";
import { processAuditRun } from "@/lib/audit-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getTeamContext(user.id, user.email);
  if (!MANAGER_ROLES.includes(ctx.role) || !ctx.orgId) {
    return NextResponse.json({ error: "Only the Managing Director or IT Administrator can resume the audit." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: run } = await admin
    .from("audit_runs").select("id, status, step").eq("id", params.id).eq("org_id", ctx.orgId).maybeSingle();
  if (!run) return NextResponse.json({ error: "Audit run not found" }, { status: 404 });
  if (run.status === "complete") return NextResponse.json({ ok: true, status: "complete" });

  // Resume from the LAST IN-PROGRESS step, not from scratch. run.step holds
  // the step that was running when it failed; every step is idempotent
  // (clustering clears prior rows, stock recomputes, report regenerates), so
  // re-running just that step is safe. Falls back to 'queued' if unknown.
  if (run.status === "failed") {
    const valid = ["pulling", "embedding", "clustering", "stock", "report"];
    const resumeAt = run.step && valid.includes(run.step) ? run.step : "queued";
    await admin.from("audit_runs").update({ status: resumeAt, error: null }).eq("id", run.id);
  }
  const status = await processAuditRun(run.id, 50_000);
  return NextResponse.json({ ok: true, status });
}
