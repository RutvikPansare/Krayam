/**
 * Feature 12 — server-side invoice processing pipeline (the "background job").
 *
 * Runs entirely server-side and is kicked off fire-and-forget from the upload /
 * email-ingestion routes, so the UI never blocks on OCR or SAP. The invoice's
 * `status` column is advanced at every step, so the dashboard can track
 * progress in real time:
 *
 *   received → extracting → matching → (approved | review_required)
 *                       ↘ failed (extraction error, recorded)
 *                       ↘ duplicate_blocked (semantic duplicate)
 *
 * Fraud-critical ordering (per spec):
 *   1. (pre-OCR, in the route) byte-identical duplicate is blocked before any
 *      OCR cost is spent.
 *   2. OCR extraction — never returns a silent null; failures set status=failed
 *      with extraction_error.
 *   3. Bank-account-change detection + CFO alert, SYNCHRONOUSLY, before matching
 *      and regardless of match outcome.
 *   4. Semantic duplicate (invoice number + GSTIN) blocks processing.
 *   5. 3-way match (paise, configurable tolerance). Clean → auto-approved.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { extractInvoice } from "@/lib/invoice-extract";
import { checkSemanticDuplicate, dedupHash } from "@/lib/invoice-dedupe";
import { compareBank, alertCfoBankChange, type VendorBankMaster } from "@/lib/bank-detect";
import { threeWayMatch, type MatchPOItem } from "@/lib/match";
import { fetchSapGoodsReceipts } from "@/lib/sap";
import { notifyRoles } from "@/lib/notify";
import type {
  Discrepancy,
  ExtractedInvoice,
  InvoiceStatus,
  MatchTolerance,
  ThreeWayMatchResult,
} from "@/types/invoice";
import { DEFAULT_TOLERANCE } from "@/types/invoice";

const MIME_BY_NAME = (name: string): string =>
  /\.png$/i.test(name) ? "image/png"
  : /\.jpe?g$/i.test(name) ? "image/jpeg"
  : "application/pdf";

async function setStatus(invoiceId: string, status: InvoiceStatus, extra: Record<string, unknown> = {}) {
  await createAdminClient().from("invoices").update({ status, ...extra }).eq("id", invoiceId);
}

/** Max times the worker will re-attempt a stuck invoice before failing it. */
export const MAX_PROCESS_ATTEMPTS = 5;

/**
 * Stamp the start of a processing attempt: increment the counter and record the
 * time. Called first in processInvoice so a freshly-fired invoice is not seen
 * as "stuck" by the cron worker, and so a permanently-bad file is eventually
 * failed instead of looped forever. Returns the new attempt count.
 */
async function markAttempt(invoiceId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from("invoices").select("process_attempts").eq("id", invoiceId).single();
  const attempt = (data?.process_attempts ?? 0) + 1;
  await admin.from("invoices").update({ process_attempts: attempt, last_attempt_at: new Date().toISOString() }).eq("id", invoiceId);
  return attempt;
}

async function getTolerance(orgId: string): Promise<MatchTolerance> {
  const { data } = await createAdminClient()
    .from("organizations")
    .select("price_tolerance_pct, qty_tolerance_pct")
    .eq("id", orgId)
    .maybeSingle();
  return {
    price_pct: data?.price_tolerance_pct != null ? Number(data.price_tolerance_pct) : DEFAULT_TOLERANCE.price_pct,
    qty_pct: data?.qty_tolerance_pct != null ? Number(data.qty_tolerance_pct) : DEFAULT_TOLERANCE.qty_pct,
  };
}

/** Resolve the vendor master to compare bank details against, by GSTIN then name. */
async function resolveVendor(orgId: string, gstin: string | null, vendorName: string | null): Promise<VendorBankMaster> {
  const admin = createAdminClient();
  let row: any = null;
  if (gstin) {
    const { data } = await admin.from("vendors").select("id, name, gstin, bank_account_number, bank_ifsc, bank_name").eq("org_id", orgId).eq("gstin", gstin).maybeSingle();
    row = data;
  }
  if (!row && vendorName) {
    const { data } = await admin.from("vendors").select("id, name, gstin, bank_account_number, bank_ifsc, bank_name").eq("org_id", orgId).ilike("name", vendorName).maybeSingle();
    row = data;
  }
  return {
    vendor_id: row?.id ?? null,
    vendor_name: row?.name ?? vendorName,
    account_number: row?.bank_account_number ?? null,
    ifsc: row?.bank_ifsc ?? null,
    bank_name: row?.bank_name ?? null,
  };
}

/**
 * Persist the extracted fields + line items + raw payload (kept for audit even
 * if matching logic later changes).
 */
async function persistExtraction(invoiceId: string, orgId: string, ex: ExtractedInvoice, raw: unknown, provider: string) {
  const admin = createAdminClient();
  await admin.from("invoices").update({
    invoice_number: ex.invoice_number,
    invoice_date: ex.invoice_date,
    vendor_name: ex.vendor_name,
    gstin: ex.gstin,
    subtotal: ex.subtotal,
    tax_amount: ex.tax_amount,
    total_amount: ex.total_amount,
    bank_account_number: ex.bank.account_number,
    bank_ifsc: ex.bank.ifsc,
    bank_name: ex.bank.bank_name,
    dedup_hash: dedupHash(ex.invoice_number, ex.gstin),
    raw_extraction: raw as object,
    extraction_provider: provider,
    extraction_error: null,
  }).eq("id", invoiceId);

  // Replace any prior line items (re-process safe).
  await admin.from("invoice_items").delete().eq("invoice_id", invoiceId);
  if (ex.items.length) {
    await admin.from("invoice_items").insert(
      ex.items.map((it) => ({
        org_id: orgId,
        invoice_id: invoiceId,
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
      })),
    );
  }
}

/**
 * Full background processing of a freshly-received invoice. Safe to call
 * fire-and-forget (`void processInvoice(id)`); it owns its own error handling
 * and never throws to the caller.
 */
export async function processInvoice(invoiceId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    const { data: invoice } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
    if (!invoice) return;
    const orgId: string = invoice.org_id;

    // Stamp the attempt up front (claims the row from the stuck-worker window
    // and enforces the retry budget).
    const attempt = await markAttempt(invoiceId);
    if (attempt > MAX_PROCESS_ATTEMPTS) {
      await setStatus(invoiceId, "failed", { extraction_error: `Processing exceeded ${MAX_PROCESS_ATTEMPTS} attempts — needs manual review.` });
      return;
    }

    // ── 2. OCR extraction ──
    await setStatus(invoiceId, "extracting");
    const file = await admin.storage.from("invoices").download(invoice.storage_path);
    if (file.error || !file.data) {
      await setStatus(invoiceId, "failed", { extraction_error: `Could not read stored file: ${file.error?.message ?? "missing"}` });
      return;
    }
    const buffer = Buffer.from(await file.data.arrayBuffer());
    const result = await extractInvoice(buffer, MIME_BY_NAME(invoice.file_name ?? ""));

    if (!result.ok) {
      // Structured failure — recorded, never a silent null.
      await setStatus(invoiceId, "failed", { extraction_error: `[${result.reason}] ${result.message}`, raw_extraction: (result.raw ?? null) as object });
      await notifyRoles({
        orgId,
        type: "invoice_flagged",
        title: `Invoice extraction failed`,
        body: `${invoice.file_name}: ${result.message}`,
        link: `/dashboard/invoices/${invoiceId}`,
      });
      return;
    }

    const ex = result.data;
    await persistExtraction(invoiceId, orgId, ex, result.raw, result.provider);

    // ── 3. Bank-account-change detection + SYNCHRONOUS CFO alert ──
    // Runs before matching and regardless of match outcome.
    const vendor = await resolveVendor(orgId, ex.gstin, ex.vendor_name);
    const bank = compareBank(ex.bank, vendor);
    if (vendor.vendor_id) {
      await admin.from("invoices").update({ vendor_id: vendor.vendor_id }).eq("id", invoiceId);
    }
    let bankDiscrepancy: Discrepancy | null = null;
    if (bank.changed) {
      const alert = await alertCfoBankChange({
        orgId,
        invoiceId,
        invoiceNumber: ex.invoice_number,
        vendor,
        invoiceBank: ex.bank,
      });
      // The alert is durably recorded; a delivery error is logged inside the
      // helper. We continue (the spec requires alerting regardless of match),
      // carrying the discrepancy into the result.
      bankDiscrepancy = {
        type: "bank_account_changed",
        severity: "error",
        message: `Vendor bank details on this invoice differ from the master — CFO alerted${alert.error ? " (delivery error logged)" : ""}. Verify before payment.`,
        invoice_account: ex.bank.account_number,
        master_account: vendor.account_number,
      };
    }

    // ── 4. Semantic duplicate (invoice number + GSTIN) — blocks processing ──
    const dup = await checkSemanticDuplicate({
      orgId,
      invoiceNumber: ex.invoice_number,
      gstin: ex.gstin,
      vendorName: ex.vendor_name,
      totalRupees: ex.total_amount,
      ignoreInvoiceId: invoiceId,
    });
    if (dup.duplicate) {
      const dupDiscrepancy: Discrepancy = {
        type: "duplicate_invoice",
        severity: "error",
        message: `Duplicate invoice — ${dup.detail}`,
        existing_invoice_id: dup.existingInvoiceId,
      };
      const results = bankDiscrepancy ? [dupDiscrepancy, bankDiscrepancy] : [dupDiscrepancy];
      await setStatus(invoiceId, "duplicate_blocked", { match_results: results, matched_at: new Date().toISOString() });
      await notifyRoles({
        orgId,
        type: "invoice_flagged",
        title: `Duplicate invoice blocked: ${ex.invoice_number ?? ""}`.trim(),
        body: dup.detail,
        link: `/dashboard/invoices/${invoiceId}`,
      });
      return;
    }

    // ── 5. 3-way match ──
    await setStatus(invoiceId, "matching");
    const match = await runMatch(invoiceId, bankDiscrepancy ? [bankDiscrepancy] : []);

    const finalStatus: InvoiceStatus = match.status === "matched" ? "approved" : "review_required";
    await setStatus(invoiceId, finalStatus, { match_results: match.discrepancies, matched_at: new Date().toISOString() });

    if (finalStatus === "review_required") {
      await notifyRoles({
        orgId,
        type: "invoice_flagged",
        title: `Invoice ${ex.invoice_number ?? ""} flagged in 3-way match`.trim(),
        body: `${match.discrepancies.length} item(s) need review before payment.`,
        link: `/dashboard/invoices/${invoiceId}`,
      });
    }
  } catch (err) {
    console.error("[invoice-pipeline] processInvoice failed:", err, { invoiceId });
    await setStatus(invoiceId, "failed", { extraction_error: err instanceof Error ? err.message : "Pipeline error" }).catch(() => {});
  }
}

/**
 * Run only the 3-way match for an invoice (used by the pipeline and by the
 * officer's manual re-match after correcting fields). `seed` carries any
 * discrepancies found earlier in the pipeline (e.g. bank change) so the
 * persisted result is complete.
 */
export async function runMatch(invoiceId: string, seed: Discrepancy[] = []): Promise<ThreeWayMatchResult> {
  const admin = createAdminClient();
  const { data: invoice } = await admin.from("invoices").select("*, invoice_items(*)").eq("id", invoiceId).single();
  if (!invoice) return { status: "review_required", discrepancies: seed };
  const orgId: string = invoice.org_id;

  if (!invoice.po_id) {
    const noPo: Discrepancy = { type: "extraction_incomplete", severity: "error", message: "No purchase order linked — cannot run 3-way match.", field: "po_id" };
    return { status: "review_required", discrepancies: [...seed, noPo] };
  }

  const { data: po } = await admin.from("purchase_orders").select("*, po_items(*)").eq("id", invoice.po_id).single();
  if (!po) {
    const noPo: Discrepancy = { type: "extraction_incomplete", severity: "error", message: "Linked PO not found.", field: "po_id" };
    return { status: "review_required", discrepancies: [...seed, noPo] };
  }

  const poItems: MatchPOItem[] = (po.po_items ?? []).map((p: any) => ({
    id: p.id,
    item_name: p.item_name,
    material_code: p.material_code,
    quantity: Number(p.quantity),
    unit: p.unit,
    unit_price: Number(p.unit_price),
    line_total: Number(p.line_total),
  }));

  // GRN from SAP (BAPI_GOODSMVT_GETDETAIL / OData). Mock mode / no SAP receipts
  // → fall back to Krayam's own GRN records posted by the receive flow.
  const receivedQty: Record<string, number> = {};
  let hasGrn = false;
  const sap = await fetchSapGoodsReceipts({ sapPoNumber: po.sap_po_number ?? "" });
  if (sap.success && sap.lines.length > 0) {
    hasGrn = true;
    // SAP reports per PO line (10, 20, …). Map to po_items by their natural
    // order, which mirrors the (i+1)*10 numbering used when the PO was pushed.
    poItems.forEach((item, i) => {
      const line = sap.lines.find((l) => l.poLineNumber === (i + 1) * 10);
      if (line) receivedQty[item.id] = (receivedQty[item.id] ?? 0) + line.quantityReceived;
    });
  } else {
    const { data: grns } = await admin.from("grns").select("grn_items(po_item_id, quantity_received)").eq("po_id", invoice.po_id);
    for (const g of grns ?? []) {
      for (const gi of (g as any).grn_items ?? []) {
        receivedQty[gi.po_item_id] = (receivedQty[gi.po_item_id] ?? 0) + Number(gi.quantity_received);
        hasGrn = true;
      }
    }
  }

  const tolerance = await getTolerance(orgId);
  const match = threeWayMatch({
    invoiceVendor: invoice.vendor_name,
    poVendor: po.vendor_name,
    invoiceTotalRupees: invoice.total_amount != null ? Number(invoice.total_amount) : null,
    invoiceSubtotalRupees: invoice.subtotal != null ? Number(invoice.subtotal) : null,
    invoiceItems: (invoice.invoice_items ?? []).map((it: any) => ({
      description: it.description,
      quantity: it.quantity != null ? Number(it.quantity) : null,
      unit_price: it.unit_price != null ? Number(it.unit_price) : null,
      line_total: it.line_total != null ? Number(it.line_total) : null,
    })),
    poTotalRupees: Number(po.total_amount),
    poItems,
    receivedQty,
    hasGrn,
    tolerance,
  });

  const discrepancies = [...seed, ...match.discrepancies];
  const status = discrepancies.some((d) => d.severity === "error") ? "review_required" : "matched";
  return { status, discrepancies };
}
