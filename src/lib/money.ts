/**
 * Money is held as integer **paise** everywhere it is calculated, stored or
 * compared. Rupees (a float) appear only at two boundaries: vendor-entered
 * input coming in, and display formatting going out. This eliminates the
 * floating-point drift that silently corrupts totals when you add, multiply
 * and divide rupee floats (0.1 + 0.2 !== 0.3).
 *
 * Rule: rupees in → paise immediately; all arithmetic in paise; paise → rupees
 * only inside formatPaise() for display.
 */

/** Rupees (possibly fractional, vendor input) → integer paise. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Integer paise → rupees number (display/PDF only — never feed back into math). */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/**
 * Normalize a quoted price to the per-base-unit price, in paise.
 * Vendors quote per dozen/gross/box; dividing by the pack factor can produce
 * fractional paise, so we round to the nearest whole paisa here — once — and
 * everything downstream stays integer.
 */
export function normalizedUnitPricePaise(quotedRupees: number, factor: number): number {
  const quotedPaise = toPaise(quotedRupees);
  return factor > 0 ? Math.round(quotedPaise / factor) : quotedPaise;
}

/**
 * Line total in paise = unit price (paise) × quantity. Quantity may be
 * fractional (e.g. 2.5 kg), so the product is rounded back to whole paise.
 * unit_price_paise is an exact integer, so for integer quantities this is
 * exact; for fractional quantities the single round here is the only rounding.
 */
export function lineTotalPaise(unitPricePaise: number, quantity: number): number {
  return Math.round(unitPricePaise * quantity);
}

/** Exact integer sum — no float accumulation. */
export function sumPaise(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/** Integer paise → "Rs. 1,23,456.78" (Indian grouping). pdf-lib has no ₹ glyph. */
export function formatPaise(paise: number, withSymbol = true): string {
  const rupees = paiseToRupees(paise);
  const body = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rupees);
  return withSymbol ? `Rs. ${body}` : body;
}
