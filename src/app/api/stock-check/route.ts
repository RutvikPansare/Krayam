import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStock } from "@/lib/stock";
import { getSessionOrgId } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * Feature 09 — pre-PO stock check.
 * POST { items: [{ material_code, item_name, quantity }] }
 * Returns per-item warehouse stock + a suggestion (use stock / reduce qty).
 * 15-min cache inside getStock keeps repeat checks off SAP.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const items: { material_code?: string | null; item_name: string; quantity: number }[] =
    body?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "No items to check." }, { status: 400 });
  }

  const orgId = (await getSessionOrgId()) ?? undefined;

  const results = await Promise.all(
    items.map(async (it) => {
      if (!it.material_code) {
        return { ...it, found: false, suggestion: null, stock: {}, total: 0, cached: false };
      }
      const info = await getStock(it.material_code, orgId);
      if (!info || info.total <= 0) {
        return { ...it, found: !!info, suggestion: null, stock: info?.stock ?? {}, total: 0, cached: info?.cached ?? false };
      }
      const suggestion =
        info.total >= it.quantity
          ? { type: "use_stock" as const, message: `Full quantity available in stock — consider issuing from stores instead of ordering.` }
          : { type: "reduce_qty" as const, reduceTo: it.quantity - info.total, message: `${info.total} in stock — you could order only ${it.quantity - info.total} instead of ${it.quantity}.` };
      return {
        ...it,
        found: true,
        stock: info.stock,
        total: info.total,
        unit: info.unit,
        source: info.source,
        last_movement_date: info.last_movement_date,
        cached: info.cached,
        suggestion,
      };
    })
  );

  const hasWarnings = results.some((r) => (r as any).suggestion);
  return NextResponse.json({ results, hasWarnings });
}
