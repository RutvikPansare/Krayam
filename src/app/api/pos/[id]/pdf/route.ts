import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionOrgId } from "@/lib/org";
import { ensurePoPdf } from "@/lib/po-pipeline";

export const dynamic = "force-dynamic";

/**
 * Feature 06 — download the PO PDF.
 * Serves the copy stored in Supabase Storage; only generates (once) if the
 * PO predates storage or the saga's PDF step had failed. The PDF is never
 * regenerated on a normal download.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, po_number")
    .eq("id", params.id)
    .eq("org_id", orgId)   // tenant isolation — no cross-org PDF download
    .maybeSingle();
  if (!po) return NextResponse.json({ error: "PO not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    // Returns the stored PDF when present, generates + stores it otherwise.
    ({ buffer } = await ensurePoPdf(supabase, po.id));
  } catch (err) {
    console.error("PO PDF fetch/generate failed:", err);
    return NextResponse.json({ error: "Could not produce the PO PDF" }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${po.po_number}.pdf"`,
    },
  });
}
