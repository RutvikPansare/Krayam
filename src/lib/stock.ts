import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Feature 09 — stock query across ALL plant/storage locations, cached 15 min.
 *
 * STOCK_MODE=mock (default): reads the local materials mirror (Supabase),
 * synced nightly from SAP.
 * STOCK_MODE=live: queries SAP API_MATERIAL_STOCK_SRV per material, with a
 * hard 3-second timeout. SAP unreachable/slow ⇒ returns null and the caller
 * proceeds — a stock check must NEVER block a purchase.
 *
 * Cache: Upstash Redis (REST) when configured, else a bounded in-memory Map.
 * Key includes org_id so customers never share cached stock.
 */

export interface StockInfo {
  material_code: string;
  description: string | null;
  unit: string;
  unit_price: number;        // rupees (moving avg); server converts to paise for money
  /** warehouse/plant → quantity (across all locations) */
  stock: Record<string, number>;
  total: number;
  last_movement_date: string | null;
  source: "mirror" | "sap";
  cached: boolean;
}

const TTL_MS = 15 * 60 * 1000;
const TTL_S = 15 * 60;
const SAP_TIMEOUT_MS = 3000;
const MAX_MEM_ENTRIES = 2000;

// ── Cache backends ───────────────────────────────────────────────
const mem = new Map<string, { at: number; info: StockInfo }>();

function memGet(key: string): StockInfo | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= TTL_MS) { mem.delete(key); return null; } // evict expired
  return hit.info;
}
function memSet(key: string, info: StockInfo) {
  // Bound the map: drop the oldest entry when over capacity.
  if (mem.size >= MAX_MEM_ENTRIES) {
    const oldest = mem.keys().next().value;
    if (oldest) mem.delete(oldest);
  }
  mem.set(key, { at: Date.now(), info });
}

function upstash() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function cacheGet(key: string): Promise<StockInfo | null> {
  const up = upstash();
  if (!up) return memGet(key);
  try {
    const res = await fetch(`${up.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${up.token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.result ? (JSON.parse(body.result) as StockInfo) : null;
  } catch { return null; }
}

async function cacheSet(key: string, info: StockInfo): Promise<void> {
  const up = upstash();
  if (!up) { memSet(key, info); return; }
  try {
    // SETEX enforces TTL server-side — cache never grows unbounded.
    await fetch(`${up.url}/setex/${encodeURIComponent(key)}/${TTL_S}/${encodeURIComponent(JSON.stringify(info))}`, {
      headers: { Authorization: `Bearer ${up.token}` },
    });
  } catch { /* cache is best-effort */ }
}

// ── SAP live query, 3-second timeout, all locations ──────────────
async function queryLiveSap(code: string): Promise<{ stock: Record<string, number>; lastMovement: string | null } | null> {
  const baseUrl = process.env.SAP_BASE_URL;
  const user = process.env.SAP_USER;
  const pass = process.env.SAP_PASSWORD;
  if (!baseUrl || !user || !pass) return null;
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  const url =
    `${baseUrl}/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod` +
    `?$filter=Material eq '${encodeURIComponent(code)}'&$format=json` +
    `&sap-client=${process.env.SAP_CLIENT ?? "100"}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SAP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" }, signal: ac.signal });
    if (!res.ok) throw new Error(`SAP stock query failed: ${res.status}`);
    const body = await res.json();
    const rows: any[] = body?.d?.results ?? [];
    const byPlant: Record<string, number> = {};
    let lastMovement: string | null = null;
    for (const r of rows) {
      // Across all plants AND storage locations, not just the default plant.
      const key = [r.Plant, r.StorageLocation].filter(Boolean).join("/") || "unknown";
      byPlant[key] = (byPlant[key] ?? 0) + Number(r.MatlWrhsStkQtyInMatlBaseUnit ?? 0);
      const mv = r.LastChangeDate ?? r.MaterialDocumentPostingDate ?? null;
      if (mv && (!lastMovement || mv > lastMovement)) lastMovement = mv;
    }
    return { stock: byPlant, lastMovement };
  } catch (err) {
    // Timeout or transport error — log and let the caller proceed without stock.
    console.error("Live SAP stock query failed/timeout, falling back to mirror:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getStock(materialCode: string, orgId?: string): Promise<StockInfo | null> {
  const key = materialCode.trim().toUpperCase();
  const cacheKey = `stock:${orgId ?? "default"}:${key}`; // org-scoped — no cross-customer sharing

  const hit = await cacheGet(cacheKey);
  if (hit) return { ...hit, cached: true };

  const supabase = createAdminClient();
  let mq = supabase
    .from("materials")
    .select("material_code, description, unit, unit_price, stock")
    .ilike("material_code", key);
  if (orgId) mq = mq.eq("org_id", orgId);
  const { data: mat } = await mq.maybeSingle();

  let info: StockInfo | null = null;

  if (process.env.STOCK_MODE === "live") {
    const sap = await queryLiveSap(key);
    if (sap) {
      info = {
        material_code: key,
        description: mat?.description ?? null,
        unit: mat?.unit ?? "piece",
        unit_price: Number(mat?.unit_price ?? 0),
        stock: sap.stock,
        total: Object.values(sap.stock).reduce((s, q) => s + q, 0),
        last_movement_date: sap.lastMovement,
        source: "sap",
        cached: false,
      };
    }
  }

  if (!info && mat) {
    const stock = (mat.stock ?? {}) as Record<string, number>;
    info = {
      material_code: mat.material_code,
      description: mat.description,
      unit: mat.unit,
      unit_price: Number(mat.unit_price),
      stock,
      total: Object.values(stock).reduce((s, q) => s + Number(q || 0), 0),
      last_movement_date: null,
      source: "mirror",
      cached: false,
    };
  }

  if (info) await cacheSet(cacheKey, info);
  return info;
}
