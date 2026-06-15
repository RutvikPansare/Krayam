import { NextResponse } from "next/server";
import { getStock } from "@/lib/stock";
import { getOrgId } from "@/lib/org";
import type { StockResponse } from "@/types/materials";

export const dynamic = "force-dynamic";

/**
 * Feature 07 — lazy stock lookup for a single material.
 *
 * Fired only when the engineer hovers/clicks a dropdown result — never for all
 * results at once. Tenant-scoped. Graceful: if SAP is unreachable the stock lib
 * falls back to the mirror; if nothing is found we return a degraded response
 * with empty stock so the dropdown still works without numbers.
 */
export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code);

  let orgId: string;
  try {
    orgId = await getOrgId();
  } catch {
    return NextResponse.json(
      { material_code: code, unit: "piece", stock: {}, total: 0, source: "mirror", degraded: true } satisfies StockResponse,
      { status: 200 },
    );
  }

  try {
    const info = await getStock(code, orgId);
    if (!info) {
      return NextResponse.json(
        { material_code: code, unit: "piece", stock: {}, total: 0, source: "mirror", degraded: true } satisfies StockResponse,
        { status: 200 },
      );
    }
    return NextResponse.json({
      material_code: info.material_code,
      unit: info.unit,
      stock: info.stock,
      total: info.total,
      source: info.source,
      degraded: info.source === "mirror" && process.env.STOCK_MODE === "live",
    } satisfies StockResponse);
  } catch (err) {
    console.error("Stock lookup failed:", err);
    // Feature still works without stock numbers.
    return NextResponse.json(
      { material_code: code, unit: "piece", stock: {}, total: 0, source: "mirror", degraded: true } satisfies StockResponse,
      { status: 200 },
    );
  }
}
