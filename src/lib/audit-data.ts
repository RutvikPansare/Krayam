import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptField, decryptInt } from "@/lib/crypto";

/**
 * Single org-scoped, decrypted read of an audit run's results. Used by the
 * detail API, CSV export and PDF report so decryption + tenant isolation live
 * in exactly one place.
 */

export interface DecryptedMember {
  material_code: string;
  description: string | null;
  unit: string | null;
  stock_qty: number;
  stock_value_paise: number;
  unit_price_paise: number;
  similarity_to_primary: number;
  is_primary: boolean;
}
export interface DecryptedCluster {
  id: string;
  label: string;
  cohesion: number;
  primary_code: string;
  member_count: number;
  duplicate_value_paise: number;
  review_status: string;
  members: DecryptedMember[];
}

export async function getAuditReportData(admin: SupabaseClient, runId: string, orgId: string) {
  const { data: run } = await admin.from("audit_runs").select("*").eq("id", runId).eq("org_id", orgId).maybeSingle();
  if (!run) return null;

  const { data: rows } = await admin
    .from("audit_clusters")
    .select("*, audit_cluster_members(material_code, description, description_enc, unit, stock_qty, stock_value_paise, stock_value_enc, unit_price_paise, similarity_to_primary, is_primary)")
    .eq("run_id", runId)
    .eq("org_id", orgId)
    .order("duplicate_value_paise", { ascending: false });

  const clusters: DecryptedCluster[] = (rows ?? []).map((c: any) => ({
    id: c.id, label: c.label, cohesion: Number(c.cohesion), primary_code: c.primary_code,
    member_count: c.member_count, duplicate_value_paise: Number(c.duplicate_value_paise), review_status: c.review_status,
    members: (c.audit_cluster_members ?? []).map((m: any): DecryptedMember => ({
      material_code: m.material_code,
      // prefer encrypted column; fall back to any legacy plaintext
      description: m.description_enc != null ? decryptField(m.description_enc) : (m.description ?? null),
      unit: m.unit ?? null,
      stock_qty: Number(m.stock_qty ?? 0),
      stock_value_paise: m.stock_value_enc != null ? decryptInt(m.stock_value_enc) : Number(m.stock_value_paise ?? 0),
      unit_price_paise: Number(m.unit_price_paise ?? 0),
      similarity_to_primary: Number(m.similarity_to_primary ?? 1),
      is_primary: !!m.is_primary,
    })),
  }));

  return { run, clusters };
}
