// POST /api/cron/process-invoices — re-pick invoices stuck mid-pipeline.
//
// The upload / email routes process invoices fire-and-forget, so a serverless
// cold-stop can abandon a run in received / extracting / matching. This worker
// (pg_cron every 2 min — see migration 0024) re-runs the pipeline for any
// invoice that is still non-terminal and was either never stamped or last
// touched > STALE_MINUTES ago, bounded by MAX_PROCESS_ATTEMPTS. processInvoice
// is idempotent (re-extracts, replaces line items, recomputes match), so a
// re-run simply finishes the job.
//
// Auth: Bearer CRON_SECRET. No user session — runs as the service role.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInvoice, MAX_PROCESS_ATTEMPTS } from "@/lib/invoice-pipeline";

export const dynamic = "force-dynamic";

const STALE_MINUTES = 10; // a healthy run finishes well within this
const BATCH_LIMIT = 20;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();

  // Stuck = non-terminal status AND (never stamped OR last attempt is stale),
  // still within the attempt budget. Two queries because PostgREST cannot OR a
  // null check with a comparison cleanly; we merge + dedupe in code.
  const baseCols = "id, process_attempts, last_attempt_at";
  const [neverStamped, stale] = await Promise.all([
    supabase.from("invoices").select(baseCols)
      .in("status", ["received", "extracting", "matching"])
      .is("last_attempt_at", null)
      .lt("process_attempts", MAX_PROCESS_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT),
    supabase.from("invoices").select(baseCols)
      .in("status", ["received", "extracting", "matching"])
      .lt("last_attempt_at", cutoff)
      .lt("process_attempts", MAX_PROCESS_ATTEMPTS)
      .order("last_attempt_at", { ascending: true })
      .limit(BATCH_LIMIT),
  ]);

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const r of [...(neverStamped.data ?? []), ...(stale.data ?? [])]) {
    if (!seen.has(r.id)) { seen.add(r.id); ids.push(r.id); }
    if (ids.length >= BATCH_LIMIT) break;
  }

  // Run sequentially — each call is bounded and updates its own status.
  const results: { id: string; ok: boolean; error: string | null }[] = [];
  for (const id of ids) {
    try {
      await processInvoice(id);
      results.push({ id, ok: true, error: null });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : "process error" });
    }
  }

  return NextResponse.json({ ok: true, scanned: ids.length, results });
}
