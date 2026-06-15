/**
 * Feature 12 — 3-way match: invoice vs PO vs GRN.
 *
 * All money is compared in INTEGER PAISE. Rupee floats from OCR / the DB are
 * converted once at the boundary (toPaise) and never used in a comparison
 * directly — this kills the float drift that otherwise makes a 2% tolerance
 * check non-deterministic.
 *
 * Tolerance is INCLUSIVE and configurable per customer:
 *   a 2% price tolerance on ₹10,000 passes ₹9,800–₹10,200 (both endpoints).
 *   default quantity tolerance is 0% (exact), also configurable.
 *
 * Output is a discriminated Discrepancy[]; status is "matched" only when no
 * error-severity discrepancy is present. Clean → auto-approve; otherwise →
 * review_required (routed to the purchase officer).
 */

import { toPaise } from "@/lib/money";
import type { Discrepancy, MatchTolerance, ThreeWayMatchResult } from "@/types/invoice";

export interface MatchPOItem {
  id: string;
  item_name: string;
  material_code: string | null;
  quantity: number;
  unit: string;
  unit_price: number; // rupees, from DB
  line_total: number; // rupees
}

export interface MatchInvoiceItem {
  description: string;
  quantity: number | null;
  unit_price: number | null; // rupees, from OCR
  line_total: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Loose line pairing: material-code hit, else shared-token overlap ≥ 50%. */
function findPoLine(inv: MatchInvoiceItem, poItems: MatchPOItem[]): MatchPOItem | null {
  const invNorm = norm(inv.description);
  const invTokens = new Set(invNorm.split(" ").filter((t) => t.length > 2));
  let best: MatchPOItem | null = null;
  let bestScore = 0;
  for (const po of poItems) {
    if (po.material_code && invNorm.includes(norm(po.material_code))) return po;
    const poTokens = norm(po.item_name).split(" ").filter((t) => t.length > 2);
    if (poTokens.length === 0) continue;
    const hits = poTokens.filter((t) => invTokens.has(t)).length;
    const score = hits / poTokens.length;
    if (score > bestScore) { bestScore = score; best = po; }
  }
  return bestScore >= 0.5 ? best : null;
}

const fmtRupees = (paise: number) => "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Relative variance in basis-point-precise integer math, compared inclusively
 * against a percentage tolerance.
 *   |actual − expected| / expected  ≤  tolerance_pct / 100
 * Rearranged to avoid division/float: |actual − expected| * 100 ≤ expected * tol_pct.
 * Returns { withinTolerance, pct } where pct is the variance for messaging.
 */
function withinTolerance(actualPaise: number, expectedPaise: number, tolPct: number): { ok: boolean; pct: number } {
  if (expectedPaise <= 0) return { ok: actualPaise === 0, pct: actualPaise === 0 ? 0 : 100 };
  const diff = Math.abs(actualPaise - expectedPaise);
  // inclusive: diff/expected <= tol/100  ⇔  diff*100 <= expected*tol
  const ok = diff * 100 <= expectedPaise * tolPct;
  const pct = (diff / expectedPaise) * 100;
  return { ok, pct };
}

export function threeWayMatch(opts: {
  invoiceVendor: string | null;
  poVendor: string | null;
  invoiceTotalRupees: number | null;
  invoiceSubtotalRupees: number | null;
  invoiceItems: MatchInvoiceItem[];
  poTotalRupees: number; // ex-GST PO value
  poItems: MatchPOItem[];
  /** po_item_id → quantity received across GRNs (from SAP). */
  receivedQty: Record<string, number>;
  hasGrn: boolean;
  tolerance: MatchTolerance;
}): ThreeWayMatchResult {
  const discrepancies: Discrepancy[] = [];
  const { price_pct, qty_pct } = opts.tolerance;

  // ── Vendor match (invoice vs PO) ──
  if (opts.invoiceVendor && opts.poVendor) {
    const a = norm(opts.invoiceVendor);
    const b = norm(opts.poVendor);
    const aTok = new Set(a.split(" ").filter((t) => t.length > 2));
    const bTok = b.split(" ").filter((t) => t.length > 2);
    const overlap = bTok.length ? bTok.filter((t) => aTok.has(t)).length / bTok.length : 0;
    if (a !== b && overlap < 0.5) {
      discrepancies.push({
        type: "vendor_mismatch",
        severity: "error",
        message: `Invoice vendor "${opts.invoiceVendor}" does not match PO vendor "${opts.poVendor}".`,
        invoice_vendor: opts.invoiceVendor,
        po_vendor: opts.poVendor,
      });
    }
  }

  // ── Invoice vs PO: total (compare taxable value when known; PO total is ex-GST) ──
  const comparableRupees = opts.invoiceSubtotalRupees ?? opts.invoiceTotalRupees;
  if (comparableRupees == null) {
    discrepancies.push({
      type: "extraction_incomplete",
      severity: "warning",
      message: "Could not read a total amount from the invoice — verify manually.",
      field: "total_amount",
    });
  } else {
    const invPaise = toPaise(comparableRupees);
    const poPaise = toPaise(opts.poTotalRupees);
    const { ok, pct } = withinTolerance(invPaise, poPaise, price_pct);
    if (!ok) {
      discrepancies.push({
        type: "total_mismatch",
        severity: "error",
        message: `Invoice ${opts.invoiceSubtotalRupees != null ? "taxable value" : "total"} ${fmtRupees(invPaise)} differs from PO total ${fmtRupees(poPaise)} by ${pct.toFixed(1)}% (tolerance ${price_pct}%).`,
        invoice_total_paise: invPaise,
        po_total_paise: poPaise,
        variance_pct: Number(pct.toFixed(2)),
        tolerance_pct: price_pct,
      });
    }
  }

  // ── Invoice vs GRN: received at all? ──
  if (!opts.hasGrn) {
    discrepancies.push({
      type: "grn_not_created",
      severity: "error",
      message: "No goods receipt (GRN) posted in SAP against this PO yet — do not pay before delivery is confirmed.",
    });
  }

  // ── Line-level: price + quantity ──
  for (const inv of opts.invoiceItems) {
    const po = findPoLine(inv, opts.poItems);
    if (!po) {
      discrepancies.push({
        type: "line_not_on_po",
        severity: "warning",
        message: `Invoice line "${inv.description.slice(0, 50)}" has no matching PO line.`,
        description: inv.description,
      });
      continue;
    }

    if (inv.quantity != null) {
      // Never invoiced for more than ordered.
      if (inv.quantity > Number(po.quantity)) {
        discrepancies.push({
          type: "qty_over_po",
          severity: "error",
          message: `"${po.item_name}": invoiced ${inv.quantity}, PO ordered only ${po.quantity} ${po.unit}.`,
          po_item_id: po.id,
          item_name: po.item_name,
          invoice_qty: inv.quantity,
          po_qty: Number(po.quantity),
        });
      }
      // Never invoiced for more than received (within qty tolerance, default 0%).
      if (opts.hasGrn) {
        const got = opts.receivedQty[po.id] ?? 0;
        // inclusive tolerance on received qty: invoice ≤ received * (1 + qty_pct/100)
        const allowed = got + (got * qty_pct) / 100;
        if (inv.quantity > allowed + 1e-9) {
          discrepancies.push({
            type: "quantity_variance",
            severity: "error",
            message: `"${po.item_name}": invoiced ${inv.quantity} but only ${got} ${po.unit} received per GRN (tolerance ${qty_pct}%).`,
            po_item_id: po.id,
            item_name: po.item_name,
            invoice_qty: inv.quantity,
            received_qty: got,
            tolerance_pct: qty_pct,
          });
        }
      }
    }

    if (inv.unit_price != null && Number(po.unit_price) > 0) {
      const invPaise = toPaise(inv.unit_price);
      const poPaise = toPaise(Number(po.unit_price));
      const { ok, pct } = withinTolerance(invPaise, poPaise, price_pct);
      if (!ok) {
        discrepancies.push({
          type: "price_variance",
          severity: "error",
          message: `"${po.item_name}": invoice rate ${fmtRupees(invPaise)} vs PO rate ${fmtRupees(poPaise)} (${pct.toFixed(1)}% off, tolerance ${price_pct}%).`,
          po_item_id: po.id,
          item_name: po.item_name,
          invoice_unit_price_paise: invPaise,
          po_unit_price_paise: poPaise,
          variance_pct: Number(pct.toFixed(2)),
          tolerance_pct: price_pct,
        });
      }
    }
  }

  if (opts.invoiceItems.length === 0) {
    discrepancies.push({
      type: "extraction_incomplete",
      severity: "warning",
      message: "No line items could be read from the invoice — line-level checks skipped.",
      field: "items",
    });
  }

  const status = discrepancies.some((d) => d.severity === "error") ? "review_required" : "matched";
  return { status, discrepancies };
}
