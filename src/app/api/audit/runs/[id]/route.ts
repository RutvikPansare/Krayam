// GET /api/audit/runs/[id] — full audit result for review (org-scoped):
// run headline + clusters + members. Powers the human-review interface.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionOrgId } from "@/lib/org";
import { getAuditReportData } from "@/lib/audit-data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const admin = createAdminClient();
  const data = await getAuditReportData(admin, params.id, orgId); // org-scoped + decrypted
  if (!data) return NextResponse.json({ error: "Audit run not found" }, { status: 404 });

  // Re-shape members under the key the review UI expects.
  const clusters = data.clusters.map((c) => ({ ...c, audit_cluster_members: c.members }));
  return NextResponse.json({ run: data.run, clusters });
}
