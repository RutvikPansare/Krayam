/**
 * Vendor selection for RFQs — pure functions, no I/O, fully testable.
 *
 * Categories come from the material master (via each PR item's material
 * code). Matching is case-insensitive and partial in both directions, so a
 * vendor tagged "Bearings & Mechanical" matches the category "bearings" and
 * a vendor tagged "elec" matches "electrical".
 */

export interface SelectableVendor {
  id: string;
  name: string;
  email: string;
  categories: string[];
  active: boolean;
}

const norm = (s: string) => s.toLowerCase().trim();

export function categoryMatches(vendorCategory: string, itemCategory: string): boolean {
  const v = norm(vendorCategory);
  const c = norm(itemCategory);
  if (!v || !c) return false;
  return v.includes(c) || c.includes(v);
}

/**
 * Vendors whose categories overlap the items' categories.
 * No item categories at all (un-coded items) → every active vendor, since
 * there is nothing to filter on and an RFQ must still go out.
 * With categories but no matching vendor → empty list; the caller MUST
 * alert the purchase officer instead of silently sending nothing.
 */
export function selectVendors(
  vendors: SelectableVendor[],
  itemCategories: string[]
): SelectableVendor[] {
  const active = vendors.filter((v) => v.active);
  const cats = itemCategories.map(norm).filter(Boolean);
  if (cats.length === 0) return active;
  return active.filter((v) =>
    v.categories.some((vc) => cats.some((c) => categoryMatches(vc, c)))
  );
}
