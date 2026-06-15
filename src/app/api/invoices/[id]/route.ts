import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runMatch } from "@/lib/invoice-pipeline";
import { notifyRoles } from "@/lib/notify";
import { getSessionOrgId } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * Feature 12 — invoice detail, edits, 3-way match, approval.
 * GET — invoice + items + linked PO/GRN context
 * PATCH { po_id?, invoice_number?, subtotal?, total_amount?, action? }
 *   — correct extracted fields; action: "match" | "approve" | "reject"
 */

async function requireUser() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  return user;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requireUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, invoice_items(*)")
    .eq("id", params.id)
    .eq("org_id", orgId)   // tenant isolation
    .single();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  let po = null;
  let grns: any[] = [];
  if (invoice.po_id) {
    const [{ data: poRow }, { data: grnRows }] = await Promise.all([
      supabase.from("purchase_orders").select("*, po_items(*)").eq("id", invoice.po_id).single(),
      supabase.from("grns").select("*, grn_items(*)").eq("po_id", invoice.po_id),
    ]);
    po = poRow;
    grns = grnRows ?? [];
  }

  // candidate POs for linking (open/received, newest first) — same org only
  const { data: poOptions } = await supabase
    .from("purchase_orders")
    .select("id, po_number, vendor_name, total_amount, status")
    .eq("org_id", invoice.org_id)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ invoice, po, grns, po_options: poOptions ?? [] });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: invoice } = await supabase
    .from("invoices").select("*, invoice_items(*)").eq("id", params.id).eq("org_id", orgId).single();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  // field corrections
  const patch: Record<string, unknown> = {};
  for (const k of ["po_id", "invoice_number", "invoice_date", "vendor_name", "gstin", "subtotal", "tax_amount", "total_amount"]) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("invoices").update(patch).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    Object.assign(invoice, patch);
  }

  const action = body.action as string | undefined;

  if (action === "approve" || action === "reject") {
    await supabase.from("invoices").update({ status: action === "approve" ? "approved" : "rejected" }).eq("id", params.id);
    return NextResponse.json({ ok: true, status: action === "approve" ? "approved" : "rejected" });
  }

  if (action === "match") {
    if (!invoice.po_id) return NextResponse.json({ error: "Link a PO before matching." }, { status: 400 });

    // Re-run the same 3-way match the background pipeline uses (paise-based,
    // per-org tolerance, SAP GRN). Used after the officer corrects fields.
    const { status, discrepancies } = await runMatch(params.id);
    const finalStatus = status === "matched" ? "approved" : "review_required";

    await supabase
      .from("invoices")
      .update({ match_results: discrepancies, status: finalStatus, matched_at: new Date().toISOString() })
      .eq("id", params.id);

    // Finance + purchase team see discrepancies the moment matching flags them
    if (finalStatus === "review_required") {
      await notifyRoles({
        orgId: invoice.org_id,
        type: "invoice_flagged",
        title: `Invoice ${invoice.invoice_number ?? ""} flagged in 3-way match`.trim(),
        body: `${discrepancies.length} item(s) need review before payment.`,
        link: `/dashboard/invoices/${params.id}`,
      });
    }

    return NextResponse.json({ ok: true, status: finalStatus, discrepancies });
  }

  return NextResponse.json({ ok: true });
}
