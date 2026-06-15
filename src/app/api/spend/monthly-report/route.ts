import { NextResponse } from "next/server";
import { computeSpend } from "@/lib/spend";
import { generateSpendReportPdf } from "@/lib/spend-report";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const COMPANY_NAME = process.env.COMPANY_NAME || "Krayam Manufacturing";

/**
 * Phase 2 Feature 05 — scheduled monthly CFO report.
 * Hit by a scheduler (Vercel cron / GitHub Action / crontab) on the 1st of
 * each month:
 *
 *   vercel.json: { "crons": [{ "path": "/api/spend/monthly-report", "schedule": "0 3 1 * *" }] }
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
 * when CRON_SECRET is set; manual callers can use ?key=CRON_SECRET.
 * Recipient: CFO_EMAIL env var.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const authed =
    !secret ||
    req.headers.get("authorization") === `Bearer ${secret}` ||
    url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cfoEmail = process.env.CFO_EMAIL;
  if (!cfoEmail) return NextResponse.json({ error: "CFO_EMAIL not configured" }, { status: 500 });

  const data = await computeSpend(6);
  const now = new Date();
  const periodLabel = `${now.toLocaleString("en-IN", { month: "long", year: "numeric" })} board report`;
  const pdf = await generateSpendReportPdf(data, { companyName: COMPANY_NAME, periodLabel });

  const inr = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
  await sendEmail({
    to: cfoEmail,
    subject: `[Krayam] Monthly procurement spend report — ${now.toLocaleString("en-IN", { month: "long", year: "numeric" })}`,
    html: `
      <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="color:#0B2239;margin:0 0 8px;">Procurement spend report</h2>
        <p style="color:#5B6470;font-size:14px;">The board-ready PDF is attached. Headlines for the last 6 months:</p>
        <ul style="color:#14181D;font-size:14px;line-height:1.7;">
          <li>Total spend: <b>Rs. ${inr(data.totalSpend)}</b> across ${data.poCount} purchase orders</li>
          <li>Average PO value: Rs. ${inr(data.avgPoValue)}</li>
          <li>Top category: <b>${data.byCategory[0]?.category ?? "—"}</b> (Rs. ${inr(data.byCategory[0]?.amount ?? 0)})</li>
          <li>Top vendor: <b>${data.byVendor[0]?.vendor ?? "—"}</b> (Rs. ${inr(data.byVendor[0]?.amount ?? 0)})</li>
        </ul>
        <p style="color:#8A929D;font-size:12px;">Generated automatically by Krayam from live procurement data.</p>
      </div>`,
    attachments: [{ filename: `krayam-spend-${now.toISOString().slice(0, 7)}.pdf`, content: Buffer.from(pdf) }],
  });

  return NextResponse.json({ ok: true, sent_to: cfoEmail, total_spend: data.totalSpend, po_count: data.poCount });
}
