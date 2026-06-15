import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgId } from "@/lib/org";
import type { MaterialIndexRow } from "@/types/materials";

export const dynamic = "force-dynamic";

const MAX_INDEX = 5000;

/**
 * Feature 07 — lightweight material index for the client-side Fuse.js layer.
 *
 * The PR form fetches this once and runs Fuse locally for instant approximate
 * matches while the debounced semantic (vector) search completes over the
 * network. Tenant-scoped; codes + descriptions only (no stock, no embeddings).
 */
export async function GET() {
  let orgId: string;
  try {
    orgId = await getOrgId();
  } catch {
    return NextResponse.json({ materials: [] as MaterialIndexRow[] });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("materials")
    .select("material_code, description, unit, unit_price")
    .eq("org_id", orgId)
    .limit(MAX_INDEX);

  const materials: MaterialIndexRow[] = (data ?? []).map((m: any) => ({
    material_code: m.material_code,
    description: m.description,
    unit: m.unit,
    unit_price: Number(m.unit_price),
  }));
  return NextResponse.json({ materials });
}
