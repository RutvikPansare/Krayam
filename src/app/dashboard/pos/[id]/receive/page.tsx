"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PackageCheck, ArrowLeft, CheckCircle2 } from "lucide-react";

/**
 * Feature 13 — confirm delivery & post GRN to SAP (replaces manual MIGO entry).
 */

interface POItem {
  id: string;
  item_name: string;
  material_code: string | null;
  quantity: number;
  unit: string;
}

interface GrnRow {
  id: string;
  grn_number: string;
  status: string;
  sap_grn_number: string | null;
  sap_mode: string | null;
  sap_error: string | null;
  created_at: string;
  grn_items: { po_item_id: string; quantity_received: number }[];
}

export default function ReceivePOPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [po, setPo] = useState<any | null>(null);
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [received, setReceived] = useState<Record<string, number>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ grn_number: string; sap_grn_number: string | null; sap_mode: string } | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/grns?po_id=${id}`);
    const body = await res.json();
    if (!res.ok) { setError(body.error ?? "Could not load PO"); setLoading(false); return; }
    setPo(body.po);
    setGrns(body.grns);
    setReceived(body.received);
    // default each line to the outstanding quantity
    const defaults: Record<string, string> = {};
    for (const it of body.po.po_items as POItem[]) {
      const rest = Number(it.quantity) - (body.received[it.id] ?? 0);
      defaults[it.id] = rest > 0 ? String(rest) : "0";
    }
    setQty(defaults);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/grns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          po_id: id,
          received_by: receivedBy || null,
          note: note || null,
          items: Object.entries(qty).map(([po_item_id, q]) => ({ po_item_id, quantity_received: Number(q) })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "GRN failed");
      setDone({ grn_number: body.grn_number, sap_grn_number: body.sap_grn_number, sap_mode: body.sap_mode });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-8 body-md">Loading…</div>;
  if (!po) return <div className="p-8 body-md">{error ?? "PO not found"}</div>;

  if (done) {
    return (
      <div className="p-8 max-w-2xl w-full mx-auto">
        <div className="card p-10 text-center">
          <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: "#15803D" }} />
          <h1 className="heading-md mb-2">Goods receipt posted</h1>
          <p className="body-md mb-1">{done.grn_number} created for {po.po_number}.</p>
          {done.sap_grn_number && (
            <p className="body-sm mb-6">
              SAP material document: <b style={{ fontFamily: "monospace" }}>{done.sap_grn_number}</b>
              {done.sap_mode === "mock" ? " (sandbox mode)" : " — verify in MIGO display"}
            </p>
          )}
          <button onClick={() => router.push("/dashboard/pos")} className="btn btn-dark">
            Back to purchase orders
          </button>
        </div>
      </div>
    );
  }

  const items: POItem[] = po.po_items ?? [];

  return (
    <div className="p-8 max-w-3xl w-full mx-auto">
      <button onClick={() => router.push("/dashboard/pos")} className="inline-flex items-center gap-1.5 body-sm mb-4" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-mid)", fontWeight: 600 }}>
        <ArrowLeft size={14} /> Purchase orders
      </button>

      <div className="mb-6">
        <h1 className="heading-lg mb-1 flex items-center gap-2">
          <PackageCheck size={24} style={{ color: "var(--navy)" }} /> Receive goods — {po.po_number}
        </h1>
        <p className="body-sm">
          Vendor: <b>{po.vendor_name}</b>
          {po.sap_po_number ? <> · SAP PO <span style={{ fontFamily: "monospace" }}>{po.sap_po_number}</span></> : null}
          {" "}· Posting creates the GRN in SAP automatically (movement 101) — no MIGO entry needed.
        </p>
      </div>

      <div className="card p-6 mb-4">
        <p className="label mb-4">Quantities received</p>
        <table className="w-full" style={{ fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Item", "Ordered", "Already received", "Receiving now"].map((h) => (
                <th key={h} className="text-left px-3 py-2 label">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const got = received[it.id] ?? 0;
              const rest = Number(it.quantity) - got;
              return (
                <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-3 py-3" style={{ color: "var(--text-dark)", fontWeight: 600 }}>
                    {it.item_name}
                    {it.material_code && <span className="block" style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", fontWeight: 400 }}>{it.material_code}</span>}
                  </td>
                  <td className="px-3 py-3" style={{ color: "var(--text-mid)" }}>{it.quantity} {it.unit}</td>
                  <td className="px-3 py-3" style={{ color: got > 0 ? "#15803D" : "var(--text-muted)" }}>{got}</td>
                  <td className="px-3 py-3">
                    <input
                      className="app-input"
                      style={{ width: 110, opacity: rest <= 0 ? 0.5 : 1 }}
                      type="number" min="0" max={rest} step="any"
                      disabled={rest <= 0}
                      value={qty[it.id] ?? ""}
                      onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })}
                    />
                    {rest <= 0 && <span className="block" style={{ fontSize: 11, color: "#15803D", marginTop: 2 }}>fully received</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card p-6 mb-4 grid grid-cols-2 gap-4">
        <div>
          <label className="label block mb-1.5">Received by</label>
          <input className="app-input" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Stores in-charge name" />
        </div>
        <div>
          <label className="label block mb-1.5">Note</label>
          <input className="app-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Delivery challan #, condition…" />
        </div>
      </div>

      {grns.length > 0 && (
        <div className="card p-6 mb-4">
          <p className="label mb-3">Previous receipts on this PO</p>
          {grns.map((g) => (
            <div key={g.id} className="flex items-center gap-3 py-2" style={{ borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: "var(--navy)" }}>{g.grn_number}</span>
              <span style={{ color: "var(--text-mid)" }}>{g.grn_items.reduce((s, x) => s + Number(x.quantity_received), 0)} units</span>
              <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>
                {g.sap_grn_number ? `SAP ${g.sap_grn_number}${g.sap_mode === "mock" ? " *" : ""}` : g.sap_error ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl mb-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <p style={{ fontSize: 13, color: "#EF4444" }}>{error}</p>
        </div>
      )}

      <button onClick={submit} disabled={submitting} className="btn btn-dark w-full" style={{ padding: 14, opacity: submitting ? 0.7 : 1 }}>
        {submitting ? "Posting goods receipt…" : "Confirm delivery & post GRN to SAP →"}
      </button>
    </div>
  );
}
