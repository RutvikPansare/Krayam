export interface PurchaseRequest {
  id: string;
  pr_number: string;
  requester_name: string;
  requester_email: string;
  department: string | null;
  plant: string | null;
  cost_center: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  needed_by: string | null;
  justification: string | null;
  status: "pending_approval" | "approved" | "rejected" | "sap_created" | "rfq_sent" | "quotes_in" | "ordered";
  approver_email: string;
  approver_note: string | null;
  approved_at: string | null;
  sap_pr_number: string | null;
  sap_mode: string | null;
  sap_error: string | null;
  created_at: string;
  pr_items?: PRItem[];
}

export interface PRItem {
  id: string;
  pr_id: string;
  item_name: string;
  material_code: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  categories: string[];
  rating: number | null;
  active: boolean;
  created_at: string;
}

export interface RFQ {
  id: string;
  rfq_number: string;
  pr_id: string;
  due_date: string | null;
  status: "draft" | "sent" | "quotes_in" | "closed";
  created_at: string;
  purchase_requests?: PurchaseRequest;
}

export type RFQVendorStatus = "sent" | "delivered" | "opened" | "quote_received" | "no_response" | "failed";

export interface RFQVendor {
  id: string;
  rfq_id: string;
  vendor_id: string;
  status: RFQVendorStatus;
  email_sent_at: string | null;
  reminded_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
}

export interface RFQLogEntry {
  id: string;
  rfq_id: string | null;
  rfq_vendor_id: string | null;
  vendor_id: string | null;
  event: string;
  provider_message_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface Quote {
  id: string;
  rfq_id: string;
  vendor_id: string | null;
  vendor_name: string;
  source: "portal" | "manual";
  submitted_by: string | null;
  delivery_days: number | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  validity_days: number | null;
  notes: string | null;
  internal_note: string | null;
  is_winner: boolean;
  submitted_at: string;
  quote_items?: QuoteItem[];
  vendors?: { rating: number | null } | null;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  pr_item_id: string;
  price: number;            // legacy rupee mirror (raw)
  quote_unit: string;
  available: boolean;
  available_qty: number | null;
  // Feature 10 — non-destructive normalization (paise)
  raw_price_paise: number | null;
  raw_unit: string | null;
  normalized_price_paise: number | null;
  normalized_unit: string | null;
  conversion_factor: number | null;
  needs_clarification: boolean;
}

export const STATUS_META: Record<PurchaseRequest["status"], { label: string; pill: string }> = {
  pending_approval: { label: "Pending approval", pill: "pill-amber" },
  approved:         { label: "Approved",         pill: "pill-green" },
  rejected:         { label: "Rejected",         pill: "pill-red" },
  sap_created:      { label: "PR in SAP",        pill: "pill-blue" },
  rfq_sent:         { label: "RFQ sent",         pill: "pill-navy" },
  quotes_in:        { label: "Quotes in",        pill: "pill-green" },
  ordered:          { label: "Ordered",          pill: "pill-navy" },
};
