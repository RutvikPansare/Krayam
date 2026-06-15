import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSapGoodsReceipt } from "@/lib/sap";
import { notifyRoles } from "@/lib/notify";
import { getSessionOrgId } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * Feature 13 — GRN automation.
 * GET ?po_id= — PO + line items + already-received quantities (receive form context)
 * POST { po_id, received_by?, note?, items: [{ po_item_id, quantity_received }] }
 *   — creates the GRN, posts the goods receipt to SAP (movement 101, mock by
 *   default), and flips the PO to "received" once every line is fully received.
 */

export async function GET(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const poId = new URL(req.url).searchParams.get("po_id");
  if (!poId) return NextResponse.json({ error: "po_id required" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, po_number, vendor_name, status, sap_po_number, sap_mode, po_items(id, item_name, material_code, quantity, unit)")
    .eq("id", poId)
    .eq("org_id", orgId)   // tenant isolation — no cross-org PO access by id
    .single();
  if (!po) return NextResponse.json({ error: "PO not found" }, { status: 404 });

  const { data: grns } = await supabase
    .from("grns")
    .select("id, grn_number, status, sap_grn_number, sap_mode, sap_error, note, received_by, created_at, grn_items(po_item_id, quantity_received)")
    .eq("po_id", poId)
    .order("created_at");

  // qty already received per PO line, across all prior GRNs
  const received: Record<string, number> = {};
  for (const g of grns ?? []) {
    for (const gi of (g as any).grn_items ?? []) {
      received[gi.po_item_id] = (received[gi.po_item_id] ?? 0) + Number(gi.quantity_received);
    }
  }

  return NextResponse.json({ po, grns: grns ?? [], received });
}

export async function POST(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const poId: string | undefined = body?.po_id;
  const items: { po_item_id: string; quantity_received: number }[] = Array.isArray(body?.items) ? body.items : [];
  if (!poId) return NextResponse.json({ error: "po_id required" }, { status: 400 });

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, po_items(*)")
    .eq("id", poId)
    .eq("org_id", orgId)   // tenant isolation
    .single();
  if (!po) return NextResponse.json({ error: "PO not found" }, { status: 404 });
  if (po.status === "cancelled") {
    return NextResponse.json({ error: "Cannot receive goods against a cancelled PO." }, { status: 409 });
  }

  // prior receipts, to validate against over-receiving
  const { data: priorGrns } = await supabase
    .from("grns").select("grn_items(po_item_id, quantity_received)").eq("po_id", poId);
  const alreadyReceived: Record<string, number> = {};
  for (const g of priorGrns ?? []) {
    for (const gi of (g as any).grn_items ?? []) {
      alreadyReceived[gi.po_item_id] = (alreadyReceived[gi.po_item_id] ?? 0) + Number(gi.quantity_received);
    }
  }

  const poItems: any[] = po.po_items ?? [];
  const lines: { poItem: any; qty: number; lineNumber: number }[] = [];
  for (const it of items) {
    const idx = poItems.findIndex((p) => p.id === it.po_item_id);
    if (idx === -1) return NextResponse.json({ error: "Item not on this PO." }, { status: 400 });
    const qty = Number(it.quantity_received);
    if (!(qty > 0)) continue;
    const poItem = poItems[idx];
    const remaining = Number(poItem.quantity) - (alreadyReceived[poItem.id] ?? 0);
    if (qty > remaining) {
      return NextResponse.json({
        error: `${poItem.item_name}: receiving ${qty} but only ${remaining} ${poItem.unit} outstanding on the PO.`,
      }, { status: 400 });
    }
    lines.push({ poItem, qty, lineNumber: (idx + 1) * 10 });
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "Enter a received quantity for at least one line." }, { status: 400 });
  }

  const { data: grn, error: grnErr } = await supabase
    .from("grns")
    .insert({ org_id: po.org_id, po_id: poId, received_by: body?.received_by ?? null, note: body?.note ?? null })
    .select()
    .single();
  if (grnErr || !grn) return NextResponse.json({ error: grnErr?.message ?? "GRN insert failed" }, { status: 500 });

  await supabase.from("grn_items").insert(
    lines.map((l) => ({
      org_id: po.org_id,
      grn_id: grn.id,
      po_item_id: l.poItem.id,
      item_name: l.poItem.item_name,
      material_code: l.poItem.material_code,
      quantity_received: l.qty,
      unit: l.poItem.unit,
    }))
  );

  // SAP push — BAPI_GOODSMVT_CREATE equivalent, movement type 101
  const sap = await createSapGoodsReceipt({
    grnNumber: grn.grn_number,
    items: lines.map((l) => ({
      material: l.poItem.material_code || l.poItem.item_name,
      description: l.poItem.item_name,
      quantity: l.qty,
      unit: l.poItem.unit,
      sapPoNumber: po.sap_po_number,
      poLineNumber: l.lineNumber,
    })),
  });

  await supabase
    .from("grns")
    .update({
      sap_grn_number: sap.sapGrnNumber,
      sap_mode: sap.mode,
      sap_error: sap.error ?? null,
      status: sap.success ? "sap_pushed" : "failed",
    })
    .eq("id", grn.id);

  // PO becomes "received" once every line is fully received
  const fullyReceived = poItems.every((p) => {
    const got = (alreadyReceived[p.id] ?? 0) + (lines.find((l) => l.poItem.id === p.id)?.qty ?? 0);
    return got >= Number(p.quantity);
  });
  if (fullyReceived) {
    await supabase.from("purchase_orders").update({ status: "received" }).eq("id", poId);
  }

  await notifyRoles({
    orgId: po.org_id,
    type: "grn_posted",
    title: `Goods received — ${grn.grn_number} against ${po.po_number}`,
    body: `${lines.length} line${lines.length === 1 ? "" : "s"} received from ${po.vendor_name}.${sap.sapGrnNumber ? ` SAP GRN ${sap.sapGrnNumber}.` : ""}${fullyReceived ? " PO fully received." : ""}`,
    link: `/dashboard/pos`,
  });

  return NextResponse.json({
    ok: true,
    grn_number: grn.grn_number,
    sap_grn_number: sap.sapGrnNumber,
    sap_mode: sap.mode,
    sap_error: sap.error ?? null,
    po_fully_received: fullyReceived,
  });
}
