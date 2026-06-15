/**
 * Feature 12 — 3-way invoice matching: shared type contracts.
 *
 * Money rule: every field whose name ends in `_paise` is an integer count of
 * paise (₹1 = 100 paise). Comparisons and tolerance maths run on these
 * integers only — float rupees never enter the matching logic (see lib/money).
 * The raw OCR result keeps vendor-stated rupee strings/numbers for audit, but
 * the moment a value is used in a decision it is converted to paise.
 */

/* ───────────────────────── OCR extraction ───────────────────────── */

export interface ExtractedBankDetails {
  account_number: string | null;
  ifsc: string | null;
  bank_name: string | null;
}

export interface ExtractedLine {
  description: string;
  quantity: number | null;
  /** Vendor-stated unit price in rupees (as read). Converted to paise downstream. */
  unit_price: number | null;
  line_total: number | null;
}

export interface ExtractedInvoice {
  invoice_number: string | null;
  invoice_date: string | null; // ISO YYYY-MM-DD
  vendor_name: string | null;
  /** Vendor's GST identification number (15 char). Half of the dedup key. */
  gstin: string | null;
  subtotal: number | null;   // taxable value, rupees
  tax_amount: number | null; // total GST, rupees
  total_amount: number | null; // grand total, rupees
  bank: ExtractedBankDetails;
  items: ExtractedLine[];
}

/** Why extraction failed. Never collapse to a silent null — callers branch on this. */
export type ExtractionErrorReason =
  | "no_api_key"          // provider not configured
  | "unsupported_media"   // not a PDF/PNG/JPG we can send to vision
  | "empty_document"      // zero-byte / corrupt file
  | "api_error"           // provider returned an error / network failure
  | "unparseable_response"; // model replied but not in the expected schema

/**
 * Discriminated result of an extraction attempt. Success carries the parsed
 * invoice plus the raw provider payload (preserved for audit even if the
 * matching logic later changes). Failure always carries a machine-readable
 * reason and a human message.
 */
export type ExtractionResult =
  | {
      ok: true;
      data: ExtractedInvoice;
      provider: string;
      model: string;
      /** Verbatim provider response, stored in invoices.raw_extraction. */
      raw: unknown;
    }
  | {
      ok: false;
      reason: ExtractionErrorReason;
      message: string;
      /** Provider payload when one exists (api_error / unparseable). */
      raw?: unknown;
    };

/* ───────────────────────── Invoice lifecycle ───────────────────────── */

/**
 * Real-time processing status. Drives the dashboard pill and gates actions.
 *   received        — file stored, queued for processing
 *   extracting      — OCR in flight
 *   matching        — 3-way match in flight
 *   review_required — discrepancies found, routed to purchase officer
 *   approved        — clean match, auto-flagged for payment
 *   rejected        — manually rejected
 *   duplicate_blocked — refused: known duplicate, never processed
 *   failed          — extraction failed; extraction_error explains why
 */
export type InvoiceStatus =
  | "received"
  | "extracting"
  | "matching"
  | "review_required"
  | "approved"
  | "rejected"
  | "duplicate_blocked"
  | "failed";

export type InvoiceSource = "upload" | "email";

/* ───────────────────────── Discrepancies ───────────────────────── */

export type DiscrepancySeverity = "error" | "warning" | "info";

/**
 * Every discrepancy category as a discriminated union on `type`. A consumer
 * `switch (d.type)` gets exhaustive, field-correct narrowing — no stray `code`
 * strings, no optional fields that only apply to some kinds.
 */
export type Discrepancy =
  | {
      type: "price_variance";
      severity: DiscrepancySeverity;
      message: string;
      po_item_id: string;
      item_name: string;
      invoice_unit_price_paise: number;
      po_unit_price_paise: number;
      variance_pct: number;
      tolerance_pct: number;
    }
  | {
      type: "quantity_variance";
      severity: DiscrepancySeverity;
      message: string;
      po_item_id: string;
      item_name: string;
      invoice_qty: number;
      received_qty: number;
      tolerance_pct: number;
    }
  | {
      type: "qty_over_po";
      severity: DiscrepancySeverity;
      message: string;
      po_item_id: string;
      item_name: string;
      invoice_qty: number;
      po_qty: number;
    }
  | {
      type: "grn_not_created";
      severity: DiscrepancySeverity;
      message: string;
    }
  | {
      type: "vendor_mismatch";
      severity: DiscrepancySeverity;
      message: string;
      invoice_vendor: string | null;
      po_vendor: string | null;
    }
  | {
      type: "line_not_on_po";
      severity: DiscrepancySeverity;
      message: string;
      description: string;
    }
  | {
      type: "total_mismatch";
      severity: DiscrepancySeverity;
      message: string;
      invoice_total_paise: number;
      po_total_paise: number;
      variance_pct: number;
      tolerance_pct: number;
    }
  | {
      type: "duplicate_invoice";
      severity: DiscrepancySeverity;
      message: string;
      existing_invoice_id: string;
    }
  | {
      type: "bank_account_changed";
      severity: DiscrepancySeverity;
      message: string;
      invoice_account: string | null;
      master_account: string | null;
    }
  | {
      type: "extraction_incomplete";
      severity: DiscrepancySeverity;
      message: string;
      field: string;
    };

export type DiscrepancyType = Discrepancy["type"];

export interface ThreeWayMatchResult {
  /** matched → eligible for auto-approval; review_required → routed to officer. */
  status: "matched" | "review_required";
  discrepancies: Discrepancy[];
}

/* ───────────────────────── Tolerance config ───────────────────────── */

/** Per-customer tolerances, resolved from organizations row (with defaults). */
export interface MatchTolerance {
  /** Price variance allowed, percent. Default 2. Inclusive. */
  price_pct: number;
  /** Quantity variance allowed, percent. Default 0. Inclusive. */
  qty_pct: number;
}

export const DEFAULT_TOLERANCE: MatchTolerance = { price_pct: 2, qty_pct: 0 };
