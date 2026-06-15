import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatPaise } from "@/lib/money";

/**
 * Feature 06 — Purchase Order PDF.
 * pdf-lib only (no headless browser), so it runs anywhere — including
 * serverless. Layout mirrors a standard Indian manufacturer PO.
 *
 * All monetary values arrive as integer paise and are formatted only here.
 */

export interface POPdfData {
  poNumber: string;
  poDate: string;
  companyName: string;
  companyAddress: string;
  vendorName: string;
  vendorAddress?: string | null;
  deliveryAddress?: string | null;  // where goods ship to (from org config)
  deliveryDate?: string | null;     // expected delivery date, if known
  prNumber: string | null;
  rfqNumber: string | null;
  paymentTerms: string | null;
  deliveryDays: number | null;
  sapPoNumber: string | null;
  standardTerms?: string | null;    // customer's configured T&C (one clause per line)
  items: {
    item_name: string;
    material_code: string | null;
    quantity: number;
    unit: string;
    unit_price_paise: number;
    line_total_paise: number;
  }[];
  totalPaise: number;
}

const NAVY = rgb(0.043, 0.133, 0.224);
const AMBER = rgb(0.96, 0.65, 0.14);
const GRAY = rgb(0.45, 0.48, 0.52);
const DARK = rgb(0.08, 0.09, 0.11);
const LIGHT = rgb(0.93, 0.94, 0.92);

// pdf-lib standard fonts are WinAnsi — no ₹ glyph, so amounts use "Rs."
// Input is integer paise; formatPaise does the only paise→rupees conversion.
const inr = (paise: number) => formatPaise(paise);

export async function generatePoPdf(data: POPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const M = 48;

  // ── Header band ──
  page.drawRectangle({ x: 0, y: height - 110, width, height: 110, color: NAVY });
  page.drawText("Krayam", { x: M, y: height - 52, size: 26, font: bold, color: rgb(1, 1, 1) });
  page.drawText(".", { x: M + 92, y: height - 52, size: 26, font: bold, color: AMBER });
  page.drawText("PROCUREMENT INTELLIGENCE", { x: M, y: height - 68, size: 7, font, color: rgb(0.7, 0.74, 0.78) });
  page.drawText("PURCHASE ORDER", { x: width - M - 152, y: height - 48, size: 16, font: bold, color: AMBER });
  page.drawText(data.poNumber, { x: width - M - 152, y: height - 68, size: 12, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`Date: ${data.poDate}`, { x: width - M - 152, y: height - 84, size: 9, font, color: rgb(0.8, 0.83, 0.86) });

  let y = height - 140;

  // ── Parties ──
  page.drawText("FROM (BUYER)", { x: M, y, size: 7, font: bold, color: GRAY });
  page.drawText("TO (VENDOR)", { x: width / 2 + 10, y, size: 7, font: bold, color: GRAY });
  y -= 16;
  const colR = width / 2 + 10;
  page.drawText(data.companyName, { x: M, y, size: 11, font: bold, color: DARK });
  page.drawText(data.vendorName, { x: colR, y, size: 11, font: bold, color: DARK });

  // Buyer and vendor address blocks side by side; track each column's y
  // independently and resume below the taller of the two.
  let yL = y - 14;
  for (const line of data.companyAddress.split("\n")) {
    page.drawText(line.slice(0, 52), { x: M, y: yL, size: 9, font, color: GRAY });
    yL -= 12;
  }
  let yR = y - 14;
  for (const line of (data.vendorAddress ?? "Address on file").split("\n")) {
    page.drawText(line.slice(0, 52), { x: colR, y: yR, size: 9, font, color: GRAY });
    yR -= 12;
  }
  y = Math.min(yL, yR) - 8;

  // ── Ship-to (delivery address) ──
  if (data.deliveryAddress) {
    page.drawText("SHIP TO", { x: M, y, size: 7, font: bold, color: GRAY });
    y -= 13;
    for (const line of data.deliveryAddress.split("\n")) {
      page.drawText(line.slice(0, 90), { x: M, y, size: 9, font, color: DARK });
      y -= 12;
    }
    y -= 6;
  }

  // ── References ──
  const refs = [
    ["RFQ Reference", data.rfqNumber ?? "-"],
    ["SAP PO Number", data.sapPoNumber ?? "pending"],
    ["Payment Terms", data.paymentTerms ?? "As agreed"],
    ["Delivery", data.deliveryDays != null ? `${data.deliveryDays} days` : "As agreed"],
    ["Delivery Date", data.deliveryDate ?? "As agreed"],
  ];
  const refW = (width - 2 * M) / refs.length;
  page.drawRectangle({ x: M, y: y - 30, width: width - 2 * M, height: 40, color: LIGHT });
  refs.forEach(([k, v], i) => {
    page.drawText(k.toUpperCase(), { x: M + 10 + i * refW, y: y - 6, size: 6.5, font: bold, color: GRAY });
    page.drawText(String(v).slice(0, 22), { x: M + 10 + i * refW, y: y - 20, size: 9, font: bold, color: DARK });
  });
  y -= 56;

  // ── Items table ──
  const cols = [
    { label: "#", x: M, w: 22 },
    { label: "ITEM DESCRIPTION", x: M + 22, w: 190 },
    { label: "MATERIAL CODE", x: M + 212, w: 90 },
    { label: "QTY", x: M + 302, w: 60 },
    { label: "UNIT PRICE", x: M + 362, w: 70 },
    { label: "AMOUNT", x: M + 432, w: 67 },
  ];
  page.drawRectangle({ x: M, y: y - 6, width: width - 2 * M, height: 20, color: NAVY });
  cols.forEach((c) => page.drawText(c.label, { x: c.x + 4, y, size: 7, font: bold, color: rgb(1, 1, 1) }));
  y -= 24;

  data.items.forEach((it, i) => {
    if (i % 2 === 1) {
      page.drawRectangle({ x: M, y: y - 6, width: width - 2 * M, height: 20, color: LIGHT });
    }
    page.drawText(String(i + 1), { x: cols[0].x + 4, y, size: 9, font, color: DARK });
    page.drawText(it.item_name.slice(0, 42), { x: cols[1].x + 4, y, size: 9, font, color: DARK });
    page.drawText(it.material_code ?? "-", { x: cols[2].x + 4, y, size: 8.5, font, color: GRAY });
    page.drawText(`${it.quantity} ${it.unit}`, { x: cols[3].x + 4, y, size: 9, font, color: DARK });
    page.drawText(inr(it.unit_price_paise), { x: cols[4].x + 4, y, size: 9, font, color: DARK });
    page.drawText(inr(it.line_total_paise), { x: cols[5].x + 4, y, size: 9, font: bold, color: DARK });
    y -= 20;
  });

  // ── Total ──
  y -= 4;
  page.drawLine({ start: { x: M, y: y + 12 }, end: { x: width - M, y: y + 12 }, thickness: 1, color: NAVY });
  page.drawText("TOTAL (excl. GST)", { x: M + 302, y: y - 6, size: 10, font: bold, color: DARK });
  page.drawText(inr(data.totalPaise), { x: M + 432, y: y - 6, size: 12, font: bold, color: NAVY });
  y -= 44;

  // ── Terms ── customer-configured clauses (one per line), else defaults.
  page.drawText("TERMS & CONDITIONS", { x: M, y, size: 7, font: bold, color: GRAY });
  y -= 14;
  const defaultTerms = [
    "Prices are firm for the delivery period stated above. GST extra as applicable.",
    "Material must conform to the specification in the RFQ. Rejections returned at vendor cost.",
    "Invoice must quote this PO number" + (data.sapPoNumber ? ` and SAP PO ${data.sapPoNumber}.` : "."),
    "Delivery to buyer stores during working hours with delivery challan and test certificates.",
  ];
  const clauses = data.standardTerms
    ? data.standardTerms.split("\n").map((s) => s.trim()).filter(Boolean)
    : defaultTerms;
  clauses.forEach((t, i) => {
    page.drawText(`${i + 1}. ${t}`.slice(0, 110), { x: M, y, size: 8, font, color: GRAY });
    y -= 12;
  });

  // ── Footer ──
  page.drawText("This is a system-generated purchase order created with Krayam.", {
    x: M, y: 40, size: 7.5, font, color: GRAY,
  });
  page.drawText("Authorised Signatory", { x: width - M - 110, y: 64, size: 9, font: bold, color: DARK });
  page.drawLine({ start: { x: width - M - 130, y: 80 }, end: { x: width - M, y: 80 }, thickness: 0.7, color: GRAY });

  return doc.save();
}
