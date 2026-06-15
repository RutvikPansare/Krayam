import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentHash, checkContentDuplicate } from "@/lib/invoice-dedupe";
import { processInvoice } from "@/lib/invoice-pipeline";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);

/**
 * Feature 12 — inbound invoice email ingestion (vendor → dedicated inbox).
 *
 * Each customer gets its OWN unguessable inbox address — e.g.
 * inv-<token>@in.krayam.app — and the mail provider forwards inbound mail to
 * this route as JSON, with the token in the path. Because the token is
 * per-org, one tenant's vendor email can never be processed into another
 * tenant's queue (isolation requirement).
 *
 * The first PDF/PNG/JPEG attachment is treated as the invoice. The same
 * pre-OCR duplicate block as manual upload applies, then the server-side
 * pipeline runs in the background.
 *
 * Payload shape (provider-agnostic; matches Resend / Mailgun inbound):
 *   { from, subject, attachments: [{ filename, content_type|contentType, content(base64) }] }
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();

  // Resolve the org from the dedicated inbox token (tenant isolation).
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("invoice_inbox_token", params.token)
    .maybeSingle();
  if (!org) return NextResponse.json({ error: "Unknown inbox" }, { status: 404 });

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const attachments: any[] = payload.attachments ?? payload.data?.attachments ?? [];
  const att = attachments.find((a) => ACCEPTED.has((a.content_type ?? a.contentType ?? "").toLowerCase()));
  if (!att) {
    // Acknowledge so the provider does not retry; nothing actionable to process.
    return NextResponse.json({ ok: true, ignored: "no invoice attachment" });
  }

  const mimeRaw = (att.content_type ?? att.contentType ?? "application/pdf").toLowerCase();
  const mime = mimeRaw === "image/jpg" ? "image/jpeg" : mimeRaw;
  const bytes = Buffer.from(String(att.content ?? ""), "base64");
  if (bytes.length === 0) return NextResponse.json({ ok: true, ignored: "empty attachment" });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "Attachment too large" }, { status: 413 });

  // Pre-OCR duplicate block.
  const hash = contentHash(bytes);
  const dup = await checkContentDuplicate({ orgId: org.id, contentHash: hash });
  if (dup.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true, existing_invoice_id: dup.existingInvoiceId });
  }

  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage.from("invoices").upload(path, bytes, { contentType: mime });
  if (upErr) return NextResponse.json({ error: `Storage failed: ${upErr.message}` }, { status: 500 });

  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .insert({
      org_id: org.id,
      source: "email",
      file_name: att.filename ?? `invoice.${ext}`,
      storage_path: path,
      content_hash: hash,
      status: "received",
    })
    .select("id")
    .single();
  if (invErr || !invoice) {
    await admin.storage.from("invoices").remove([path]);
    return NextResponse.json({ error: invErr?.message ?? "Insert failed" }, { status: 500 });
  }

  void processInvoice(invoice.id);
  return NextResponse.json({ ok: true, id: invoice.id, status: "received" });
}
