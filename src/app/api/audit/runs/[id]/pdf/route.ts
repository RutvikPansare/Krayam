// GET /api/audit/runs/[id]/pdf — download the stored branded report (org-scoped).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionOrgId } from "@/lib/org";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const admin = createAdminClient();
  const { data: run } = await admin
    .from("audit_runs").select("version, report_pdf_path").eq("id", params.id).eq("org_id", orgId).maybeSingle();
  if (!run?.report_pdf_path) return NextResponse.json({ error: "Report not ready" }, { status: 404 });

  const { data: blob, error } = await admin.storage.from("audit-reports").download(run.report_pdf_path);
  if (error || !blob) return NextResponse.json({ error: "Report file missing" }, { status: 404 });

  return new NextResponse(new Uint8Array(await blob.arrayBuffer()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="material-audit-v${run.version}.pdf"`,
    },
  });
}
