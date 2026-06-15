// POST /api/pos/[id]/sync — manually resume the PO saga after a failure.
//
// Re-attempts the SAP push for a PO stuck in 'sap_sync_failed' (or never
// pushed), and regenerates+stores the PDF first if it is missing. Idempotent:
// a PO already carrying a SAP PO number is returned untouched. This is the
// retry path the requirements ask for — partial completion is detectable
// (via status) and recoverable without creating a duplicate PO.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionOrgId } from "@/lib/org";
import { ensurePoPdf, pushPoToSap } from "@/lib/po-pipeline";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, po_number, status, sap_po_number, pdf_path")
    .eq("id", params.id)
    .eq("org_id", orgId)   // tenant isolation
    .maybeSingle();
  if (!po) return NextResponse.json({ error: "PO not found" }, { status: 404 });

  if (po.sap_po_number) {
    return NextResponse.json({ ok: true, idempotent: true, status: po.status, sap_po_number: po.sap_po_number });
  }

  // Backfill a missing PDF before retrying SAP (reuses stored copy if present).
  if (!po.pdf_path) {
    try {
      await ensurePoPdf(supabase, po.id);
      await supabase.from("purchase_orders").update({ status: "pdf_ready" }).eq("id", po.id);
    } catch (err) {
      console.error("Sync: PDF regeneration failed:", err);
    }
  }

  const sap = await pushPoToSap(supabase, po.id, user.email);
  return NextResponse.json({
    ok: sap.success,
    status: sap.success ? "sent_to_sap" : "sap_sync_failed",
    sap_po_number: sap.sapPoNumber,
    sap_error: sap.error ?? null,
  });
}
