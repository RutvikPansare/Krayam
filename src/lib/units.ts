/**
 * Unit normalization for quote comparison.
 * Vendors quote in different units (dozen, gross, box of N, kg…).
 * All quantities normalize to a base unit so per-piece prices compare fairly.
 */

export const UNIT_OPTIONS = [
  { value: "piece",  label: "PC (piece)",      factor: 1 },
  { value: "nos",    label: "NOS (numbers)",   factor: 1 },
  { value: "pair",   label: "PAIR",            factor: 2 },
  { value: "dozen",  label: "DZ (dozen)",      factor: 12 },
  { value: "gross",  label: "GROSS (144)",     factor: 144 },
  { value: "box10",  label: "BOX of 10",       factor: 10 },
  { value: "box50",  label: "BOX of 50",       factor: 50 },
  { value: "box100", label: "BOX of 100",      factor: 100 },
  { value: "kg",     label: "KG (kilogram)",   factor: 1 },
  { value: "litre",  label: "LTR (litre)",     factor: 1 },
  { value: "metre",  label: "MTR (metre)",     factor: 1 },
  { value: "set",    label: "SET",             factor: 1 },
] as const;

export type UnitValue = (typeof UNIT_OPTIONS)[number]["value"];

export function unitFactor(unit: string): number {
  return UNIT_OPTIONS.find((u) => u.value === unit)?.factor ?? 1;
}

export function unitLabel(unit: string): string {
  return UNIT_OPTIONS.find((u) => u.value === unit)?.label ?? unit;
}

/** Price per single base unit (piece/kg/litre/metre). */
export function normalizedUnitPrice(price: number, unit: string): number {
  const f = unitFactor(unit);
  return f > 0 ? price / f : price;
}

export function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}
