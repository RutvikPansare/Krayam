/**
 * Feature 12 — duplicate invoice detection (fraud control).
 *
 * Two complementary checks, both BLOCKING, run at different points:
 *
 *  1. contentHash (sha256 of the raw file bytes) — checked BEFORE OCR.
 *     A vendor (or fraudster) re-sending the exact same PDF is the common case;
 *     catching it on the bytes blocks the wasted OCR/API cost the spec calls
 *     out. Cheap, runs the instant the file lands.
 *
 *  2. dedupHash (sha256 of normalized invoice_number + '|' + GSTIN) — checked
 *     AFTER OCR, once those two fields are known. This is the *semantic*
 *     duplicate: same bill number from the same vendor, even if re-typed,
 *     re-scanned or re-exported to a different-looking PDF. SHA-256 is
 *     collision-resistant (256-bit), so distinct (number, GSTIN) pairs never
 *     share a hash.
 *
 * The spec asks for the number+GSTIN hash "before OCR starts". That is
 * impossible on a fresh file — the invoice number is not known until the
 * document is read. The faithful interpretation: block on what you CAN know
 * pre-OCR (the byte-identical content hash, which prevents the wasted cost),
 * then block on the semantic hash the moment OCR yields the fields. Both are
 * enforced again at the database layer (unique index on org_id + dedup_hash)
 * so a race cannot smuggle a duplicate through.
 *
 * Money note: the historical amount comparison is done in integer paise.
 */

import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { toPaise } from "@/lib/money";

/** sha256 hex of raw file bytes. Stable, collision-resistant. */
export function contentHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Normalize an invoice number for hashing: trim, uppercase, strip spacing/punct noise. */
function normalizeInvoiceNumber(n: string): string {
  return n.toUpperCase().replace(/[\s.]/g, "").trim();
}

/**
 * sha256(normalized invoice_number + '|' + GSTIN). Returns null if either part
 * is missing — without both, there is no reliable semantic key and the row is
 * left for manual review rather than hashed on partial data.
 */
export function dedupHash(invoiceNumber: string | null, gstin: string | null): string | null {
  if (!invoiceNumber || !gstin) return null;
  const key = `${normalizeInvoiceNumber(invoiceNumber)}|${gstin.toUpperCase().trim()}`;
  return crypto.createHash("sha256").update(key).digest("hex");
}

export type DuplicateCheck =
  | { duplicate: false }
  | {
      duplicate: true;
      existingInvoiceId: string;
      reason: "content_hash" | "number_gstin" | "number_amount_vendor";
      detail: string;
    };

/**
 * Pre-OCR check: is this exact file already in the system for this org?
 * Blocks before any OCR cost is incurred.
 */
export async function checkContentDuplicate(opts: {
  orgId: string;
  contentHash: string;
  ignoreInvoiceId?: string;
}): Promise<DuplicateCheck> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select("id, invoice_number")
    .eq("org_id", opts.orgId)
    .eq("content_hash", opts.contentHash)
    .neq("status", "duplicate_blocked")
    .limit(1);
  const hit = data?.find((r) => r.id !== opts.ignoreInvoiceId);
  if (hit) {
    return {
      duplicate: true,
      existingInvoiceId: hit.id,
      reason: "content_hash",
      detail: `Identical file already received as invoice ${hit.invoice_number ?? hit.id}.`,
    };
  }
  return { duplicate: false };
}

/**
 * Post-OCR semantic check. Primary key: dedup_hash (invoice number + GSTIN).
 * Fallback for invoices missing a GSTIN: invoice number + total amount (paise)
 * + vendor name — the spec's "number and amount combination against all
 * historical invoices for that vendor".
 */
export async function checkSemanticDuplicate(opts: {
  orgId: string;
  invoiceNumber: string | null;
  gstin: string | null;
  vendorName: string | null;
  totalRupees: number | null;
  ignoreInvoiceId?: string;
}): Promise<DuplicateCheck> {
  const admin = createAdminClient();
  const hash = dedupHash(opts.invoiceNumber, opts.gstin);

  if (hash) {
    const { data } = await admin
      .from("invoices")
      .select("id, invoice_number")
      .eq("org_id", opts.orgId)
      .eq("dedup_hash", hash)
      .neq("status", "duplicate_blocked")
      .limit(2);
    const hit = data?.find((r) => r.id !== opts.ignoreInvoiceId);
    if (hit) {
      return {
        duplicate: true,
        existingInvoiceId: hit.id,
        reason: "number_gstin",
        detail: `Invoice ${opts.invoiceNumber} from GSTIN ${opts.gstin} already exists.`,
      };
    }
    return { duplicate: false };
  }

  // No GSTIN — fall back to number + amount + vendor.
  if (opts.invoiceNumber && opts.totalRupees != null && opts.vendorName) {
    const wantPaise = toPaise(opts.totalRupees);
    const { data } = await admin
      .from("invoices")
      .select("id, invoice_number, total_amount, vendor_name")
      .eq("org_id", opts.orgId)
      .eq("invoice_number", opts.invoiceNumber)
      .eq("vendor_name", opts.vendorName)
      .neq("status", "duplicate_blocked");
    const hit = (data ?? []).find(
      (r) =>
        r.id !== opts.ignoreInvoiceId &&
        r.total_amount != null &&
        toPaise(Number(r.total_amount)) === wantPaise,
    );
    if (hit) {
      return {
        duplicate: true,
        existingInvoiceId: hit.id,
        reason: "number_amount_vendor",
        detail: `Invoice ${opts.invoiceNumber} for the same amount from ${opts.vendorName} already exists.`,
      };
    }
  }

  return { duplicate: false };
}
