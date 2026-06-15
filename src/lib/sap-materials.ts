/**
 * SAP material master fetch for the nightly sync (Feature 07).
 *
 * SAP_MODE=mock (default): returns the locally-seeded materials as if they
 *   were just pulled from SAP, so the sync pipeline (upsert, embed, cursor)
 *   runs end-to-end without an SAP connection.
 * SAP_MODE=live: queries API_PRODUCT_SRV / API_MATERIAL_SRV with a
 *   $filter on LastChangeDate so only materials changed since the last sync
 *   are pulled — never a full nightly dump.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface SapMaterial {
  material_code: string;
  description: string;
  unit: string;
  unit_price: number;
  stock: Record<string, number>;
  category: string | null;
  sap_changed_at: string; // ISO
}

/** Pull materials changed since `since` (null = initial full load). */
export async function fetchChangedMaterials(
  orgId: string,
  since: string | null,
): Promise<SapMaterial[]> {
  const mode = process.env.SAP_MODE ?? "mock";

  if (mode !== "live") {
    // Mock: treat the existing mirror rows as the SAP source. On a delta run
    // (since != null) we return only rows whose updated_at is newer, so the
    // "changed since last sync" path is actually exercised locally.
    const admin = createAdminClient();
    let q = admin
      .from("materials")
      .select("material_code, description, unit, unit_price, stock, category, updated_at")
      .eq("org_id", orgId);
    if (since) q = q.gt("updated_at", since);
    const { data } = await q;
    return (data ?? []).map((m: any) => ({
      material_code: m.material_code,
      description: m.description,
      unit: m.unit,
      unit_price: Number(m.unit_price),
      stock: (m.stock ?? {}) as Record<string, number>,
      category: m.category ?? null,
      sap_changed_at: m.updated_at ?? new Date().toISOString(),
    }));
  }

  // ── Live S/4HANA pull ──
  const baseUrl = process.env.SAP_BASE_URL;
  const user = process.env.SAP_USER;
  const pass = process.env.SAP_PASSWORD;
  if (!baseUrl || !user || !pass) {
    throw new Error("SAP_BASE_URL / SAP_USER / SAP_PASSWORD not configured for live material sync");
  }
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  const servicePath = process.env.SAP_MATERIAL_SERVICE_PATH || "/sap/opu/odata/sap/API_PRODUCT_SRV";
  const client = process.env.SAP_CLIENT ?? "100";

  // Delta filter: only products changed since the cursor.
  const filter = since ? `&$filter=LastChangeDate gt datetime'${since}'` : "";
  const url = `${baseUrl}${servicePath}/A_Product?$format=json&sap-client=${client}${filter}`;
  const res = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" } });
  if (!res.ok) throw new Error(`SAP material pull failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  const rows: any[] = body?.d?.results ?? [];

  return rows.map((r) => ({
    material_code: r.Product,
    description: r.ProductDescription ?? r.Product,
    unit: (r.BaseUnit ?? "EA").toLowerCase(),
    unit_price: Number(r.StandardPrice ?? 0),
    stock: {}, // stock comes from the live stock API on demand, not the master
    category: r.ProductGroup ?? null,
    sap_changed_at: r.LastChangeDate ?? new Date().toISOString(),
  }));
}
