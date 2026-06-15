// POST /api/attachments/[id]/confirm — after the browser's direct upload,
// validate the ACTUAL bytes server-side (magic-byte sniff + real size). The
// client-declared content type is never trusted. Invalid ⇒ file + row removed.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgId, getSessionOrgId } from "@/lib/org";
import { ATTACH_BUCKET, MAX_ATTACH_BYTES, sniffMime } from "@/lib/attachments";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  // Public PR form path (no login) resolves the install org; an officer's
  // session org takes precedence. Either way the org must match the row.
  let orgId: string | null = await getSessionOrgId();
  if (!orgId) { try { orgId = await getOrgId(); } catch { orgId = null; } }
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: att } = await supabase
    .from("pr_attachments").select("id, org_id, storage_path, file_name").eq("id", params.id).maybeSingle();
  if (!att || att.org_id !== orgId) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  const reject = async (msg: string, code = 415) => {
    await supabase.storage.from(ATTACH_BUCKET).remove([att.storage_path]);
    await supabase.from("pr_attachments").delete().eq("id", att.id); // never-linked staging row
    return NextResponse.json({ error: msg }, { status: code });
  };

  const { data: blob, error } = await supabase.storage.from(ATTACH_BUCKET).download(att.storage_path);
  if (error || !blob) return reject("Uploaded file not found in storage.", 400);

  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.length === 0) return reject("File is empty.", 400);
  if (buf.length > MAX_ATTACH_BYTES) return reject("File too large — maximum 10 MB.", 413);

  const sniffed = sniffMime(buf.subarray(0, 16));
  if (!sniffed) return reject("File content is not a valid PDF/PNG/JPG/DWG (magic-byte check failed).");

  const { data: row, error: upErr } = await supabase
    .from("pr_attachments")
    .update({ checksum_verified: true, content_type: sniffed, size_bytes: buf.length })
    .eq("id", att.id)
    .select("id, file_name, size_bytes, content_type")
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: row.id, file_name: row.file_name, size_bytes: row.size_bytes });
}
