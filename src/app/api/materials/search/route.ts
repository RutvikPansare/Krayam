import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgId } from "@/lib/org";
import { embedText, toVectorLiteral, embeddingsEnabled } from "@/lib/embeddings";
import type { MaterialMatch } from "@/types/materials";

export const dynamic = "force-dynamic";

// Cosine similarity floor for showing a semantic match (spec: 0.82).
const MATCH_THRESHOLD = Number(process.env.MATERIAL_MATCH_THRESHOLD ?? "0.82");
const TOP_N = 3;

/**
 * Feature 07 — semantic duplicate detection at the PR form.
 *
 * Tenant isolation: every query is filtered to the resolved customer_id, both
 * via the RPC argument and the trigram fallback's WHERE — a customer can never
 * see another customer's materials, even though this route runs as the service
 * role on a public (no-login) form.
 *
 * When an embedding provider is configured, results are pgvector cosine
 * matches at/above MATCH_THRESHOLD (index-backed, top 3). With no provider,
 * it degrades to tenant-scoped trigram search so the feature still works.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return NextResponse.json({ results: [], engine: "none" });

  const supabase = createAdminClient();

  let orgId: string;
  try {
    orgId = await getOrgId();
  } catch (err) {
    console.error("Org resolution failed:", err);
    return NextResponse.json({ results: [], engine: "none" });
  }

  // ── Semantic (vector) path ──
  if (embeddingsEnabled()) {
    const vec = await embedText(q);
    if (vec) {
      const { data, error } = await supabase.rpc("match_materials", {
        p_org: orgId,
        query_embedding: toVectorLiteral(vec),
        match_threshold: MATCH_THRESHOLD,
        match_count: TOP_N,
      });
      if (error) {
        console.error("Vector match failed, falling back to trigram:", error.message);
      } else {
        return NextResponse.json({ results: mapResults(data, "vector"), engine: "vector" });
      }
    }
  }

  // ── Trigram fallback (no provider, or embedding failed) ──
  const { data, error } = await supabase.rpc("search_materials", {
    p_org: orgId,
    q,
    max_results: TOP_N,
  });
  if (error) {
    console.error("Material search failed:", error.message);
    return NextResponse.json({ results: [], engine: "none" });
  }
  return NextResponse.json({ results: mapResults(data, "trigram"), engine: "trigram" });
}

function mapResults(rows: any[] | null, source: "vector" | "trigram"): MaterialMatch[] {
  return (rows ?? []).map((m) => ({
    material_code: m.material_code,
    description: m.description,
    unit: m.unit,
    unit_price: Number(m.unit_price),
    score: Number(m.score),
    source,
  }));
}
