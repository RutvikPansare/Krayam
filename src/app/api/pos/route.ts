import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { unitFactor } from "@/lib/units";
import { normalizedUnitPricePaise, lineTotalPaise, sumPaise, formatPaise } from "@/lib/money";
import { getStock } from "@/lib/stock";
import { OVERRIDE_REASON_VALUES, type SavingsAction } from "@/types/savings";
import { ensurePoPdf, pushPoToSap } from "@/lib/po-pipeline";
import { sendEmail, sendEmailBatch } from "@/lib/email";
import { notifyRoles } from "@/lib/notify";
import { logAudit } from "@/lib/approvals";
import { getCompany } from "@/lib/company";

export const dynamic = "force-dynamic";

/**
 * Feature 06 — generate a PO from the winning vendor quote, then run the
 * fulfilment saga: store PDF → notify vendors → push to SAP.
 *
 * POST { quote_id, quantity_overrides?, stock_note? }
 *
 * The client never sends money — only quote_id and (optionally) reduced
 * quantities from the stock check. All prices, line totals and the grand
 * total are computed server-side in integer paise from the stored quote.
 *
 * Idempotent: a unique index on purchase_orders.quote_id means selecting the
 * same winner twice returns the first PO instead of creating a second.
 *
 * Crash-safe: PDF storage and vendor email happen before the SAP push, so a
 * SAP outage never blocks the vendor from receiving the order — the PO simply
 * lands in 'sap_sync_failed' and can be retried via POST /api/pos/[id]/sync.
 */
export async function POST(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const quoteId: string | undefined = body?.quote_id;
  if (!quoteId) return NextResponse.json({ error: "quote_id required" }, { status: 400 });
  const overrides: Record<string, number> = body?.quantity_overrides ?? {};

  const supabase = createAdminClient();

  // ── Idempotency: a PO already exists for this quote → return it ──
  const { data: existingPo } = await supabase
    .from("purchase_orders")
    .select("id, po_number, sap_po_number, sap_mode, total_paise, pdf_url, status")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (existingPo) {
    return NextResponse.json({
      ok: true,
      idempotent: true,
      po_id: existingPo.id,
      po_number: existingPo.po_number,
      sap_po_number: existingPo.sap_po_number,
      sap_mode: existingPo.sap_mode,
      total: (existingPo.total_paise ?? 0) / 100,
      pdf_url: existingPo.pdf_url,
      status: existingPo.status,
    });
  }

  const { data: quote } = await supabase
    .from("quotes")
    .select("*, quote_items(*), rfqs(id, org_id, rfq_number, pr_id, purchase_requests(id, org_id, pr_number, plant))")
    .eq("id", quoteId)
    .single();
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const rfq = (quote as any).rfqs;
  const pr = rfq?.purchase_requests;
  const orgId: string = pr?.org_id ?? rfq?.org_id ?? (quote as any).org_id;
  const { data: prItems } = await supabase
    .from("pr_items")
    .select("*")
    .eq("pr_id", rfq.pr_id)
    .order("created_at");

  // ── Build PO lines from quoted items, all money in integer paise ──
  const lines: {
    item_name: string; material_code: string | null; quantity: number; unit: string;
    unit_price_paise: number; line_total_paise: number;
  }[] = [];
  for (const it of prItems ?? []) {
    const qi = (quote.quote_items ?? []).find((x: any) => x.pr_item_id === it.id && x.available);
    if (!qi) continue;
    const qty = overrides[it.id] != null ? Number(overrides[it.id]) : Number(it.quantity);
    if (qty <= 0) continue; // fully covered by existing stock
    // Prefer the normalized price stored at quote time (Feature 10, table-driven,
    // handles kg↔gm etc); fall back to the legacy pack-factor for old quotes.
    const unitPricePaise = qi.normalized_price_paise != null
      ? Number(qi.normalized_price_paise)
      : normalizedUnitPricePaise(Number(qi.price), unitFactor(qi.quote_unit));
    lines.push({
      item_name: it.item_name,
      material_code: it.material_code,
      quantity: qty,
      unit: it.unit,
      unit_price_paise: unitPricePaise,
      line_total_paise: lineTotalPaise(unitPricePaise, qty),
    });
  }
  // ── Feature 09 — savings intercepts, computed SERVER-SIDE in paise from
  //    authoritative (cached, timeout-safe) stock. Reductions = saved;
  //    full orders despite stock = overridden/at-risk and require a reason.
  //    Computed BEFORE the empty-order check so a fully-cancelled order
  //    (everything covered by stock — the biggest saving) is still logged. ──
  const overrideReason: string | null = body?.override_reason ?? null;
  const intercepts: {
    material_code: string | null; item_name: string; po_value_paise: number;
    stock_qty: number; action: SavingsAction; saving_paise: number;
  }[] = [];
  for (const it of prItems ?? []) {
    const qi = (quote.quote_items ?? []).find((x: any) => x.pr_item_id === it.id && x.available);
    if (!qi || !it.material_code) continue;
    const origQty = Number(it.quantity);
    const orderedQty = overrides[it.id] != null ? Number(overrides[it.id]) : origQty;
    const info = await getStock(it.material_code, orgId); // never throws; null if SAP down
    const stockQty = info?.total ?? 0;
    if (stockQty <= 0) continue; // no stock ⇒ no interception
    const unitPricePaise = qi.normalized_price_paise != null
      ? Number(qi.normalized_price_paise)
      : normalizedUnitPricePaise(Number(qi.price), unitFactor(qi.quote_unit));
    const reduced = Math.max(0, origQty - orderedQty);
    if (reduced > 0) {
      intercepts.push({ material_code: it.material_code, item_name: it.item_name,
        po_value_paise: lineTotalPaise(unitPricePaise, orderedQty), stock_qty: stockQty,
        action: "accepted", saving_paise: lineTotalPaise(unitPricePaise, Math.min(reduced, stockQty)) });
    } else if (orderedQty > 0) {
      intercepts.push({ material_code: it.material_code, item_name: it.item_name,
        po_value_paise: lineTotalPaise(unitPricePaise, orderedQty), stock_qty: stockQty,
        action: "overridden", saving_paise: lineTotalPaise(unitPricePaise, Math.min(stockQty, orderedQty)) });
    }
  }
  const hasOverride = intercepts.some((x) => x.action === "overridden");
  if (hasOverride && !OVERRIDE_REASON_VALUES.includes(overrideReason as any)) {
    return NextResponse.json({ error: "Select a reason to order despite available stock.", needs_override_reason: true }, { status: 400 });
  }

  // Nothing to order — every line covered by stock. No PO, but DO record the
  // avoided spend (append-only) so the CFO digest captures full cancellations.
  if (lines.length === 0) {
    if (intercepts.length > 0) {
      const saved = intercepts.reduce((s, x) => s + (x.action === "accepted" ? x.saving_paise : 0), 0);
      // Idempotent: the unique index on (quote_id) where po_id is null makes a
      // double-submit a no-op instead of double-counting the saving.
      await supabase.from("savings_log").insert(
        intercepts.map((x) => ({
          org_id: orgId, po_id: null, quote_id: quote.id, material_code: x.material_code, item_name: x.item_name,
          po_value_paise: x.po_value_paise, stock_qty_found: x.stock_qty, action: x.action,
          estimated_saving_paise: x.saving_paise,
          override_reason: x.action === "overridden" ? overrideReason : null, officer: user.email,
        })),
      ); // unique-violation on resubmit is swallowed (best-effort log)
      return NextResponse.json({ ok: true, cancelled: true, no_po: true, saved: saved / 100,
        message: "Order cancelled — every line is covered by existing stock. Routed to stores." });
    }
    return NextResponse.json({ error: "Nothing to order — every line is unquoted or covered by stock." }, { status: 400 });
  }
  const totalPaise = sumPaise(lines.map((l) => l.line_total_paise));

  // ── Create the PO (status 'draft'). PO number follows the customer's
  //    configured prefix; the unique index on quote_id enforces idempotency
  //    even under a concurrent double-click (caught below). ──
  const company = await getCompany(orgId);
  let poNumber: string | undefined;
  const { data: numData } = await supabase.rpc("next_po_number", { p_prefix: company.po_prefix });
  if (typeof numData === "string") poNumber = numData;

  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .insert({
      ...(poNumber ? { po_number: poNumber } : {}),
      org_id: orgId,
      pr_id: rfq.pr_id,
      rfq_id: rfq.id,
      quote_id: quote.id,
      vendor_id: quote.vendor_id,
      vendor_name: quote.vendor_name,
      plant: pr?.plant ?? null,
      total_paise: totalPaise,
      total_amount: totalPaise / 100, // rupee mirror, display only
      payment_terms: quote.payment_terms,
      delivery_days: quote.delivery_days,
      stock_note: body?.stock_note ?? null,
      status: "draft",
    })
    .select()
    .single();

  if (poErr) {
    // 23505 = unique_violation on quote_id: a concurrent request won the race.
    if ((poErr as any).code === "23505") {
      const { data: raced } = await supabase
        .from("purchase_orders")
        .select("id, po_number, sap_po_number, sap_mode, total_paise, pdf_url, status")
        .eq("quote_id", quoteId)
        .maybeSingle();
      if (raced) {
        return NextResponse.json({ ok: true, idempotent: true, po_id: raced.id, po_number: raced.po_number, sap_po_number: raced.sap_po_number, sap_mode: raced.sap_mode, total: (raced.total_paise ?? 0) / 100, pdf_url: raced.pdf_url, status: raced.status });
      }
    }
    return NextResponse.json({ error: poErr.message ?? "PO insert failed" }, { status: 500 });
  }

  await supabase.from("po_items").insert(
    lines.map((l) => ({
      org_id: orgId,
      po_id: po.id,
      item_name: l.item_name,
      material_code: l.material_code,
      quantity: l.quantity,
      unit: l.unit,
      unit_price_paise: l.unit_price_paise,
      line_total_paise: l.line_total_paise,
      unit_price: l.unit_price_paise / 100, // rupee mirrors, display only
      line_total: l.line_total_paise / 100,
    }))
  );

  // Append-only savings log — one row per intercepted line (never updated/deleted).
  if (intercepts.length > 0) {
    await supabase.from("savings_log").insert(
      intercepts.map((x) => ({
        org_id: orgId,
        po_id: po.id,
        quote_id: quote.id,
        material_code: x.material_code,
        item_name: x.item_name,
        po_value_paise: x.po_value_paise,
        stock_qty_found: x.stock_qty,
        action: x.action,
        estimated_saving_paise: x.saving_paise,
        override_reason: x.action === "overridden" ? overrideReason : null,
        officer: user.email,
      }))
    );
  }

  await logAudit(supabase, {
    entity_type: "purchase_order",
    entity_id: po.id,
    action: "po_created",
    actor: user.email,
    org_id: orgId,
    detail: { po_number: po.po_number, quote_id: quote.id, vendor: quote.vendor_name, total_paise: totalPaise },
  });

  // ── Saga step 1: PDF generated + stored (status 'pdf_ready') ──
  let pdfBuffer: Buffer | null = null;
  let pdfUrl: string | null = null;
  try {
    const r = await ensurePoPdf(supabase, po.id);
    pdfBuffer = r.buffer;
    pdfUrl = r.pdfUrl;
    await supabase.from("purchase_orders").update({ status: "pdf_ready" }).eq("id", po.id);
  } catch (err) {
    console.error("PO PDF generation/storage failed:", err);
    // PO stays 'draft' — sync endpoint can regenerate. Don't abort the order.
  }

  // ── Saga step 2: notify vendors (winner + rejections) BEFORE SAP, so a
  //    SAP outage cannot stop the vendor from receiving the order. ──
  await notifyVendors(supabase, {
    rfqId: rfq.id,
    rfqNumber: rfq.rfq_number,
    poNumber: po.po_number,
    winnerVendorId: quote.vendor_id,
    totalPaise,
    pdfBuffer,
    companyName: company.company_name,
  });
  await supabase
    .from("purchase_orders")
    .update({ status: "vendor_notified", vendor_notified_at: new Date().toISOString() })
    .eq("id", po.id);

  // Close out the request + RFQ; mark the winner.
  await supabase.from("quotes").update({ is_winner: true }).eq("id", quote.id);
  await supabase.from("purchase_requests").update({ status: "ordered" }).eq("id", rfq.pr_id);
  await supabase.from("rfqs").update({ status: "closed" }).eq("id", rfq.id);

  // ── Saga step 3: SAP push — terminal state, never undoes the above ──
  const sap = await pushPoToSap(supabase, po.id, user.email);

  await notifyRoles({
    orgId,
    type: "po_created",
    title: `PO ${po.po_number} raised — ${formatPaise(totalPaise)}`,
    body: `Order placed with ${quote.vendor_name} against ${rfq.rfq_number}.${sap.sapPoNumber ? ` SAP PO ${sap.sapPoNumber}.` : sap.success ? "" : " SAP sync failed — retry from the PO page."}`,
    link: `/dashboard/pos`,
  });

  return NextResponse.json({
    ok: true,
    po_id: po.id,
    po_number: po.po_number,
    sap_po_number: sap.sapPoNumber,
    sap_mode: sap.mode,
    sap_success: sap.success,
    sap_error: sap.error ?? null,
    status: sap.success ? "sent_to_sap" : "sap_sync_failed",
    total: totalPaise / 100,
    pdf_url: pdfUrl,
    pr_number: pr?.pr_number ?? null,
  });
}

/**
 * Winner gets a confirmation with the PO PDF attached (individual send —
 * Resend's batch endpoint rejects attachments). Every losing vendor gets a
 * polite decline in a SINGLE batched Resend call. Email failures are logged,
 * never block the PO.
 */
async function notifyVendors(
  supabase: ReturnType<typeof createAdminClient>,
  opts: {
    rfqId: string; rfqNumber: string; poNumber: string;
    winnerVendorId: string | null; totalPaise: number;
    pdfBuffer: Buffer | null; companyName: string;
  },
) {
  try {
    const { data: rfqVendors } = await supabase
      .from("rfq_vendors")
      .select("vendor_id, vendors(name, email)")
      .eq("rfq_id", opts.rfqId);

    const wrap = (title: string, body: string) =>
      `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="color:#0B2239;margin:0 0 8px;">${title}</h2>
        <p style="color:#5B6470;font-size:14px;line-height:1.6;">${body}</p>
        <p style="color:#8A929D;font-size:12px;margin-top:18px;">${opts.companyName} · sent via Krayam</p>
      </div>`;

    const winner = (rfqVendors ?? []).find((rv: any) => rv.vendor_id === opts.winnerVendorId);
    const losers = (rfqVendors ?? []).filter((rv: any) => rv.vendor_id !== opts.winnerVendorId && (rv as any).vendors?.email);

    // Winner — individual (attachment).
    const winnerEmail = (winner as any)?.vendors?.email;
    if (winnerEmail) {
      try {
        await sendEmail({
          to: winnerEmail,
          subject: `[${opts.companyName}] Order confirmed — PO ${opts.poNumber} against ${opts.rfqNumber}`,
          html: wrap(
            "Your quote has been selected",
            `Congratulations — your quote for ${opts.rfqNumber} was selected. Purchase order <b>${opts.poNumber}</b> (total ${formatPaise(opts.totalPaise)}) has been raised and is attached as a PDF.`,
          ),
          attachments: opts.pdfBuffer ? [{ filename: `${opts.poNumber}.pdf`, content: opts.pdfBuffer }] : undefined,
        });
      } catch (err) {
        console.error(`Winner email to ${winnerEmail} failed:`, err);
      }
    }

    // Rejections — ONE batched Resend call.
    if (losers.length > 0) {
      const results = await sendEmailBatch(
        losers.map((rv: any) => ({
          to: rv.vendors.email,
          subject: `[${opts.companyName}] ${opts.rfqNumber} — quotation update`,
          html: wrap(
            "Thank you for your quotation",
            `Thank you for quoting against ${opts.rfqNumber}. On this occasion the order has been placed with another supplier. We value your participation and look forward to your quotes on future enquiries.`,
          ),
        })),
      );
      for (const r of results) {
        if (r.error) console.error(`Rejection email to ${r.to} failed:`, r.error);
      }
    }
  } catch (err) {
    console.error("Post-PO vendor notification failed:", err);
  }
}
