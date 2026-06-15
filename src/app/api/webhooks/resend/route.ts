import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Resend delivery webhooks → per-vendor RFQ tracking.
 * Subscribe to email.delivered and email.opened in the Resend dashboard,
 * pointing at this route. Events are matched to rfq_vendors through the
 * provider_message_id captured in rfq_log at send time.
 *
 * Signature: Resend uses svix. Verification is HMAC-SHA256 over
 * "{svix-id}.{svix-timestamp}.{body}" with the base64 secret after the
 * "whsec_" prefix. Set RESEND_WEBHOOK_SECRET; if unset, events are accepted
 * unverified (dev only — set the secret in production).
 */

function verifySvix(req: Request, body: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true; // dev mode
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigHeader = req.headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  // reject events older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  // header form: "v1,<base64sig> v1,<base64sig> ..."
  return sigHeader.split(" ").some((part) => {
    const sig = part.split(",")[1];
    if (!sig || sig.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySvix(req, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(body) as { type: string; data?: { email_id?: string } };
  const emailId = event.data?.email_id;
  const map: Record<string, { status: string; tsField: "delivered_at" | "opened_at" }> = {
    "email.delivered": { status: "delivered", tsField: "delivered_at" },
    "email.opened": { status: "opened", tsField: "opened_at" },
  };
  const m = map[event.type];
  if (!m || !emailId) return NextResponse.json({ ok: true, ignored: event.type });

  const supabase = createAdminClient();
  const { data: logRow } = await supabase
    .from("rfq_log")
    .select("rfq_id, rfq_vendor_id, vendor_id")
    .eq("provider_message_id", emailId)
    .eq("event", "sent")
    .maybeSingle();
  if (!logRow?.rfq_vendor_id) return NextResponse.json({ ok: true, unmatched: emailId });

  // opened outranks delivered; never downgrade, never overwrite a quote_received
  const allowedFrom = m.status === "delivered" ? ["sent"] : ["sent", "delivered"];
  await supabase
    .from("rfq_vendors")
    .update({ status: m.status, [m.tsField]: new Date().toISOString() })
    .eq("id", logRow.rfq_vendor_id)
    .in("status", allowedFrom);

  await supabase.from("rfq_log").insert({
    rfq_id: logRow.rfq_id,
    rfq_vendor_id: logRow.rfq_vendor_id,
    vendor_id: logRow.vendor_id,
    event: m.status,
    provider_message_id: emailId,
  });

  return NextResponse.json({ ok: true });
}
