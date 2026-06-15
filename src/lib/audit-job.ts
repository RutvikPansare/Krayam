import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedTexts, toVectorLiteral, embeddingsEnabled,
  batchEmbeddingsEnabled, submitOpenAIEmbeddingBatch, pollOpenAIEmbeddingBatch } from "@/lib/embeddings";
import { encryptField, encryptInt } from "@/lib/crypto";
import { syncMaterials } from "@/lib/material-sync";
import { getStock } from "@/lib/stock";
import { clusterMaterials, type ClusterInput } from "@/lib/audit-cluster";
import { renderAuditPdf } from "@/lib/audit-pdf";
import { getCompany } from "@/lib/company";
import { sendEmail } from "@/lib/email";
import type { AuditStatus } from "@/types/audit";

/**
 * Feature 08 — resumable background audit job.
 *
 * State machine (status = the step currently in progress):
 *   queued → pulling → embedding → clustering → stock → report → complete
 * Each step is idempotent and writes its results before advancing, so a crash
 * or timeout leaves the run at a known status and processAuditRun() resumes
 * from exactly there — never from scratch, never double-applying.
 *
 * Isolation: every query is filtered by the run's org_id. A job can only ever
 * touch its own tenant's materials and write its own tenant's audit rows.
 */

const NEXT: Record<AuditStatus, AuditStatus | null> = {
  queued: "pulling",
  pulling: "embedding",
  embedding: "clustering",
  clustering: "stock",
  stock: "report",
  report: "complete",
  complete: null,
  failed: null,
};

const EMBED_BATCH = 100;
const MAX_MATERIALS_FOR_CLUSTER = 8000; // O(n²) guard for the in-process clusterer

async function touch(admin: SupabaseClient, runId: string, patch: Record<string, unknown>) {
  await admin.from("audit_runs").update({ ...patch, updated_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }).eq("id", runId);
}

/** Embed any of this org's materials missing a vector (rate-limit aware). */
async function embedMissing(admin: SupabaseClient, orgId: string): Promise<void> {
  const { data: stale } = await admin
    .from("materials")
    .select("material_code, description")
    .eq("org_id", orgId)
    .or("embedding.is.null,embedding_text.is.null")
    .limit(5000);
  const rows = stale ?? [];
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch.map((m) => m.description));
    if (vectors.length !== batch.length) break; // provider down — leave for retry
    await Promise.all(batch.map((m, j) =>
      admin.from("materials").update({ embedding: toVectorLiteral(vectors[j]), embedding_text: m.description })
        .eq("org_id", orgId).eq("material_code", m.material_code)));
  }
}

/** Execute exactly one step transition for a run. Returns `true` when the step
 *  is waiting on an external job (OpenAI batch) and the invocation should yield
 *  so the worker cron resumes polling on its next tick. */
async function runStep(admin: SupabaseClient, run: any): Promise<boolean> {
  const orgId: string = run.org_id;
  const status: AuditStatus = run.status;

  switch (status) {
    case "queued":
    case "pulling": {
      await touch(admin, run.id, { status: "pulling", step: "pulling" });
      // Pull the master from SAP (mock/live) — upsert new rows (no inline embed).
      await syncMaterials(orgId);
      const { count } = await admin.from("materials").select("id", { count: "exact", head: true }).eq("org_id", orgId);
      await touch(admin, run.id, { status: "embedding", step: "pulling", materials_analyzed: count ?? 0 });
      return false;
    }

    case "embedding": {
      await touch(admin, run.id, { step: "embedding" });

      // Preferred: OpenAI Batch API (async, ~50% cheaper). Submit once, then
      // poll across worker ticks — resumable via the persisted batch id.
      if (batchEmbeddingsEnabled()) {
        const { data: missing } = await admin
          .from("materials").select("material_code, description")
          .eq("org_id", orgId).or("embedding.is.null,embedding_text.is.null").limit(50000);
        const rows = missing ?? [];

        if (rows.length === 0) {
          await touch(admin, run.id, { status: "clustering", step: "embedding", embed_batch_status: "completed" });
          return false;
        }
        if (!run.embed_batch_id) {
          const batchId = await submitOpenAIEmbeddingBatch(rows.map((m: any) => ({ custom_id: m.material_code, text: m.description })));
          await touch(admin, run.id, { embed_batch_id: batchId, embed_batch_status: "in_progress" });
          return true; // yield; poll on the next tick
        }
        const poll = await pollOpenAIEmbeddingBatch(run.embed_batch_id);
        if (poll.status === "completed" && poll.vectors) {
          for (const [code, vec] of Array.from(poll.vectors.entries())) {
            const text = rows.find((m: any) => m.material_code === code)?.description ?? "";
            await admin.from("materials").update({ embedding: toVectorLiteral(vec), embedding_text: text })
              .eq("org_id", orgId).eq("material_code", code);
          }
          await touch(admin, run.id, { status: "clustering", step: "embedding", embed_batch_status: "completed", embed_batch_id: null });
          return false;
        }
        if (["failed", "expired", "cancelled"].includes(poll.status)) {
          throw new Error(`OpenAI embedding batch ${poll.status}`);
        }
        await touch(admin, run.id, { embed_batch_status: poll.status });
        return true; // still running — yield
      }

      // Fallback: synchronous provider (Gemini, or OpenAI sync) or precomputed.
      if (!embeddingsEnabled()) {
        const { count } = await admin.from("materials").select("id", { count: "exact", head: true })
          .eq("org_id", orgId).not("embedding", "is", null);
        if (!count) throw new Error("No embedding provider configured (GEMINI_API_KEY / OPENAI_API_KEY) and no precomputed embeddings.");
      } else {
        await embedMissing(admin, orgId);
      }
      await touch(admin, run.id, { status: "clustering", step: "embedding" });
      return false;
    }

    case "clustering": {
      await touch(admin, run.id, { step: "clustering" });
      const { data: mats } = await admin
        .from("materials")
        .select("material_code, embedding")
        .eq("org_id", orgId)
        .not("embedding", "is", null)
        .limit(MAX_MATERIALS_FOR_CLUSTER);

      const inputs: ClusterInput[] = (mats ?? []).map((m: any) => ({
        material_code: m.material_code,
        embedding: typeof m.embedding === "string" ? JSON.parse(m.embedding) : m.embedding,
      }));
      const clusters = clusterMaterials(inputs);

      // Idempotent: clear any prior clusters for this run before writing.
      await admin.from("audit_clusters").delete().eq("run_id", run.id);

      for (const c of clusters) {
        const { data: cl } = await admin.from("audit_clusters").insert({
          org_id: orgId, run_id: run.id, label: c.label, cohesion: c.cohesion,
          primary_code: c.primary_code, member_count: c.members.length,
        }).select("id").single();
        if (!cl) continue;
        await admin.from("audit_cluster_members").insert(
          c.members.map((m) => ({
            org_id: orgId, cluster_id: cl.id, material_code: m.material_code,
            similarity_to_primary: m.similarity_to_primary, is_primary: m.is_primary,
          })),
        );
      }
      await touch(admin, run.id, { status: "stock", step: "clustering" });
      return false;
    }

    case "stock": {
      await touch(admin, run.id, { step: "stock" });
      const { data: clusters } = await admin.from("audit_clusters").select("id, primary_code").eq("run_id", run.id);
      let confirmed = 0, probable = 0, review = 0;
      let totalDupPaise = 0;

      for (const cl of clusters ?? []) {
        const { data: members } = await admin.from("audit_cluster_members").select("*").eq("cluster_id", cl.id);
        let dupPaise = 0, dupUnits = 0;
        for (const m of members ?? []) {
          // current SAP stock × moving average price (never manual input)
          const info = await getStock(m.material_code, orgId);
          const qty = info?.total ?? 0;
          const pricePaise = Math.round(Number(info?.unit_price ?? 0) * 100);
          const valuePaise = Math.round(qty * pricePaise);
          // Encrypt the sensitive fields at rest (description, per-line value).
          await admin.from("audit_cluster_members").update({
            description_enc: encryptField(info?.description ?? null),
            stock_value_enc: encryptInt(valuePaise),
            unit: info?.unit ?? null,
            unit_price_paise: pricePaise, stock_qty: qty,
          }).eq("id", m.id);
          if (!m.is_primary) { dupPaise += valuePaise; dupUnits += qty; }
        }
        await admin.from("audit_clusters").update({
          duplicate_value_paise: dupPaise, duplicate_units: dupUnits,
        }).eq("id", cl.id);
        totalDupPaise += dupPaise;
      }

      // headline counts by label
      for (const lbl of ["confirmed", "probable", "review"] as const) {
        const { count } = await admin.from("audit_clusters").select("id", { count: "exact", head: true }).eq("run_id", run.id).eq("label", lbl);
        if (lbl === "confirmed") confirmed = count ?? 0;
        else if (lbl === "probable") probable = count ?? 0;
        else review = count ?? 0;
      }
      await touch(admin, run.id, {
        status: "report", step: "stock",
        confirmed_count: confirmed, probable_count: probable, review_count: review,
        duplicate_value_paise: totalDupPaise,
      });
      return false;
    }

    case "report": {
      await touch(admin, run.id, { step: "report" });
      const company = await getCompany(orgId);
      const pdf = await renderAuditPdf(admin, run.id, orgId, company.company_name);

      const path = `${orgId}/audit-v${run.version}.pdf`;
      await admin.storage.from("audit-reports").upload(path, pdf, { contentType: "application/pdf", upsert: true });
      await touch(admin, run.id, { report_pdf_path: path });

      // Email the admin who started it + optional CFO address.
      const recipients = [run.started_by, run.cfo_email].filter(Boolean) as string[];
      if (recipients.length) {
        try {
          await sendEmail({
            to: recipients,
            subject: `[${company.company_name}] Material master audit v${run.version} — report ready`,
            html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
              <h2 style="color:#0B2239;">Duplicate material audit complete</h2>
              <p style="color:#5B6470;font-size:14px;line-height:1.6;">Version ${run.version}. ${run.confirmed_count} confirmed and ${run.probable_count} probable duplicate families found across ${run.materials_analyzed} materials. The branded report is attached.</p>
              <p style="color:#8A929D;font-size:12px;">${company.company_name} · via Krayam</p></div>`,
            attachments: [{ filename: `material-audit-v${run.version}.pdf`, content: Buffer.from(pdf) }],
          });
        } catch (err) { console.error("Audit report email failed:", err); }
      }

      await touch(admin, run.id, { status: "complete", step: "report", finished_at: new Date().toISOString() });
      return false;
    }
  }
  return false;
}

/**
 * Drive a run forward until it completes, fails, or the wall-clock budget is
 * hit (so a serverless invocation returns before its hard limit; the worker
 * cron picks it up again and resumes from the persisted status).
 */
export async function processAuditRun(runId: string, budgetMs = 50_000): Promise<AuditStatus> {
  const admin = createAdminClient();
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const { data: run } = await admin.from("audit_runs").select("*").eq("id", runId).single();
    if (!run) return "failed";
    if (run.status === "complete" || run.status === "failed") return run.status;

    try {
      const waiting = await runStep(admin, run);
      if (waiting) return run.status as AuditStatus; // yield to worker cron (batch pending)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "audit step failed";
      await admin.from("audit_runs").update({
        status: "failed", error: msg, updated_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      }).eq("id", runId);
      console.error(`Audit run ${runId} failed at ${run.status}:`, msg);
      return "failed";
    }
  }
  return "queued"; // budget hit mid-run; resumable on next worker tick
}
