/**
 * Nightly material master sync (Feature 07).
 *
 *   1. Read the per-org delta cursor (material_sync_state.last_synced_at).
 *   2. Pull only materials changed since then from SAP (fetchChangedMaterials).
 *   3. UPSERT by (org_id, material_code) — re-running never duplicates.
 *   4. Generate embeddings for new/changed descriptions and write them back.
 *      Embedding is best-effort: if the provider is slow or down, the upsert
 *      still commits and the row simply has no vector yet (next run retries).
 *   5. Advance the cursor to the newest sap_changed_at seen.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchChangedMaterials, type SapMaterial } from "@/lib/sap-materials";
import { embedTexts, toVectorLiteral, embeddingsEnabled } from "@/lib/embeddings";

export interface SyncResult {
  org_id: string;
  pulled: number;
  upserted: number;
  embedded: number;
  embed_skipped: boolean;
  cursor: string | null;
  error?: string;
}

const EMBED_BATCH = 100;

export async function syncMaterials(orgId: string): Promise<SyncResult> {
  const admin = createAdminClient();

  const { data: state } = await admin
    .from("material_sync_state")
    .select("last_synced_at")
    .eq("org_id", orgId)
    .maybeSingle();
  const since = state?.last_synced_at ?? null;

  let pulled: SapMaterial[] = [];
  try {
    pulled = await fetchChangedMaterials(orgId, since);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "SAP pull failed";
    await admin.from("material_sync_state").upsert({
      org_id: orgId, last_run_at: new Date().toISOString(), last_status: "error", last_error: msg,
    });
    return { org_id: orgId, pulled: 0, upserted: 0, embedded: 0, embed_skipped: true, cursor: since, error: msg };
  }

  if (pulled.length === 0) {
    await admin.from("material_sync_state").upsert({
      org_id: orgId, last_run_at: new Date().toISOString(), last_status: "ok", last_error: null,
    });
    return { org_id: orgId, pulled: 0, upserted: 0, embedded: 0, embed_skipped: !embeddingsEnabled(), cursor: since };
  }

  // ── Upsert (no duplicates on re-run) ──
  const now = new Date().toISOString();
  const { error: upErr } = await admin
    .from("materials")
    .upsert(
      pulled.map((m) => ({
        org_id: orgId,
        material_code: m.material_code,
        description: m.description,
        unit: m.unit,
        unit_price: m.unit_price,
        stock: m.stock,
        category: m.category,
        sap_changed_at: m.sap_changed_at,
        updated_at: now,
      })),
      { onConflict: "org_id,material_code" },
    );
  if (upErr) {
    await admin.from("material_sync_state").upsert({
      org_id: orgId, last_run_at: now, last_status: "error", last_error: upErr.message,
    });
    return { org_id: orgId, pulled: pulled.length, upserted: 0, embedded: 0, embed_skipped: true, cursor: since, error: upErr.message };
  }

  // ── Embeddings (async, best-effort — never blocks the sync) ──
  let embedded = 0;
  const embedSkipped = !embeddingsEnabled();
  if (!embedSkipped) {
    // Rows with no embedding (new) or whose description changed (the trigger
    // nulled embedding_text) need (re)embedding.
    const { data: stale } = await admin
      .from("materials")
      .select("material_code, description")
      .eq("org_id", orgId)
      .or("embedding.is.null,embedding_text.is.null")
      .limit(1000);
    const toEmbed = stale ?? [];

    for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
      const batch = toEmbed.slice(i, i + EMBED_BATCH);
      const vectors = await embedTexts(batch.map((m) => m.description));
      if (vectors.length !== batch.length) break; // provider failed; leave for next run
      await Promise.all(
        batch.map((m, j) =>
          admin
            .from("materials")
            .update({ embedding: toVectorLiteral(vectors[j]), embedding_text: m.description })
            .eq("org_id", orgId)
            .eq("material_code", m.material_code),
        ),
      );
      embedded += batch.length;
    }
  }

  // ── Advance cursor to the newest change pulled ──
  const cursor = pulled.reduce((max, m) => (m.sap_changed_at > max ? m.sap_changed_at : max), since ?? "1970-01-01T00:00:00Z");
  await admin.from("material_sync_state").upsert({
    org_id: orgId, last_synced_at: cursor, last_run_at: now, last_status: "ok", last_error: null,
  });

  return { org_id: orgId, pulled: pulled.length, upserted: pulled.length, embedded, embed_skipped: embedSkipped, cursor };
}
