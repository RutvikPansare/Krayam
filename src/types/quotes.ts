/** Feature 10 — quote submission payloads (manual vs vendor portal). */

export interface QuoteLineInput {
  pr_item_id: string;
  /** raw price as quoted, in rupees (converted to paise + normalized server-side) */
  price: number;
  /** unit the vendor quoted in; normalized to the RFQ's locked base unit */
  quote_unit?: string;
  available_qty?: number | null;
  /** explicit pack size (base units) when quote_unit is BOX/SET */
  pack_size?: number | null;
}

interface QuoteBase {
  items: QuoteLineInput[];
  delivery_days?: number | null;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  validity_days?: number | null;
  notes?: string | null;
}

/** Vendor portal submission — identity proven by the signed token. */
export interface PortalQuotePayload extends QuoteBase {
  method: "portal";
  token: string;
}

/** Manual entry by an authenticated purchase officer (phone quote). */
export interface ManualQuotePayload extends QuoteBase {
  method: "manual";
  rfq_id: string;
  vendor_id?: string | null;
  vendor_name: string;
  confirm_overwrite?: boolean;
}

export type QuotePayload = PortalQuotePayload | ManualQuotePayload;

export type SubmissionMethod = "portal" | "manual";
