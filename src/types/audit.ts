/** Shared types for Feature 08 — material master deduplication audit. */

export type AuditStatus =
  | "queued" | "pulling" | "embedding" | "clustering" | "stock" | "report" | "complete" | "failed";

export type ClusterLabel = "confirmed" | "probable" | "review";
export type ReviewStatus = "pending" | "confirmed" | "rejected";

/** Similarity thresholds (cosine) per the spec. */
export const CONFIRMED_THRESHOLD = 0.92;
export const PROBABLE_THRESHOLD = 0.82;

export interface StockValue {
  material_code: string;
  /** current SAP stock quantity (sum across locations) */
  stock_qty: number;
  /** moving average price, in paise */
  unit_price_paise: number;
  /** stock_qty × unit_price_paise, in paise */
  stock_value_paise: number;
}

export interface ClusterMemberResult {
  material_code: string;
  description: string | null;
  unit: string | null;
  unit_price_paise: number;
  stock_qty: number;
  stock_value_paise: number;
  similarity_to_primary: number;
  is_primary: boolean;
}

export interface ClusterResult {
  label: ClusterLabel;
  cohesion: number;             // representative cosine similarity of the family
  primary_code: string;
  members: ClusterMemberResult[];
  duplicate_units: number;      // units held under non-primary codes
  duplicate_value_paise: number; // rupee value locked in non-primary codes
}

export interface AuditReport {
  run_id: string;
  version: number;
  status: AuditStatus;
  materials_analyzed: number;
  confirmed_count: number;
  probable_count: number;
  review_count: number;
  duplicate_value_paise: number;
  top_clusters: ClusterResult[]; // top 10 by value
}
