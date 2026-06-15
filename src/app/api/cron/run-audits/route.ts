// POST /api/cron/run-audits — background worker for audit jobs.
//
// Called frequently by pg_cron (via pg_net). Resumes every active audit run
// from its persisted step, and cleans up runs that have exceeded the hard
// wall-clock limit so nothing runs indefinitely if SAP/OpenAI hangs.
// Auth: Bearer CRON_SECRET.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processAuditRun } from "@/lib/audit-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_RUN_AGE_MS = 2 * 60 * 60 * 1000;   // 2h hard cap per run
const STALE_HEARTBEAT_MS = 10 * 60 * 1000;   // no progress for 10m ⇒ pick back up

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: active } = await admin
    .from("audit_runs")
    .select("id, status, started_at, heartbeat_at")
    .not("status", "in", "(complete,failed)")
    .order("started_at", { ascending: true })
    .limit(10);

  const now = Date.now();
  const results: { id: string; outcome: string }[] = [];

  for (const run of active ?? []) {
    // Timeout cleanup: a run older than the hard cap is abandoned, not retried.
    if (now - new Date(run.started_at).getTime() > MAX_RUN_AGE_MS) {
      await admin.from("audit_runs").update({
        status: "failed", error: "Timed out — exceeded maximum run duration", finished_at: new Date().toISOString(),
      }).eq("id", run.id);
      results.push({ id: run.id, outcome: "timed_out" });
      continue;
    }
    // Only resume runs that aren't actively progressing in another invocation.
    const hb = run.heartbeat_at ? new Date(run.heartbeat_at).getTime() : 0;
    if (now - hb < STALE_HEARTBEAT_MS && run.status !== "queued") {
      results.push({ id: run.id, outcome: "in_progress" });
      continue;
    }
    const status = await processAuditRun(run.id, 60_000);
    results.push({ id: run.id, outcome: status });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
