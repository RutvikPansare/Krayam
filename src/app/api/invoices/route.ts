import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionOrgId } from "@/lib/org";
import { contentHash, checkContentDuplicate } from "@/lib/invoice-dedupe";
import { processInvoice } from "@/lib/invoice-pipeline";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED: Record<string, RegExp> = {
  "application/pdf": /\.pdf$/i,
  "image/png": /\.png$/i,
  "image/jpeg": /\.jpe?g$/i,
};

/**
 * Feature 12 — manual invoice upload (purchase team via dashboard).
 *
 * The flow:
 *   1. Validate the file (type, size).
 *   2. Compute the content hash and BLOCK a byte-identical duplicate BEFORE any
 *      OCR cost is spent (spec: dedupe before extraction).
 *   3. Store the file, create the invoice in status `received`.
 *   4. Kick off the server-side pipeline fire-and-forget so the UI returns
 *      immediately — extraction, fraud checks and matching run in the
 *      background and advance the invoice's status.
 */
export async function POST(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const poId = (form?.get("po_id") as string) || null;
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });

  const mime = file.type;
  const extOk = ACCEPTED[mime]?.test(file.name);
  if (!extOk) {
    return NextResponse.json({ error: "Only PDF, PNG or JPEG invoices are accepted." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large — maximum 15 MB." }, { status: 413 });

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });

  // 2. Pre-OCR duplicate block (byte-identical re-send).
  const hash = contentHash(bytes);
  const dup = await checkContentDuplicate({ orgId, contentHash: hash });
  if (dup.duplicate) {
    return NextResponse.json(
      { error: "Duplicate invoice — this exact file has already been received.", duplicate: true, existing_invoice_id: dup.existingInvoiceId, detail: dup.detail },
      { status: 409 },
    );
  }

  const supabase = createAdminClient();
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("invoices").upload(path, bytes, { contentType: mime });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      org_id: orgId,
      po_id: poId,
      source: "upload",
      file_name: file.name,
      storage_path: path,
      content_hash: hash,
      status: "received",
    })
    .select("id")
    .single();
  if (invErr || !invoice) {
    await supabase.storage.from("invoices").remove([path]);
    return NextResponse.json({ error: invErr?.message ?? "Invoice insert failed" }, { status: 500 });
  }

  // 4. Background processing — do not block the UI.
  void processInvoice(invoice.id);

  return NextResponse.json({ ok: true, id: invoice.id, status: "received" }, { status: 202 });
}
