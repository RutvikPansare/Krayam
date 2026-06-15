// POST /api/cron/sync-pos — drain POs that never reached SAP.
//
// Called on a schedule by Supabase pg_cron (via pg_net) — see migration
// 0012. Retries every PO with no SAP PO number that isn't cancelled and
// hasn't exhausted its attempt budget, backfilling a missing PDF first.
// This is the durable background worker behind the manual /sync endpoint:
// a SAP outage self-heals once SAP is reachable again.
//
// Auth: Bearer CRON_SECRET. No user session — runs as the service role.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePoPdf, pushPoToSap } from "@/lib/po-pipeline";

export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 8;   // stop retrying a permanently-bad PO
const BATCH_LIMIT = 25;   // bound work per tick

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: pending } = await supabase
    .from("purchase_orders")
    .select("id, po_number, pdf_path, sap_attempts, status")
    .is("sap_po_number", null)
    .neq("status", "cancelled")
    .lt("sap_attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  const results: { po_number: string; success: boolean; error: string | null }[] = [];
  for (const po of pending ?? []) {
    try {
      if (!po.pdf_path) {
        await ensurePoPdf(supabase, po.id);
        await supabase.from("purchase_orders").update({ status: "pdf_ready" }).eq("id", po.id);
      }
      const sap = await pushPoToSap(supabase, po.id);
      results.push({ po_number: po.po_number, success: sap.success, error: sap.error ?? null });
    } catch (err) {
      results.push({ po_number: po.po_number, success: false, error: err instanceof Error ? err.message : "sync error" });
    }
  }

  const synced = results.filter((r) => r.success).length;
  return NextResponse.json({ ok: true, scanned: results.length, synced, results });
}
