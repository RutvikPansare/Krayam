// POST /api/cron/savings-summary — monthly stock-savings digest to the CFO.
//
// Aggregates the savings_log for the previous calendar month per org and emails
// the Finance Controller(s). Generated purely from the append-only log — no
// manual spreadsheet. Auth: Bearer CRON_SECRET. Scheduled monthly (0020).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCompany } from "@/lib/company";
import { sendEmail } from "@/lib/email";
import { formatPaise } from "@/lib/money";
import type { CfoSavingsReport } from "@/types/savings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Previous calendar month [start, end).
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthLabel = start.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  const admin = createAdminClient();
  const { data: orgs } = await admin.from("organizations").select("id");

  const sent: { org_id: string; recipients: number }[] = [];
  for (const org of orgs ?? []) {
    const { data: rows } = await admin
      .from("savings_log")
      .select("action, estimated_saving_paise")
      .eq("org_id", org.id)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());
    if (!rows || rows.length === 0) continue;

    const report: CfoSavingsReport = {
      org_id: org.id, period_start: start.toISOString(), period_end: end.toISOString(),
      intercepts: rows.length,
      accepted_count: rows.filter((r) => r.action === "accepted").length,
      overridden_count: rows.filter((r) => r.action === "overridden").length,
      total_saved_paise: rows.filter((r) => r.action === "accepted").reduce((s, r) => s + Number(r.estimated_saving_paise), 0),
      total_at_risk_paise: rows.filter((r) => r.action === "overridden").reduce((s, r) => s + Number(r.estimated_saving_paise), 0),
    };

    // CFOs (role cfo) for this org; fall back to owners.
    const { data: cfos } = await admin
      .from("team_members").select("email, role").eq("org_id", org.id).in("role", ["cfo", "owner"]);
    const recipients = (cfos ?? []).map((m) => m.email).filter(Boolean) as string[];
    if (recipients.length === 0) continue;

    const company = await getCompany(org.id);
    await sendEmail({
      to: recipients,
      subject: `[${company.company_name}] Stock-savings summary — ${monthLabel}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="color:#0B2239;margin:0 0 12px;">Stock-check savings — ${monthLabel}</h2>
        <p style="color:#5B6470;font-size:14px;">Krayam intercepted <b>${report.intercepts}</b> purchase line${report.intercepts === 1 ? "" : "s"} where stock already existed.</p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px;">
          <tr><td style="padding:8px 0;color:#5B6470;">Saved (orders reduced/cancelled)</td><td style="text-align:right;font-weight:700;color:#15803D;">${formatPaise(report.total_saved_paise)}</td></tr>
          <tr><td style="padding:8px 0;color:#5B6470;">At risk (ordered despite stock)</td><td style="text-align:right;font-weight:700;color:#DC2626;">${formatPaise(report.total_at_risk_paise)}</td></tr>
          <tr><td style="padding:8px 0;color:#5B6470;">Accepted vs overridden</td><td style="text-align:right;font-weight:600;">${report.accepted_count} / ${report.overridden_count}</td></tr>
        </table>
        <p style="color:#8A929D;font-size:12px;">${company.company_name} · automated by Krayam from the savings ledger</p>
      </div>`,
    });
    sent.push({ org_id: org.id, recipients: recipients.length });
  }

  return NextResponse.json({ ok: true, month: monthLabel, orgs_emailed: sent.length, sent });
}
