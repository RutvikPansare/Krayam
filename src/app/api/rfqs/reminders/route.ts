import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createToken } from "@/lib/tokens";
import { sendEmail, rfqEmailHtml } from "@/lib/email";

export const dynamic = "force-dynamic";

const COMPANY_NAME = process.env.COMPANY_NAME || "Krayam Manufacturing";

/**
 * RFQ housekeeping cron — run hourly:
 *
 *   vercel.json: { "path": "/api/rfqs/reminders", "schedule": "0 * * * *" }
 *
 * 1. Vendors invited >24h ago with no quote and no reminder yet get one
 *    reminder email (fresh token, same deadline).
 * 2. RFQs past their 48h deadline close out: non-responding vendors are
 *    marked no_response; the RFQ flips to quotes_in if at least one quote
 *    arrived, otherwise the purchase officer is alerted.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`;
 * manual callers can use ?key=.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const authed =
    !secret ||
    req.headers.get("authorization") === `Bearer ${secret}` ||
    url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || url.origin;
  const quoteTtlHours = Number(process.env.QUOTE_TOKEN_TTL_HOURS || "72");
  const officerEmail = process.env.PURCHASE_OFFICER_EMAIL;
  const now = new Date();

  let remindersSent = 0;
  let rfqsClosed = 0;

  // ── 1. 24h reminders ──
  const dayAgo = new Date(now.getTime() - 24 * 3600000).toISOString();
  const { data: pending } = await supabase
    .from("rfq_vendors")
    .select("id, vendor_id, rfq_id, email_sent_at, vendors(name, email), rfqs(id, rfq_number, due_at, status, pr_id, purchase_requests(pr_number))")
    .in("status", ["sent", "delivered", "opened"])
    .is("reminded_at", null)
    .lt("email_sent_at", dayAgo);

  for (const rv of pending ?? []) {
    const rfq = (rv as any).rfqs;
    const vendor = (rv as any).vendors;
    if (!rfq || !vendor || rfq.status !== "sent") continue;
    if (rfq.due_at && new Date(rfq.due_at) < now) continue; // past deadline — closing below, not reminding

    const { data: items } = await supabase
      .from("pr_items").select("item_name, quantity, unit, notes").eq("pr_id", rfq.pr_id).order("created_at");
    const token = createToken({ kind: "quote", id: rv.id, email: vendor.email }, quoteTtlHours / 24);
    const dueLabel = rfq.due_at
      ? new Date(rfq.due_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST"
      : null;

    try {
      await sendEmail({
        to: vendor.email,
        subject: `[Reminder] ${rfq.rfq_number} — quote closes ${dueLabel ?? "soon"}`,
        html: rfqEmailHtml({
          vendorName: vendor.name,
          rfqNumber: rfq.rfq_number,
          companyName: COMPANY_NAME,
          dueDate: dueLabel,
          items: items ?? [],
          quoteUrl: `${origin}/quote/${token}`,
        }),
      });
      await supabase.from("rfq_vendors").update({ reminded_at: now.toISOString() }).eq("id", rv.id);
      await supabase.from("rfq_log").insert({
        rfq_id: rfq.id, rfq_vendor_id: rv.id, vendor_id: rv.vendor_id, event: "reminder_sent",
      });
      remindersSent++;
    } catch (err) {
      console.error(`Reminder to ${vendor.email} failed:`, err);
    }
  }

  // ── 2. Close RFQs past deadline ──
  const { data: dueRfqs } = await supabase
    .from("rfqs")
    .select("id, rfq_number, pr_id, quotes(id)")
    .eq("status", "sent")
    .lt("due_at", now.toISOString());

  for (const rfq of dueRfqs ?? []) {
    const quoteCount = ((rfq as any).quotes ?? []).length;

    const { data: silent } = await supabase
      .from("rfq_vendors")
      .update({ status: "no_response" })
      .eq("rfq_id", rfq.id)
      .in("status", ["sent", "delivered", "opened"])
      .select("id, vendor_id");
    for (const rv of silent ?? []) {
      await supabase.from("rfq_log").insert({
        rfq_id: rfq.id, rfq_vendor_id: rv.id, vendor_id: rv.vendor_id, event: "closed_no_response",
      });
    }

    if (quoteCount > 0) {
      await supabase.from("rfqs").update({ status: "quotes_in" }).eq("id", rfq.id);
      await supabase.from("purchase_requests").update({ status: "quotes_in" }).eq("id", rfq.pr_id);
    } else if (officerEmail) {
      await sendEmail({
        to: officerEmail,
        subject: `[Krayam] ${rfq.rfq_number} closed with zero quotes`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
          <h2 style="color:#0B2239;margin:0 0 8px;">No quotes received</h2>
          <p style="color:#5B6470;font-size:14px;">${rfq.rfq_number} passed its deadline with no vendor responses. Consider calling vendors directly or re-sending the RFQ.</p>
        </div>`,
      });
    }
    rfqsClosed++;
  }

  return NextResponse.json({ ok: true, reminders_sent: remindersSent, rfqs_closed: rfqsClosed });
}
