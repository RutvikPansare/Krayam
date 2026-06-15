// POST /api/attachments/sign — issue a presigned URL so the browser uploads
// the file DIRECTLY to private storage (never proxied through this API).
// Creates a staging row; the browser then confirms via .../[id]/confirm.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgId, getSessionOrgId } from "@/lib/org";
import { ATTACH_BUCKET, MAX_ATTACH_BYTES, MAX_ATTACH_PER_PR, allowedExt, buildStoragePath } from "@/lib/attachments";
import type { UploadGrant } from "@/types/attachments";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // The PR form is PUBLIC (shop-floor engineers, no login) — resolve the
  // install org. An authenticated officer's session org takes precedence and
  // is recorded as the uploader.
  let orgId: string | null = await getSessionOrgId();
  let uploadedBy: string | null = null;
  if (orgId) {
    const supa = await createClient();
    uploadedBy = (await supa.auth.getUser()).data.user?.email ?? null;
  } else {
    try { orgId = await getOrgId(); } catch { orgId = null; }
  }
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const fileName: string = body?.file_name ?? "";
  const sizeBytes = Number(body?.size_bytes ?? 0);
  const stagedCount = Number(body?.staged_count ?? 0); // already-staged in this form session

  const type = allowedExt(fileName);
  if (!type) return NextResponse.json({ error: "Only PDF, PNG, JPG and DWG files are accepted." }, { status: 415 });
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return NextResponse.json({ error: "Invalid file." }, { status: 400 });
  if (sizeBytes > MAX_ATTACH_BYTES) return NextResponse.json({ error: "File too large — maximum 10 MB." }, { status: 413 });
  if (stagedCount >= MAX_ATTACH_PER_PR) return NextResponse.json({ error: `Maximum ${MAX_ATTACH_PER_PR} attachments per request.` }, { status: 409 });

  const supabase = createAdminClient();
  const storagePath = buildStoragePath(orgId, null, fileName); // <org>/staging/<uuid>.<ext>

  const { data: signed, error: signErr } = await supabase.storage
    .from(ATTACH_BUCKET).createSignedUploadUrl(storagePath);
  if (signErr || !signed) return NextResponse.json({ error: signErr?.message ?? "Could not presign upload" }, { status: 500 });

  // Staging row — checksum_verified stays false until confirm validates bytes.
  const { data: row, error: dbErr } = await supabase
    .from("pr_attachments")
    .insert({
      org_id: orgId, file_name: fileName, storage_path: storagePath,
      size_bytes: sizeBytes, content_type: type.mime, uploaded_by: uploadedBy, checksum_verified: false,
    })
    .select("id")
    .single();
  if (dbErr || !row) return NextResponse.json({ error: dbErr?.message ?? "Could not stage attachment" }, { status: 500 });

  return NextResponse.json({
    id: row.id, storage_path: storagePath, token: signed.token, signed_url: signed.signedUrl,
  } satisfies UploadGrant);
}
