"use client";

import { useEffect, useState, useCallback } from "react";
import { FileDown, ScanSearch, Loader2, Check, X, RefreshCw, Table2 } from "lucide-react";
import { formatPaise } from "@/lib/money";
import type { AuditStatus, ClusterLabel, ReviewStatus } from "@/types/audit";

interface RunSummary {
  id: string; version: number; status: AuditStatus; step: string | null;
  materials_analyzed: number; confirmed_count: number; probable_count: number;
  review_count: number; duplicate_value_paise: number; error: string | null;
  started_at: string; finished_at: string | null;
}
interface Member {
  material_code: string; description: string | null; unit: string | null;
  stock_qty: number; stock_value_paise: number; similarity_to_primary: number; is_primary: boolean;
}
interface Cluster {
  id: string; label: ClusterLabel; cohesion: number; primary_code: string;
  member_count: number; duplicate_value_paise: number; review_status: ReviewStatus;
  audit_cluster_members: Member[];
}

const STEP_LABEL: Record<AuditStatus, string> = {
  queued: "Queued…", pulling: "Pulling material master from SAP…", embedding: "Generating embeddings…",
  clustering: "Clustering duplicates…", stock: "Valuing duplicate stock…", report: "Generating report…",
  complete: "Complete", failed: "Failed",
};
const LABEL_STYLE: Record<ClusterLabel, { bg: string; color: string; text: string }> = {
  confirmed: { bg: "rgba(220,38,38,0.1)", color: "#DC2626", text: "Confirmed" },
  probable:  { bg: "rgba(245,166,35,0.12)", color: "#B97A0A", text: "Probable" },
  review:    { bg: "rgba(20,24,29,0.06)", color: "var(--text-mid)", text: "Needs review" },
};

export default function AuditPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/audit/run");
    const b = await res.json();
    setRuns(b.runs ?? []);
    setActiveId((cur) => cur ?? b.runs?.[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/audit/runs/${id}`);
    const b = await res.json();
    if (res.ok) { setRun(b.run); setClusters(b.clusters ?? []); }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => { if (activeId) loadDetail(activeId); }, [activeId, loadDetail]);

  // Poll while the active run is in progress.
  useEffect(() => {
    if (!run || run.status === "complete" || run.status === "failed") return;
    const t = setInterval(() => { if (activeId) loadDetail(activeId); }, 3000);
    return () => clearInterval(t);
  }, [run, activeId, loadDetail]);

  async function startAudit() {
    setStarting(true); setError(null);
    try {
      const res = await fetch("/api/audit/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? "Could not start audit");
      await loadRuns();
      setActiveId(b.run_id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start audit"); }
    finally { setStarting(false); }
  }

  async function resume() {
    if (!activeId) return;
    await fetch(`/api/audit/runs/${activeId}/resume`, { method: "POST" });
    loadDetail(activeId);
  }

  async function review(clusterId: string, action: "confirm" | "reject") {
    setClusters((prev) => prev.map((c) => c.id === clusterId ? { ...c, review_status: action === "confirm" ? "confirmed" : "rejected" } : c));
    await fetch(`/api/audit/clusters/${clusterId}/review`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
  }

  const inProgress = run && run.status !== "complete" && run.status !== "failed";

  return (
    <div className="p-8 max-w-6xl w-full mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="heading-lg mb-1">Deduplication audit</h1>
          <p className="body-sm">AI-clustered duplicate material families, valued, versioned and reviewable. No SAP changes are made — you confirm each family.</p>
        </div>
        <div className="flex items-center gap-3">
          {runs.length > 1 && (
            <select className="app-input" style={{ width: "auto" }} value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value)}>
              {runs.map((r) => <option key={r.id} value={r.id}>v{r.version} · {new Date(r.started_at).toLocaleDateString("en-IN")}</option>)}
            </select>
          )}
          <button onClick={startAudit} disabled={starting || !!inProgress} className="btn btn-dark" style={{ padding: "10px 18px" }}>
            {starting ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />} Run new audit
          </button>
        </div>
      </div>

      {error && <p style={{ color: "#DC2626", fontSize: 13, marginBottom: 16 }}>{error}</p>}

      {!run && !starting && (
        <div className="card p-10 text-center">
          <p className="body-md" style={{ color: "var(--text-muted)" }}>No audit yet. Run one to scan your material master for duplicates.</p>
        </div>
      )}

      {inProgress && (
        <div className="card p-5 mb-6 flex items-center gap-3" style={{ background: "rgba(11,34,57,0.03)" }}>
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--navy)" }} />
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: "var(--text-dark)" }}>{STEP_LABEL[run!.status]}</p>
            <p className="body-sm">Version {run!.version} · runs in the background — safe to leave the page.</p>
          </div>
        </div>
      )}

      {run?.status === "failed" && (
        <div className="card p-5 mb-6 flex items-center justify-between" style={{ background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.2)" }}>
          <div><p style={{ fontWeight: 700, color: "#DC2626" }}>Audit failed</p><p className="body-sm">{run.error}</p></div>
          <button onClick={resume} className="btn btn-outline" style={{ padding: "8px 14px" }}><RefreshCw size={14} /> Resume</button>
        </div>
      )}

      {run && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Materials analyzed", value: String(run.materials_analyzed) },
              { label: "Confirmed duplicates", value: String(run.confirmed_count), color: "#DC2626" },
              { label: "Probable duplicates", value: String(run.probable_count), color: "#B97A0A" },
              { label: "Value in duplicate stock", value: formatPaise(run.duplicate_value_paise), color: "var(--navy)" },
            ].map((c) => (
              <div key={c.label} className="card p-4">
                <p className="label" style={{ fontSize: 10 }}>{c.label}</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: c.color ?? "var(--text-dark)", marginTop: 4 }}>{c.value}</p>
              </div>
            ))}
          </div>

          {run.status === "complete" && (
            <div className="flex items-center gap-3 mb-6">
              <a href={`/api/audit/runs/${run.id}/pdf`} target="_blank" className="btn btn-dark" style={{ padding: "9px 16px", textDecoration: "none" }}><FileDown size={14} /> PDF report</a>
              <a href={`/api/audit/runs/${run.id}/csv`} target="_blank" className="btn btn-outline" style={{ padding: "9px 16px", textDecoration: "none" }}><Table2 size={14} /> Full CSV</a>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {clusters.map((c) => {
              const s = LABEL_STYLE[c.label];
              return (
                <div key={c.id} className="card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99 }}>{s.text}</span>
                      <span className="body-sm">{c.member_count} codes · cohesion {(c.cohesion * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span style={{ fontWeight: 700, color: "var(--navy)" }}>{formatPaise(c.duplicate_value_paise)}</span>
                      {c.review_status === "pending" ? (
                        <div className="flex gap-2">
                          <button onClick={() => review(c.id, "confirm")} className="btn btn-outline" style={{ padding: "5px 12px", color: "#15803D", borderColor: "rgba(21,128,61,0.3)" }}><Check size={13} /> Confirm</button>
                          <button onClick={() => review(c.id, "reject")} className="btn btn-outline" style={{ padding: "5px 12px", color: "#DC2626", borderColor: "rgba(220,38,38,0.3)" }}><X size={13} /> Reject</button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 700, color: c.review_status === "confirmed" ? "#15803D" : "#DC2626" }}>
                          {c.review_status === "confirmed" ? "✓ Confirmed" : "✕ Rejected"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    {(c.audit_cluster_members ?? []).map((m) => (
                      <div key={m.material_code} className="flex items-center justify-between" style={{ padding: "6px 0", fontSize: 13 }}>
                        <span style={{ color: m.is_primary ? "var(--navy)" : "var(--text-dark)", fontWeight: m.is_primary ? 700 : 400 }}>
                          {m.is_primary ? "★ " : ""}<span style={{ fontFamily: "monospace" }}>{m.material_code}</span> · {m.description ?? "—"}
                        </span>
                        <span className="body-sm">{m.stock_qty} {m.unit ?? ""} · {formatPaise(m.stock_value_paise)}{!m.is_primary && ` · ${(m.similarity_to_primary * 100).toFixed(0)}%`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
