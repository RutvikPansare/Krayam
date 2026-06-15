import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionOrgId } from "@/lib/org";
import { findDuplicateClusters, type MaterialRow } from "@/lib/dedupe";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const NAVY = rgb(0.043, 0.133, 0.224);
const AMBER = rgb(0.96, 0.65, 0.14);
const GRAY = rgb(0.45, 0.48, 0.52);
const DARK = rgb(0.08, 0.09, 0.11);
const LIGHT = rgb(0.93, 0.94, 0.92);
const RED = rgb(0.86, 0.15, 0.15);

const inr = (n: number) =>
  "Rs. " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

/** Feature 08 — the audit as a PDF report (the sales artifact). */
export async function GET() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: materials } = await supabase
    .from("materials")
    .select("material_code, description, unit, unit_price, stock, category")
    .eq("org_id", orgId);
  const rows = (materials ?? []) as MaterialRow[];
  const clusters = findDuplicateClusters(rows);
  const duplicateCodes = clusters.reduce((s, c) => s + (c.members.length - 1), 0);
  const duplicateValue = clusters.reduce((s, c) => s + c.duplicateValue, 0);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([595, 842]);
  const { width, height } = page.getSize();
  const M = 48;

  // Header
  page.drawRectangle({ x: 0, y: height - 130, width, height: 130, color: NAVY });
  page.drawText("Krayam", { x: M, y: height - 54, size: 24, font: bold, color: rgb(1, 1, 1) });
  page.drawText(".", { x: M + 84, y: height - 54, size: 24, font: bold, color: AMBER });
  page.drawText("MATERIAL MASTER DEDUPLICATION AUDIT", { x: M, y: height - 84, size: 13, font: bold, color: AMBER });
  page.drawText(`${process.env.COMPANY_NAME || "Krayam Manufacturing"} · ${format(new Date(), "d MMMM yyyy")}`, {
    x: M, y: height - 102, size: 9, font, color: rgb(0.75, 0.78, 0.82),
  });

  // Summary stat band
  let y = height - 170;
  const stats = [
    ["Codes scanned", String(rows.length)],
    ["Duplicate clusters", String(clusters.length)],
    ["Redundant codes", `${duplicateCodes} (${rows.length ? Math.round((duplicateCodes / rows.length) * 100) : 0}%)`],
    ["Stock value in duplicates", inr(duplicateValue)],
  ];
  const sw = (width - 2 * M) / stats.length;
  page.drawRectangle({ x: M, y: y - 34, width: width - 2 * M, height: 52, color: LIGHT });
  stats.forEach(([k, v], i) => {
    page.drawText(k.toUpperCase(), { x: M + 12 + i * sw, y: y + 2, size: 6.5, font: bold, color: GRAY });
    page.drawText(v, { x: M + 12 + i * sw, y: y - 18, size: 12, font: bold, color: i === 3 ? RED : DARK });
  });
  y -= 64;

  page.drawText(
    "Each cluster below holds the same physical part under multiple material codes. Stock value counts",
    { x: M, y, size: 9, font, color: GRAY }
  );
  y -= 12;
  page.drawText(
    "inventory held under non-primary codes — working capital recoverable by merging codes.",
    { x: M, y, size: 9, font, color: GRAY }
  );
  y -= 28;

  const ensureSpace = (needed: number) => {
    if (y - needed < 60) {
      page = doc.addPage([595, 842]);
      y = 842 - 60;
    }
  };

  clusters.forEach((c, ci) => {
    ensureSpace(40 + c.members.length * 16);
    page.drawRectangle({ x: M, y: y - 8, width: width - 2 * M, height: 22, color: NAVY });
    page.drawText(`CLUSTER ${ci + 1} — ${c.members.length} codes, ${inr(c.duplicateValue)} locked`, {
      x: M + 10, y: y - 1, size: 9, font: bold, color: rgb(1, 1, 1),
    });
    y -= 28;
    c.members.forEach((m) => {
      const isPrimary = m === c.primary;
      const totalStock = Object.values(m.stock ?? {}).reduce((s, q) => s + Number(q || 0), 0);
      page.drawText(isPrimary ? "KEEP" : "MERGE", {
        x: M + 4, y, size: 7, font: bold, color: isPrimary ? rgb(0.08, 0.5, 0.24) : RED,
      });
      page.drawText(m.material_code, { x: M + 48, y, size: 8.5, font: bold, color: DARK });
      page.drawText(m.description.slice(0, 44), { x: M + 130, y, size: 8.5, font, color: DARK });
      page.drawText(`${totalStock} ${m.unit}`, { x: M + 360, y, size: 8.5, font, color: GRAY });
      page.drawText(inr(totalStock * Number(m.unit_price || 0)), { x: M + 430, y, size: 8.5, font, color: isPrimary ? GRAY : RED });
      y -= 15;
    });
    y -= 14;
  });

  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="krayam-dedup-audit.pdf"`,
    },
  });
}
