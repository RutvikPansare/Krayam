/**
 * SAP OData client — Feature 03: PR creation (ME21N equivalent via API).
 *
 * Implements the standard SAP Gateway pattern:
 *   1. GET with `x-csrf-token: Fetch` to obtain a CSRF token + session cookies
 *   2. POST the PR payload with the token + cookies
 *
 * Targets MM_PUR_REQ_MAINTAIN_SRV (S/4HANA) — works against BTP Trial sandbox,
 * QA client, and production by switching env config only:
 *
 *   SAP_MODE=mock | live           (mock: no SAP call, fake PR number — default)
 *   SAP_BASE_URL=https://host:port (e.g. https://sapes5.sapdevcenter.com)
 *   SAP_SERVICE_PATH=/sap/opu/odata/sap/MM_PUR_REQ_MAINTAIN_SRV
 *   SAP_USER / SAP_PASSWORD
 *   SAP_CLIENT=200                 (sap-client query param)
 *   SAP_COMPANY_CODE / SAP_PURCH_ORG / SAP_PURCH_GROUP / SAP_PLANT
 */

export interface SapPRItem {
  material: string;       // material code or short text
  description: string;
  quantity: number;
  unit: string;           // SAP UoM, e.g. EA
  deliveryDate?: string;  // YYYY-MM-DD
}

export interface SapPRResult {
  success: boolean;
  sapPrNumber: string | null;
  mode: "mock" | "live";
  raw?: unknown;
  error?: string;
}

export interface SapPOItem {
  material: string;
  description: string;
  quantity: number;
  unit: string;
  netPrice: number;        // per base unit, INR
}

export interface SapPOResult {
  success: boolean;
  sapPoNumber: string | null;
  mode: "mock" | "live";
  raw?: unknown;
  error?: string;
}

export interface SapGRNItem {
  material: string;
  description: string;
  quantity: number;
  unit: string;
  sapPoNumber: string | null;  // SAP PO the receipt posts against
  poLineNumber: number;        // 10, 20, 30…
}

export interface SapGRNResult {
  success: boolean;
  sapGrnNumber: string | null;  // material document number
  mode: "mock" | "live";
  raw?: unknown;
  error?: string;
}

/** One received line as reported by SAP for a goods receipt against a PO. */
export interface SapGoodsReceiptLine {
  poLineNumber: number;        // SAP PO item number (10, 20, 30…)
  material: string;
  quantityReceived: number;
  unit: string;
}

export interface SapGoodsReceiptFetch {
  success: boolean;
  mode: "mock" | "live";
  lines: SapGoodsReceiptLine[];
  raw?: unknown;
  error?: string;
}

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/** Map app units to SAP UoM codes. */
function sapUom(unit: string): string {
  const map: Record<string, string> = {
    piece: "EA", nos: "EA", pair: "PAA", dozen: "DZN", gross: "GRO",
    kg: "KG", litre: "L", metre: "M", set: "SET",
    box10: "EA", box50: "EA", box100: "EA",
  };
  return map[unit] ?? "EA";
}

async function fetchCsrfToken(baseUrl: string, servicePath: string, auth: string, client: string) {
  const url = `${baseUrl}${servicePath}/?sap-client=${client}&$format=json`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: auth,
      "x-csrf-token": "Fetch",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`CSRF fetch failed: ${res.status} ${res.statusText}`);
  }
  const token = res.headers.get("x-csrf-token");
  if (!token) throw new Error("SAP did not return x-csrf-token header");
  // Node fetch folds multiple set-cookie headers; getSetCookie preserves them
  const cookies = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  return { token, cookies };
}

export async function createSapPurchaseRequisition(opts: {
  prNumber: string;
  items: SapPRItem[];
}): Promise<SapPRResult> {
  const mode = env("SAP_MODE", "mock");

  if (mode !== "live") {
    // Mock mode — deterministic fake PR number so the rest of the pipeline
    // (status updates, emails, dashboard) behaves exactly like production.
    const fake = "10" + String(Math.floor(10000000 + Math.random() * 89999999));
    return { success: true, sapPrNumber: fake, mode: "mock" };
  }

  const baseUrl = env("SAP_BASE_URL");
  const servicePath = env("SAP_SERVICE_PATH", "/sap/opu/odata/sap/MM_PUR_REQ_MAINTAIN_SRV");
  const user = env("SAP_USER");
  const pass = env("SAP_PASSWORD");
  const client = env("SAP_CLIENT", "100");
  if (!baseUrl || !user || !pass) {
    return { success: false, sapPrNumber: null, mode: "live", error: "SAP_BASE_URL / SAP_USER / SAP_PASSWORD not configured" };
  }
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  try {
    const { token, cookies } = await fetchCsrfToken(baseUrl, servicePath, auth, client);

    const payload = {
      PurReqnDescription: `Krayam ${opts.prNumber}`,
      to_PurchaseReqnItem: opts.items.map((it, i) => ({
        PurchaseRequisitionItemText: it.description.slice(0, 40),
        Material: it.material,
        RequestedQuantity: String(it.quantity),
        BaseUnit: sapUom(it.unit),
        Plant: env("SAP_PLANT"),
        PurchasingOrganization: env("SAP_PURCH_ORG"),
        PurchasingGroup: env("SAP_PURCH_GROUP"),
        CompanyCode: env("SAP_COMPANY_CODE"),
        DeliveryDate: it.deliveryDate,
        PurchaseRequisitionItem: String((i + 1) * 10),
      })),
    };

    const res = await fetch(`${baseUrl}${servicePath}/A_PurchaseRequisitionHeader?sap-client=${client}`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "x-csrf-token": token,
        Cookie: cookies,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as any)?.error?.message?.value ?? `${res.status} ${res.statusText}`;
      return { success: false, sapPrNumber: null, mode: "live", raw: body, error: msg };
    }
    const sapPrNumber = (body as any)?.d?.PurchaseRequisition ?? null;
    return { success: true, sapPrNumber, mode: "live", raw: body };
  } catch (err) {
    return {
      success: false,
      sapPrNumber: null,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown SAP error",
    };
  }
}

/**
 * Feature 06 — Purchase Order push (ME21N's PO sibling).
 * Targets API_PURCHASEORDER_PROCESS_SRV (S/4HANA). Same CSRF flow as PR
 * creation; mock mode returns a fake PO number so the pipeline runs locally.
 */
export async function createSapPurchaseOrder(opts: {
  poNumber: string;
  vendorName: string;
  items: SapPOItem[];
}): Promise<SapPOResult> {
  const mode = env("SAP_MODE", "mock");

  if (mode !== "live") {
    const fake = "45" + String(Math.floor(10000000 + Math.random() * 89999999));
    return { success: true, sapPoNumber: fake, mode: "mock" };
  }

  const baseUrl = env("SAP_BASE_URL");
  const servicePath = env("SAP_PO_SERVICE_PATH", "/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV");
  const user = env("SAP_USER");
  const pass = env("SAP_PASSWORD");
  const client = env("SAP_CLIENT", "100");
  if (!baseUrl || !user || !pass) {
    return { success: false, sapPoNumber: null, mode: "live", error: "SAP_BASE_URL / SAP_USER / SAP_PASSWORD not configured" };
  }
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  try {
    const { token, cookies } = await fetchCsrfToken(baseUrl, servicePath, auth, client);

    const payload = {
      CompanyCode: env("SAP_COMPANY_CODE"),
      PurchaseOrderType: "NB",
      Supplier: env("SAP_DEFAULT_SUPPLIER", ""), // map vendor → SAP supplier code in config
      PurchasingOrganization: env("SAP_PURCH_ORG"),
      PurchasingGroup: env("SAP_PURCH_GROUP"),
      to_PurchaseOrderItem: opts.items.map((it, i) => ({
        PurchaseOrderItem: String((i + 1) * 10),
        Material: it.material,
        PurchaseOrderItemText: it.description.slice(0, 40),
        OrderQuantity: String(it.quantity),
        PurchaseOrderQuantityUnit: "EA",
        NetPriceAmount: String(it.netPrice),
        Plant: env("SAP_PLANT"),
      })),
    };

    const res = await fetch(`${baseUrl}${servicePath}/A_PurchaseOrder?sap-client=${client}`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "x-csrf-token": token,
        Cookie: cookies,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as any)?.error?.message?.value ?? `${res.status} ${res.statusText}`;
      return { success: false, sapPoNumber: null, mode: "live", raw: body, error: msg };
    }
    const sapPoNumber = (body as any)?.d?.PurchaseOrder ?? null;
    return { success: true, sapPoNumber, mode: "live", raw: body };
  } catch (err) {
    return {
      success: false,
      sapPoNumber: null,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown SAP error",
    };
  }
}

/**
 * Feature 13 — Goods Receipt (MIGO equivalent).
 * Live mode targets API_MATERIAL_DOCUMENT_SRV (S/4HANA), the OData wrapper
 * around BAPI_GOODSMVT_CREATE: GoodsMovementCode "01" + movement type 101
 * posts a goods receipt against the PO. Same CSRF flow as PR/PO creation;
 * mock mode returns a fake material document number.
 */
export async function createSapGoodsReceipt(opts: {
  grnNumber: string;
  items: SapGRNItem[];
}): Promise<SapGRNResult> {
  const mode = env("SAP_MODE", "mock");

  if (mode !== "live") {
    const fake = "50" + String(Math.floor(10000000 + Math.random() * 89999999));
    return { success: true, sapGrnNumber: fake, mode: "mock" };
  }

  const baseUrl = env("SAP_BASE_URL");
  const servicePath = env("SAP_GRN_SERVICE_PATH", "/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV");
  const user = env("SAP_USER");
  const pass = env("SAP_PASSWORD");
  const client = env("SAP_CLIENT", "100");
  if (!baseUrl || !user || !pass) {
    return { success: false, sapGrnNumber: null, mode: "live", error: "SAP_BASE_URL / SAP_USER / SAP_PASSWORD not configured" };
  }
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  try {
    const { token, cookies } = await fetchCsrfToken(baseUrl, servicePath, auth, client);

    const payload = {
      GoodsMovementCode: "01",                      // goods receipt for PO
      PostingDate: new Date().toISOString().slice(0, 10) + "T00:00:00",
      DocumentDate: new Date().toISOString().slice(0, 10) + "T00:00:00",
      ReferenceDocument: opts.grnNumber,
      to_MaterialDocumentItem: opts.items.map((it) => ({
        Material: it.material,
        Plant: env("SAP_PLANT"),
        StorageLocation: env("SAP_STORAGE_LOCATION", "0001"),
        GoodsMovementType: "101",                   // GR against purchase order
        PurchaseOrder: it.sapPoNumber ?? "",
        PurchaseOrderItem: String(it.poLineNumber),
        QuantityInEntryUnit: String(it.quantity),
        EntryUnit: sapUom(it.unit),
      })),
    };

    const res = await fetch(`${baseUrl}${servicePath}/A_MaterialDocumentHeader?sap-client=${client}`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "x-csrf-token": token,
        Cookie: cookies,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as any)?.error?.message?.value ?? `${res.status} ${res.statusText}`;
      return { success: false, sapGrnNumber: null, mode: "live", raw: body, error: msg };
    }
    const sapGrnNumber = (body as any)?.d?.MaterialDocument ?? null;
    return { success: true, sapGrnNumber, mode: "live", raw: body };
  } catch (err) {
    return {
      success: false,
      sapGrnNumber: null,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown SAP error",
    };
  }
}

/**
 * Feature 12 — fetch the goods actually received for a PO from SAP.
 *
 * This is the GRN side of the 3-way match. Live mode reads the material
 * document items posted as goods receipts (movement type 101) against the PO —
 * the OData equivalent of BAPI_GOODSMVT_GETDETAIL, exposed by
 * API_MATERIAL_DOCUMENT_SRV. Quantities are summed per PO line.
 *
 * Mock mode performs no SAP call and returns an empty set with success=true;
 * the caller then falls back to Krayam's own GRN records (posted by the receive
 * flow), so the match runs end-to-end without a live SAP connection.
 */
export async function fetchSapGoodsReceipts(opts: { sapPoNumber: string }): Promise<SapGoodsReceiptFetch> {
  const mode = env("SAP_MODE", "mock");
  if (mode !== "live") {
    return { success: true, mode: "mock", lines: [] };
  }

  const baseUrl = env("SAP_BASE_URL");
  const servicePath = env("SAP_GRN_SERVICE_PATH", "/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV");
  const user = env("SAP_USER");
  const pass = env("SAP_PASSWORD");
  const client = env("SAP_CLIENT", "100");
  if (!baseUrl || !user || !pass) {
    return { success: false, mode: "live", lines: [], error: "SAP_BASE_URL / SAP_USER / SAP_PASSWORD not configured" };
  }
  if (!opts.sapPoNumber) {
    return { success: false, mode: "live", lines: [], error: "PO has no SAP document number to query receipts for." };
  }
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  try {
    // GR items for this PO: movement type 101 (GR for PO), debit side.
    const filter = encodeURIComponent(`PurchaseOrder eq '${opts.sapPoNumber}' and GoodsMovementType eq '101'`);
    const url = `${baseUrl}${servicePath}/A_MaterialDocumentItem?sap-client=${client}&$filter=${filter}&$format=json`;
    const res = await fetch(url, { method: "GET", headers: { Authorization: auth, Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as any)?.error?.message?.value ?? `${res.status} ${res.statusText}`;
      return { success: false, mode: "live", lines: [], raw: body, error: msg };
    }
    const rows: any[] = (body as any)?.d?.results ?? [];
    const byLine = new Map<number, SapGoodsReceiptLine>();
    for (const r of rows) {
      const line = Number(r.PurchaseOrderItem);
      const qty = Number(r.QuantityInEntryUnit ?? r.QuantityInBaseUnit ?? 0);
      const prev = byLine.get(line);
      if (prev) prev.quantityReceived += qty;
      else byLine.set(line, { poLineNumber: line, material: String(r.Material ?? ""), quantityReceived: qty, unit: String(r.EntryUnit ?? r.BaseUnit ?? "EA") });
    }
    return { success: true, mode: "live", lines: Array.from(byLine.values()), raw: body };
  } catch (err) {
    return { success: false, mode: "live", lines: [], error: err instanceof Error ? err.message : "Unknown SAP error" };
  }
}
