import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePoPdf } from "@/lib/po-pdf";
import { createSapPurchaseOrder } from "@/lib/sap";
import { getCompany } from "@/lib/company";
import { logAudit } from "@/lib/approvals";
import { format } from "date-fns";

/**
 * Feature 06 — PO saga steps, each idempotent and individually retryable.
 *
 * The PO progresses through a persisted state machine:
 *   draft → pdf_ready → vendor_notified → (sent_to_sap | sap_sync_failed)
 *
 * Every step reads the current row, does its work, and writes the next state.
 * Because state lives in the DB, a crash or SAP outage leaves the PO in a known
 * status and the manual-sync endpoint can resume from exactly there — no step
 * is repeated destructively and no duplicate side effect is produced.
 */

export type PoSagaStatus =
  | "draft" | "pdf_ready" | "vendor_notified"
  | "sent_to_sap" | "sap_sync_failed" | "cancelled";

const PO_BUCKET = "po-pdfs";
const PDF_TIMEOUT_MS = 10_000;

/** pdf-lib shouldn't hang, but a corrupt font/buffer must not wedge the
 *  request — generation races a timeout. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

interface PoRow {
  id: string;
  org_id: string;
  po_number: string;
  vendor_name: string;
  payment_terms: string | null;
  delivery_days: number | null;
  sap_po_number: string | null;
  total_paise: number | null;
  total_amount: number | null;
  pdf_path: string | null;
  created_at: string;
  po_items?: PoItemRow[];
  rfqs?: { rfq_number: string } | null;
  purchase_requests?: { pr_number: string; needed_by: string | null } | null;
  vendors?: { address: string | null } | null;
}

interface PoItemRow {
  item_name: string;
  material_code: string | null;
  quantity: number;
  unit: string;
  unit_price_paise: number | null;
  line_total_paise: number | null;
  unit_price: number | null;
  line_total: number | null;
}

async function loadPo(supabase: SupabaseClient, poId: string): Promise<PoRow | null> {
  const { data } = await supabase
    .from("purchase_orders")
    .select("*, po_items(*), rfqs(rfq_number), purchase_requests(pr_number, needed_by), vendors(address)")
    .eq("id", poId)
    .single();
  return (data as PoRow) ?? null;
}

/**
 * Step: generate the PO PDF and store it in Supabase Storage. Idempotent —
 * if the PDF already exists it is downloaded and returned rather than
 * regenerated. Returns the PDF bytes (for emailing) and the stored URL.
 */
export async function ensurePoPdf(
  supabase: SupabaseClient,
  poId: string,
): Promise<{ buffer: Buffer; pdfUrl: string | null }> {
  const po = await loadPo(supabase, poId);
  if (!po) throw new Error("PO not found");

  // Already generated — reuse, never regenerate on re-send.
  if (po.pdf_path) {
    const { data: blob } = await supabase.storage.from(PO_BUCKET).download(po.pdf_path);
    if (blob) {
      const { data: signed } = await supabase.storage.from(PO_BUCKET).createSignedUrl(po.pdf_path, 60 * 60 * 24 * 365);
      return { buffer: Buffer.from(await blob.arrayBuffer()), pdfUrl: signed?.signedUrl ?? po.pdf_path };
    }
  }

  const company = await getCompany(po.org_id);
  const items = (po.po_items ?? []).map((it) => ({
    item_name: it.item_name,
    material_code: it.material_code,
    quantity: Number(it.quantity),
    unit: it.unit,
    unit_price_paise: Number(it.unit_price_paise ?? Math.round(Number(it.unit_price ?? 0) * 100)),
    line_total_paise: Number(it.line_total_paise ?? Math.round(Number(it.line_total ?? 0) * 100)),
  }));
  const totalPaise = Number(po.total_paise ?? Math.round(Number(po.total_amount ?? 0) * 100));

  const pdfBytes = await withTimeout(
    generatePoPdf({
      poNumber: po.po_number,
      poDate: format(new Date(po.created_at), "d MMM yyyy"),
      companyName: company.company_name,
      companyAddress: [
        company.address || "Plot 14, MIDC Industrial Area\nPune, Maharashtra 411019",
        company.gstin ? `GSTIN: ${company.gstin}` : null,
      ].filter(Boolean).join("\n"),
      vendorName: po.vendor_name,
      vendorAddress: po.vendors?.address ?? null,
      deliveryAddress: company.delivery_address ?? company.address ?? null,
      deliveryDate: po.purchase_requests?.needed_by
        ? format(new Date(po.purchase_requests.needed_by), "d MMM yyyy")
        : null,
      prNumber: po.purchase_requests?.pr_number ?? null,
      rfqNumber: po.rfqs?.rfq_number ?? null,
      paymentTerms: po.payment_terms,
      deliveryDays: po.delivery_days,
      sapPoNumber: po.sap_po_number,
      standardTerms: company.standard_terms,
      items,
      totalPaise,
    }),
    PDF_TIMEOUT_MS,
    "PO PDF generation",
  );

  const buffer = Buffer.from(pdfBytes);
  const path = `${po.po_number}.pdf`;
  const { error: upErr } = await supabase.storage
    .from(PO_BUCKET)
    .upload(path, buffer, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`PO PDF upload failed: ${upErr.message}`);

  const { data: signed } = await supabase.storage.from(PO_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  await supabase
    .from("purchase_orders")
    .update({ pdf_path: path, pdf_url: signed?.signedUrl ?? null, pdf_generated_at: new Date().toISOString() })
    .eq("id", poId);

  return { buffer, pdfUrl: signed?.signedUrl ?? null };
}

/**
 * Step: push the PO to SAP and record the outcome. Retryable — call again
 * after a failure and it re-attempts, bumping sap_attempts and overwriting
 * the previous error. Full SAP response body is persisted in sap_raw for
 * diagnosis, not just the HTTP status.
 */
export async function pushPoToSap(
  supabase: SupabaseClient,
  poId: string,
  actor?: string | null,
): Promise<{ success: boolean; sapPoNumber: string | null; mode: "mock" | "live"; error?: string }> {
  const po = await loadPo(supabase, poId);
  if (!po) throw new Error("PO not found");

  // Already synced — don't double-push.
  if (po.sap_po_number) {
    return { success: true, sapPoNumber: po.sap_po_number, mode: ((po as any).sap_mode as "mock" | "live") ?? "mock" };
  }

  const sap = await createSapPurchaseOrder({
    poNumber: po.po_number,
    vendorName: po.vendor_name,
    items: (po.po_items ?? []).map((l) => ({
      material: l.material_code || l.item_name,
      description: l.item_name,
      quantity: Number(l.quantity),
      unit: l.unit,
      netPrice: Number(l.unit_price_paise ?? 0) / 100, // SAP expects rupees; paise is our store of record
    })),
  });

  await supabase
    .from("purchase_orders")
    .update({
      sap_po_number: sap.sapPoNumber,
      sap_mode: sap.mode,
      sap_error: sap.error ?? null,
      sap_raw: (sap.raw ?? (sap.error ? { error: sap.error } : null)) as Record<string, unknown> | null,
      sap_synced_at: sap.success ? new Date().toISOString() : null,
      sap_attempts: (po as any).sap_attempts != null ? (po as any).sap_attempts + 1 : 1,
      status: sap.success ? "sent_to_sap" : "sap_sync_failed",
    })
    .eq("id", poId);

  await logAudit(supabase, {
    entity_type: "purchase_order",
    entity_id: poId,
    action: sap.success ? "sap_synced" : "sap_sync_failed",
    actor: actor ?? "system",
    org_id: po.org_id,
    detail: {
      po_number: po.po_number,
      sap_po_number: sap.sapPoNumber,
      sap_mode: sap.mode,
      error: sap.error ?? null,
    },
  });

  return { success: sap.success, sapPoNumber: sap.sapPoNumber, mode: sap.mode, error: sap.error };
}
