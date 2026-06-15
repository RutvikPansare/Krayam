import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSessionOrgId } from "@/lib/org";
import { ATTACH_BUCKET, SIGNED_URL_TTL_S } from "@/lib/attachments";

export const dynamic = "force-dynamic";

/**
 * Feature 11 — attachment access (dashboard).
 *
 * GET ?id=    — 302 to a fresh 7-day signed URL (never a public URL). Calling
 *               this again regenerates the link if a vendor's copy expired.
 * DELETE ?id= — soft delete: the row is marked deleted_at; the file stays in
 *               storage for audit.
 *
 * Uploads no longer proxy through here — the browser uploads directly to
 * storage via a presigned URL (POST /api/attachments/sign + .../confirm).
 */
export async function GET(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: att } = await supabase
    .from("pr_attachments").select("storage_path, org_id, deleted_at").eq("id", id).maybeSingle();
  if (!att || att.org_id !== orgId) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  if (att.deleted_at) return NextResponse.json({ error: "This attachment was removed." }, { status: 410 });

  const { data: signed } = await supabase.storage.from(ATTACH_BUCKET).createSignedUrl(att.storage_path, SIGNED_URL_TTL_S);
  if (!signed?.signedUrl) return NextResponse.json({ error: "Could not generate link" }, { status: 500 });

  // ?format=json — return the signed URL so the officer can copy/re-issue it
  // to a vendor whose link expired. Default: 302 to open/download in-browser.
  if (new URL(req.url).searchParams.get("format") === "json") {
    return NextResponse.json({
      signed_url: signed.signedUrl,
      expires_at: new Date(Date.now() + SIGNED_URL_TTL_S * 1000).toISOString(),
    });
  }
  return NextResponse.redirect(signed.signedUrl);
}

export async function DELETE(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createAdminClient();
  // Soft delete only — file is preserved in storage for audit.
  const { error } = await supabase
    .from("pr_attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId)
    .is("deleted_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
