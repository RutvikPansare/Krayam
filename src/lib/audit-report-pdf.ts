import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatPaise } from "@/lib/money";
import type { DecryptedCluster } from "@/lib/audit-data";

/**
 * Feature 08 — branded duplicate-audit PDF, pdf-lib FALLBACK renderer.
 * The primary report is rendered by Puppeteer from a React page
 * (audit-pdf.ts); this serverless-safe fallback runs when no headless browser
 * is available. Takes already-decrypted data — no DB access, no plaintext.
 */

const NAVY = rgb(0.043, 0.133, 0.224);
const AMBER = rgb(0.96, 0.65, 0.14);
const GRAY = rgb(0.45, 0.48, 0.52);
const DARK = rgb(0.08, 0.09, 0.11);
const LIGHT = rgb(0.93, 0.94, 0.92);
const RED = rgb(0.86, 0.15, 0.15);

export async function generateAuditPdf(
  run: any,
  allClusters: DecryptedCluster[],
  companyName: string,
): Promise<Uint8Array> {
  const clusters = allClusters.slice(0, 10);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]);
  const { width, height } = page.getSize();
  const M = 48;

  // Header band — Krayam brand + customer name
  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: NAVY });
  page.drawText("Krayam", { x: M, y: height - 50, size: 24, font: bold, color: rgb(1, 1, 1) });
  page.drawText(".", { x: M + 84, y: height - 50, size: 24, font: bold, color: AMBER });
  page.drawText("MATERIAL MASTER DUPLICATE AUDIT", { x: M, y: height - 68, size: 8, font, color: rgb(0.7, 0.74, 0.78) });
  page.drawText(companyName.slice(0, 38), { x: width - M - 220, y: height - 46, size: 12, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`Report v${run?.version ?? "—"}`, { x: width - M - 220, y: height - 64, size: 9, font, color: rgb(0.8, 0.83, 0.86) });

  let y = height - 130;

  // Summary cards
  const cards: [string, string, typeof DARK][] = [
    ["MATERIALS ANALYZED", String(run?.materials_analyzed ?? 0), DARK],
    ["CONFIRMED DUPLICATES", String(run?.confirmed_count ?? 0), RED],
    ["PROBABLE DUPLICATES", String(run?.probable_count ?? 0), AMBER],
    ["VALUE IN DUPLICATE STOCK", formatPaise(run?.duplicate_value_paise ?? 0), NAVY],
  ];
  const cw = (width - 2 * M - 30) / 4;
  cards.forEach(([label, value], i) => {
    const x = M + i * (cw + 10);
    page.drawRectangle({ x, y: y - 46, width: cw, height: 56, color: LIGHT });
    page.drawText(label, { x: x + 8, y: y - 8, size: 6, font: bold, color: GRAY });
    page.drawText(value.length > 14 ? value.slice(0, 14) : value, { x: x + 8, y: y - 30, size: value.length > 10 ? 11 : 15, font: bold, color: cards[i][2] });
  });
  y -= 80;

  page.drawText("TOP DUPLICATE FAMILIES BY VALUE", { x: M, y, size: 9, font: bold, color: NAVY });
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: NAVY });
  y -= 18;

  for (const c of clusters ?? []) {
    if (y < 90) { page = doc.addPage([595, 842]); y = height - 60; }
    const members = c.members ?? [];
    const labelColor = c.label === "confirmed" ? RED : c.label === "probable" ? AMBER : GRAY;
    page.drawText(String(c.label).toUpperCase(), { x: M, y, size: 7, font: bold, color: labelColor });
    page.drawText(`${c.member_count} codes · cohesion ${(Number(c.cohesion) * 100).toFixed(0)}%`, { x: M + 70, y, size: 8, font, color: GRAY });
    page.drawText(formatPaise(c.duplicate_value_paise), { x: width - M - 90, y, size: 9, font: bold, color: DARK });
    y -= 13;
    for (const m of members) {
      if (y < 70) { page = doc.addPage([595, 842]); y = height - 60; }
      const tag = m.is_primary ? "[keep] " : "  dup  ";
      page.drawText(`${tag}${m.material_code}  ${(m.description ?? "").slice(0, 44)}`, { x: M + 8, y, size: 8, font, color: m.is_primary ? NAVY : DARK });
      page.drawText(`${m.stock_qty} @ ${formatPaise(m.stock_value_paise)}`, { x: width - M - 120, y, size: 8, font, color: GRAY });
      y -= 11;
    }
    y -= 8;
  }

  page.drawText("Confirmed ≥92% similarity · Probable ≥82%. No SAP changes made — review and confirm each family before any merge.", {
    x: M, y: 40, size: 7, font, color: GRAY,
  });

  return doc.save();
}
