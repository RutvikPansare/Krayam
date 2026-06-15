import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionOrgId } from "@/lib/org";
import { findDuplicateClusters, type MaterialRow } from "@/lib/dedupe";

export const dynamic = "force-dynamic";

/**
 * Feature 08 — material master deduplication audit.
 * Scans the materials mirror, clusters duplicates, totals the rupee value
 * of stock held under non-primary codes. Scoped to the caller's org.
 */
export async function GET() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: materials, error } = await supabase
    .from("materials")
    .select("material_code, description, unit, unit_price, stock, category")
    .eq("org_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (materials ?? []) as MaterialRow[];
  const clusters = findDuplicateClusters(rows);

  const duplicateCodes = clusters.reduce((s, c) => s + (c.members.length - 1), 0);
  const duplicateValue = clusters.reduce((s, c) => s + c.duplicateValue, 0);

  return NextResponse.json({
    scanned: rows.length,
    cluster_count: clusters.length,
    duplicate_codes: duplicateCodes,
    duplicate_pct: rows.length ? Math.round((duplicateCodes / rows.length) * 100) : 0,
    duplicate_value: duplicateValue,
    clusters: clusters.map((c) => ({
      primary: c.primary,
      members: c.members,
      duplicate_value: c.duplicateValue,
      duplicate_units: c.duplicateUnits,
    })),
  });
}
