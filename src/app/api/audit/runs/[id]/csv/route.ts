// GET /api/audit/runs/[id]/csv — full duplicate list as CSV (org-scoped).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionOrgId } from "@/lib/org";
import { getAuditReportData } from "@/lib/audit-data";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const admin = createAdminClient();
  const data = await getAuditReportData(admin, params.id, orgId); // org-scoped + decrypted
  if (!data) return NextResponse.json({ error: "Audit run not found" }, { status: 404 });

  const header = ["cluster", "label", "review_status", "cohesion", "material_code", "description", "unit", "is_primary", "stock_qty", "stock_value_rupees", "similarity_to_primary"];
  const lines = [header.join(",")];
  let idx = 0;
  for (const c of data.clusters) {
    idx++;
    for (const m of c.members) {
      lines.push([
        idx, c.label, c.review_status, c.cohesion.toFixed(3),
        m.material_code, m.description, m.unit, m.is_primary,
        m.stock_qty, (m.stock_value_paise / 100).toFixed(2), m.similarity_to_primary.toFixed(3),
      ].map(csvCell).join(","));
    }
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="material-audit-v${data.run.version}.csv"`,
    },
  });
}
