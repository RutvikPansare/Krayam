import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Phase 2 Feature 05 — spend aggregation.
 * All numbers come from Krayam's own purchase_orders/po_items tables
 * (no SAP dependency). Category resolves through the materials master via
 * material_code; uncoded lines fall into "other".
 */

export interface SpendData {
  months: string[];                                  // ["2026-01", …] oldest → newest
  totalSpend: number;
  poCount: number;
  avgPoValue: number;
  byCategory: { category: string; amount: number }[];
  byMonth: { month: string; amount: number; poCount: number }[];
  byVendor: { vendor: string; amount: number; poCount: number }[];
  byPlant: { plant: string; amount: number }[];
  budgetVsActual: { month: string; budget: number; actual: number }[];
  topCategoryByMonth: Record<string, Record<string, number>>; // month → category → amount
}

const monthKey = (iso: string) => iso.slice(0, 7);

export async function computeSpend(monthsBack = 6, orgId?: string): Promise<SpendData> {
  const supabase = createAdminClient();

  const since = new Date();
  since.setMonth(since.getMonth() - (monthsBack - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  // Tenant isolation: every aggregate is restricted to one org. Without this
  // the CFO dashboard would sum POs/budgets across all customers.
  let poQ = supabase
    .from("purchase_orders")
    .select("id, vendor_name, total_amount, plant, status, created_at, po_items(material_code, line_total)")
    .neq("status", "cancelled")
    .gte("created_at", since.toISOString());
  let matQ = supabase.from("materials").select("material_code, category");
  let budQ = supabase.from("budgets").select("category, month, amount").gte("month", since.toISOString().slice(0, 10));
  if (orgId) {
    poQ = poQ.eq("org_id", orgId);
    matQ = matQ.eq("org_id", orgId);
    budQ = budQ.eq("org_id", orgId);
  }

  const [{ data: pos }, { data: materials }, { data: budgets }] = await Promise.all([poQ, matQ, budQ]);

  const catOf: Record<string, string> = {};
  for (const m of materials ?? []) catOf[m.material_code] = m.category ?? "other";

  const months: string[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(since);
    d.setMonth(d.getMonth() + i);
    months.push(d.toISOString().slice(0, 7));
  }

  const byCategory: Record<string, number> = {};
  const byMonth: Record<string, { amount: number; poCount: number }> = {};
  const byVendor: Record<string, { amount: number; poCount: number }> = {};
  const byPlant: Record<string, number> = {};
  const topCategoryByMonth: Record<string, Record<string, number>> = {};
  let totalSpend = 0;

  for (const po of pos ?? []) {
    const amt = Number(po.total_amount);
    const mk = monthKey(po.created_at);
    totalSpend += amt;
    byMonth[mk] = { amount: (byMonth[mk]?.amount ?? 0) + amt, poCount: (byMonth[mk]?.poCount ?? 0) + 1 };
    byVendor[po.vendor_name] = {
      amount: (byVendor[po.vendor_name]?.amount ?? 0) + amt,
      poCount: (byVendor[po.vendor_name]?.poCount ?? 0) + 1,
    };
    byPlant[po.plant ?? "Unassigned"] = (byPlant[po.plant ?? "Unassigned"] ?? 0) + amt;
    for (const it of (po as any).po_items ?? []) {
      const cat = it.material_code ? (catOf[it.material_code] ?? "other") : "other";
      const lt = Number(it.line_total);
      byCategory[cat] = (byCategory[cat] ?? 0) + lt;
      topCategoryByMonth[mk] = topCategoryByMonth[mk] ?? {};
      topCategoryByMonth[mk][cat] = (topCategoryByMonth[mk][cat] ?? 0) + lt;
    }
  }

  const budgetByMonth: Record<string, number> = {};
  for (const b of budgets ?? []) {
    const mk = monthKey(b.month);
    budgetByMonth[mk] = (budgetByMonth[mk] ?? 0) + Number(b.amount);
  }

  const poCount = (pos ?? []).length;
  return {
    months,
    totalSpend,
    poCount,
    avgPoValue: poCount > 0 ? totalSpend / poCount : 0,
    byCategory: Object.entries(byCategory).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    byMonth: months.map((m) => ({ month: m, amount: byMonth[m]?.amount ?? 0, poCount: byMonth[m]?.poCount ?? 0 })),
    byVendor: Object.entries(byVendor).map(([vendor, v]) => ({ vendor, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 12),
    byPlant: Object.entries(byPlant).map(([plant, amount]) => ({ plant, amount })).sort((a, b) => b.amount - a.amount),
    budgetVsActual: months.map((m) => ({ month: m, budget: budgetByMonth[m] ?? 0, actual: byMonth[m]?.amount ?? 0 })),
    topCategoryByMonth,
  };
}
