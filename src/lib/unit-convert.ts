/**
 * Feature 10 — unit normalization engine. Server-side, pure, table-driven.
 *
 * Conversions derive from each unit's size in its dimension's base unit
 * (the unit_conversions table), so adding a unit needs no code change. A price
 * quoted per `from` unit is normalized to per `to` (the RFQ's locked base unit):
 *
 *   normalized_per_to = raw_per_from × (to.to_base / from.to_base)
 *
 * Cross-dimension conversions (kg → piece) are impossible and throw. Ambiguous
 * units (BOX/SET, size unknown) are flagged for clarification, never guessed —
 * unless an explicit size (base units per pack) is supplied.
 */

export interface UnitDef {
  unit: string;
  dimension: string;
  to_base: number | null; // null ⇒ ambiguous (size configurable)
  ambiguous: boolean;
}

/** Typed error — unknown/incompatible units never silently mis-convert. */
export class UnknownConversionError extends Error {
  constructor(public from: string, public to: string, reason: string) {
    super(`Cannot convert "${from}" → "${to}": ${reason}`);
    this.name = "UnknownConversionError";
  }
}

export interface ConversionResult {
  /** normalized price (paise) per the target/base unit; null when clarification needed */
  normalizedPaise: number | null;
  /** to.to_base / from.to_base; null when clarification needed */
  factor: number | null;
  /** true when an ambiguous pack size blocked the conversion */
  needsClarification: boolean;
}

/**
 * Convert a raw price (paise, per `fromUnit`) to paise per `toUnit`.
 *
 * @param defs    unit_conversions rows (passed in ⇒ pure, unit-testable)
 * @param sizes   optional explicit pack sizes (base units per pack) for
 *                ambiguous units, e.g. { box: 50 } — resolves BOX→PC.
 */
export function convertPrice(
  rawPaise: number,
  fromUnit: string,
  toUnit: string,
  defs: UnitDef[],
  sizes: Record<string, number> = {},
): ConversionResult {
  if (fromUnit === toUnit) return { normalizedPaise: rawPaise, factor: 1, needsClarification: false };

  const byUnit = new Map(defs.map((d) => [d.unit, d]));
  const from = byUnit.get(fromUnit);
  const to = byUnit.get(toUnit);
  if (!from) throw new UnknownConversionError(fromUnit, toUnit, `unknown unit "${fromUnit}"`);
  if (!to) throw new UnknownConversionError(fromUnit, toUnit, `unknown unit "${toUnit}"`);
  if (from.dimension !== to.dimension) {
    throw new UnknownConversionError(fromUnit, toUnit, `different dimensions (${from.dimension} vs ${to.dimension})`);
  }

  // Resolve to_base, allowing an explicit size override for ambiguous packs.
  const fromBase = from.ambiguous ? sizes[fromUnit] ?? null : from.to_base;
  const toBase = to.ambiguous ? sizes[toUnit] ?? null : to.to_base;
  if (fromBase == null || toBase == null || fromBase <= 0 || toBase <= 0) {
    // Don't guess — flag for manual clarification.
    return { normalizedPaise: null, factor: null, needsClarification: true };
  }

  const factor = toBase / fromBase;
  return { normalizedPaise: Math.round(rawPaise * factor), factor, needsClarification: false };
}
