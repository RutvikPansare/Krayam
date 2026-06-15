/** Shared types for Feature 09 — stock check & savings log. */

/** Fixed override reasons (enum, not free text) for meaningful analytics. */
export const OVERRIDE_REASONS = [
  { value: "urgent_requirement",    label: "Urgent — can't wait for stores issue" },
  { value: "quality_reserved",      label: "Stock reserved / quality-held" },
  { value: "wrong_location",        label: "Stock at a non-servicing location" },
  { value: "committed_elsewhere",   label: "Already committed to another order" },
  { value: "stock_data_unreliable", label: "Stock figure looks unreliable" },
  { value: "other",                 label: "Other" },
] as const;

export type OverrideReason = (typeof OVERRIDE_REASONS)[number]["value"];
export const OVERRIDE_REASON_VALUES = OVERRIDE_REASONS.map((r) => r.value) as readonly OverrideReason[];

export type StockSuggestion =
  | { type: "use_stock"; message: string }
  | { type: "reduce_qty"; reduceTo: number; message: string }
  | null;

/** Per-item stock check result returned to the PO page. */
export interface StockCheckResult {
  pr_item_id?: string;
  material_code: string | null;
  item_name: string;
  quantity: number;
  found: boolean;
  total: number;
  unit?: string;
  stock: Record<string, number>;
  last_movement_date?: string | null;
  source?: "mirror" | "sap";
  cached: boolean;
  suggestion: StockSuggestion;
}

export type SavingsAction = "accepted" | "overridden";

export interface SavingsLogEntry {
  id: string;
  org_id: string;
  po_id: string | null;
  material_code: string | null;
  item_name: string | null;
  po_value_paise: number;
  stock_qty_found: number;
  action: SavingsAction;
  estimated_saving_paise: number;
  override_reason: OverrideReason | null;
  officer: string | null;
  created_at: string;
}

/** Aggregated monthly figures for the CFO email. */
export interface CfoSavingsReport {
  org_id: string;
  period_start: string;
  period_end: string;
  intercepts: number;
  accepted_count: number;
  overridden_count: number;
  total_saved_paise: number;     // from accepted intercepts
  total_at_risk_paise: number;   // from overrides
}
