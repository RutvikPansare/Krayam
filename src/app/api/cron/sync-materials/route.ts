// POST /api/cron/sync-materials — nightly material master sync from SAP.
//
// Called by Supabase pg_cron (via pg_net) on a nightly schedule — see
// migration 0014. Delta-pulls changed materials per customer, upserts them,
// and generates embeddings in the background. Auth: Bearer CRON_SECRET.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncMaterials } from "@/lib/material-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // embeddings can take a while on large deltas

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: orgs } = await admin.from("organizations").select("id");

  const results = [];
  for (const o of orgs ?? []) {
    try {
      results.push(await syncMaterials(o.id));
    } catch (err) {
      results.push({ org_id: o.id, error: err instanceof Error ? err.message : "sync error" });
    }
  }

  return NextResponse.json({ ok: true, orgs: results.length, results });
}
