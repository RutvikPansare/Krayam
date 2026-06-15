import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SpendData } from "@/lib/spend";

/**
 * Phase 2 Feature 05 — board-ready monthly spend report.
 * Vector charts drawn with pdf-lib (same engine as the PO PDF) so the report
 * generates in any serverless runtime — no Puppeteer/Chromium needed.
 */

const NAVY = rgb(0.043, 0.133, 0.224);
const AMBER = rgb(0.96, 0.65, 0.14);
const GRAY = rgb(0.45, 0.48, 0.52);
const DARK = rgb(0.08, 0.09, 0.11);
const LIGHT = rgb(0.93, 0.94, 0.92);
const RED = rgb(0.86, 0.15, 0.15);

const PALETTE = [
  NAVY, AMBER, rgb(0.16, 0.38, 0.53), rgb(0.55, 0.65, 0.4),
  rgb(0.72, 0.45, 0.2), rgb(0.35, 0.31, 0.5), rgb(0.6, 0.6, 0.62), rgb(0.25, 0.55, 0.5),
];

const inr = (n: number) => {
  if (n >= 1e7) return "Rs. " + (n / 1e7).toFixed(2) + " Cr";
  if (n >= 1e5) return "Rs. " + (n / 1e5).toFixed(1) + " L";
  return "Rs. " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
};

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(mo) - 1] + " " + y.slice(2);
};

export async function generateSpendReportPdf(data: SpendData, opts: { companyName: string; periodLabel: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const M = 44;

  // ── Header ──
  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: NAVY });
  page.drawText("Krayam", { x: M, y: height - 46, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText(".", { x: M + 78, y: height - 46, size: 22, font: bold, color: AMBER });
  page.drawText("PROCUREMENT SPEND REPORT", { x: M, y: height - 62, size: 7, font, color: rgb(0.7, 0.74, 0.78) });
  page.drawText(opts.companyName, { x: width - M - 200, y: height - 42, size: 11, font: bold, color: rgb(1, 1, 1) });
  page.drawText(opts.periodLabel, { x: width - M - 200, y: height - 58, size: 9, font, color: rgb(0.8, 0.83, 0.86) });

  let y = height - 126;

  // ── KPI band ──
  const kpis = [
    ["TOTAL SPEND", inr(data.totalSpend)],
    ["PURCHASE ORDERS", String(data.poCount)],
    ["AVG PO VALUE", inr(data.avgPoValue)],
    ["TOP CATEGORY", data.byCategory[0]?.category ?? "—"],
  ];
  const kw = (width - 2 * M - 24) / 4;
  kpis.forEach(([k, v], i) => {
    const x = M + i * (kw + 8);
    page.drawRectangle({ x, y: y - 36, width: kw, height: 48, color: LIGHT });
    page.drawText(k, { x: x + 10, y: y - 4, size: 6.5, font: bold, color: GRAY });
    page.drawText(String(v).slice(0, 16), { x: x + 10, y: y - 24, size: 13, font: bold, color: NAVY });
  });
  y -= 70;

  // ── Spend by month (bars) + budget line markers ──
  page.drawText("SPEND BY MONTH — BUDGET vs ACTUAL", { x: M, y, size: 8, font: bold, color: GRAY });
  y -= 12;
  const chartH = 110;
  const chartW = width - 2 * M;
  const maxVal = Math.max(1, ...data.budgetVsActual.flatMap((b) => [b.actual, b.budget]));
  const slot = chartW / data.months.length;
  data.budgetVsActual.forEach((b, i) => {
    const x0 = M + i * slot;
    const bw = Math.min(34, slot / 2.6);
    const hA = (b.actual / maxVal) * chartH;
    const hB = (b.budget / maxVal) * chartH;
    // budget: light bar, actual: navy (red if over budget)
    page.drawRectangle({ x: x0 + slot / 2 - bw - 2, y: y - chartH, width: bw, height: Math.max(1, hB), color: LIGHT });
    page.drawRectangle({
      x: x0 + slot / 2 + 2, y: y - chartH, width: bw, height: Math.max(1, hA),
      color: b.budget > 0 && b.actual > b.budget ? RED : NAVY,
    });
    page.drawText(monthLabel(b.month), { x: x0 + slot / 2 - 14, y: y - chartH - 12, size: 7, font, color: GRAY });
    page.drawText(inr(b.actual), { x: x0 + slot / 2 - 14, y: y - chartH + Math.max(1, hA) + 3, size: 6, font: bold, color: DARK });
  });
  page.drawRectangle({ x: M, y: y - chartH - 1, width: chartW, height: 1, color: GRAY });
  // legend
  page.drawRectangle({ x: M, y: y - chartH - 28, width: 8, height: 8, color: LIGHT });
  page.drawText("Budget", { x: M + 12, y: y - chartH - 27, size: 7, font, color: GRAY });
  page.drawRectangle({ x: M + 50, y: y - chartH - 28, width: 8, height: 8, color: NAVY });
  page.drawText("Actual (red = over budget)", { x: M + 62, y: y - chartH - 27, size: 7, font, color: GRAY });
  y -= chartH + 52;

  // ── Spend by category (horizontal bars) ──
  page.drawText("SPEND BY CATEGORY", { x: M, y, size: 8, font: bold, color: GRAY });
  y -= 16;
  const cats = data.byCategory.slice(0, 8);
  const maxCat = Math.max(1, ...cats.map((c) => c.amount));
  const barAreaW = chartW - 170;
  cats.forEach((c, i) => {
    const bw = (c.amount / maxCat) * barAreaW;
    page.drawText(c.category.slice(0, 18), { x: M, y: y - 3, size: 8, font: bold, color: DARK });
    page.drawRectangle({ x: M + 100, y: y - 5, width: Math.max(1.5, bw), height: 10, color: PALETTE[i % PALETTE.length] });
    page.drawText(inr(c.amount), { x: M + 106 + bw, y: y - 3, size: 7.5, font, color: GRAY });
    y -= 17;
  });
  y -= 14;

  // ── Vendor concentration ──
  page.drawText("TOP VENDORS — CONCENTRATION", { x: M, y, size: 8, font: bold, color: GRAY });
  y -= 16;
  const vendors = data.byVendor.slice(0, 6);
  const maxVen = Math.max(1, ...vendors.map((v) => v.amount));
  vendors.forEach((v, i) => {
    const share = data.totalSpend > 0 ? (v.amount / data.totalSpend) * 100 : 0;
    const bw = (v.amount / maxVen) * barAreaW;
    page.drawText(v.vendor.slice(0, 20), { x: M, y: y - 3, size: 8, font: bold, color: DARK });
    page.drawRectangle({ x: M + 120, y: y - 5, width: Math.max(1.5, bw * 0.85), height: 10, color: i === 0 ? AMBER : NAVY });
    page.drawText(`${inr(v.amount)}  (${share.toFixed(0)}% · ${v.poCount} POs)`, { x: M + 126 + bw * 0.85, y: y - 3, size: 7.5, font, color: GRAY });
    y -= 17;
  });

  const topShare = data.totalSpend > 0 && vendors[0] ? (vendors[0].amount / data.totalSpend) * 100 : 0;
  if (topShare > 35) {
    y -= 6;
    page.drawText(`Note: ${vendors[0].vendor} holds ${topShare.toFixed(0)}% of spend — concentration risk worth reviewing.`, {
      x: M, y, size: 7.5, font: bold, color: RED,
    });
    y -= 10;
  }
  y -= 14;

  // ── Plant split ──
  if (data.byPlant.length > 0) {
    page.drawText("SPEND BY PLANT", { x: M, y, size: 8, font: bold, color: GRAY });
    y -= 16;
    data.byPlant.slice(0, 5).forEach((p) => {
      page.drawText(p.plant.slice(0, 24), { x: M, y: y - 3, size: 8, font: bold, color: DARK });
      page.drawText(inr(p.amount), { x: M + 160, y: y - 3, size: 8, font, color: GRAY });
      y -= 14;
    });
  }

  // ── Footer ──
  page.drawText(`Generated by Krayam on ${new Date().toISOString().slice(0, 10)} from live procurement data.`, {
    x: M, y: 36, size: 7, font, color: GRAY,
  });

  return doc.save();
}
