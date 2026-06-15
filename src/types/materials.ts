/** Shared types for Feature 07 — duplicate material detection. */

export type MatchSource = "vector" | "fuzzy" | "trigram";

export interface MaterialMatch {
  material_code: string;
  description: string;
  unit: string;
  unit_price: number;
  /** 0–1 similarity. For vector matches this is cosine similarity. */
  score: number;
  /** which engine produced (or best-scored) this match */
  source: MatchSource;
  /** present only when stock has been fetched for this row (lazy, on hover/click) */
  stock?: Record<string, number>;
  total_stock?: number;
  stock_source?: "sap" | "mirror";
}

/** Response of the lazy stock lookup (GET /api/materials/[code]/stock). */
export interface StockResponse {
  material_code: string;
  unit: string;
  stock: Record<string, number>;
  total: number;
  source: "sap" | "mirror";
  /** true when SAP was unreachable and we returned mirror data (or nothing) */
  degraded: boolean;
}

/** Lightweight per-customer index row for the client-side Fuse.js layer. */
export interface MaterialIndexRow {
  material_code: string;
  description: string;
  unit: string;
  unit_price: number;
}
