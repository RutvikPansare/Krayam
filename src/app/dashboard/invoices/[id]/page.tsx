"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, GitCompareArrows, AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { formatINR } from "@/lib/units";

/** Feature 12 — review extraction, link PO, run the 3-way match, approve/reject. */

interface Flag { code: string; severity: "error" | "warning" | "info"; message: string }

const FLAG_STYLE: Record<Flag["severity"], { color: string; bg: string; Icon: typeof Info }> = {
  error:   { color: "#DC2626", bg: "rgba(239,68,68,0.07)",  Icon: XCircle },
  warning: { color: "#B97A0A", bg: "rgba(245,158,11,0.08)", Icon: AlertTriangle },
  info:    { color: "#15803D", bg: "rgba(34,197,94,0.07)",  Icon: CheckCircle2 },
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<any | null>(null);
  const [fields, setFields] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/invoices/${id}`);
    const body = await res.json();
    if (!res.ok) { setError(body.error ?? "Could not load invoice"); return; }
    setData(body);
    setFields({
      po_id: body.invoice.po_id ?? "",
      invoice_number: body.invoice.invoice_number ?? "",
      vendor_name: body.invoice.vendor_name ?? "",
      invoice_date: body.invoice.invoice_date ?? "",
      gstin: body.invoice.gstin ?? "",
      subtotal: body.invoice.subtotal ?? "",
      tax_amount: body.invoice.tax_amount ?? "",
      total_amount: body.invoice.total_amount ?? "",
    });
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function patch(action?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fields,
          po_id: fields.po_id || null,
          subtotal: fields.subtotal === "" ? null : Number(fields.subtotal),
          tax_amount: fields.tax_amount === "" ? null : Number(fields.tax_amount),
          total_amount: fields.total_amount === "" ? null : Number(fields.total_amount),
          invoice_date: fields.invoice_date || null,
          ...(action ? { action } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Update failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="p-8 body-md">{error ?? "Loading…"}</div>;

  const inv = data.invoice;
  const flags: Flag[] = inv.match_results ?? [];
  const f = (k: string, v: string) => setFields({ ...fields, [k]: v });

  return (
    <div className="p-8 max-w-4xl w-full mx-auto">
      <button onClick={() => router.push("/dashboard/invoices")} className="inline-flex items-center gap-1.5 body-sm mb-4" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-mid)", fontWeight: 600 }}>
        <ArrowLeft size={14} /> Invoices
      </button>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="heading-lg mb-1">Invoice {inv.invoice_number ?? "(no number read)"}</h1>
          <p className="body-sm">{inv.file_name} · status: <b>{inv.status}</b></p>
        </div>
      </div>

      {/* Extracted fields — editable before matching */}
      <div className="card p-6 mb-4">
        <p className="label mb-4">Extracted data — correct anything the parser missed</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label block mb-1.5">Linked PO *</label>
            <select className="app-select" value={fields.po_id} onChange={(e) => f("po_id", e.target.value)}>
              <option value="">— select purchase order —</option>
              {data.po_options.map((p: any) => (
                <option key={p.id} value={p.id}>{p.po_number} · {p.vendor_name} · {formatINR(Number(p.total_amount))}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-1.5">Invoice number</label>
            <input className="app-input" value={fields.invoice_number} onChange={(e) => f("invoice_number", e.target.value)} />
          </div>
          <div>
            <label className="label block mb-1.5">Vendor</label>
            <input className="app-input" value={fields.vendor_name} onChange={(e) => f("vendor_name", e.target.value)} />
          </div>
          <div>
            <label className="label block mb-1.5">Invoice date</label>
            <input className="app-input" type="date" value={fields.invoice_date} onChange={(e) => f("invoice_date", e.target.value)} />
          </div>
          <div>
            <label className="label block mb-1.5">GSTIN</label>
            <input className="app-input" style={{ fontFamily: "monospace" }} value={fields.gstin} onChange={(e) => f("gstin", e.target.value)} />
          </div>
          <div>
            <label className="label block mb-1.5">Taxable value (₹, before GST)</label>
            <input className="app-input" type="number" step="any" value={fields.subtotal} onChange={(e) => f("subtotal", e.target.value)} />
          </div>
          <div>
            <label className="label block mb-1.5">Tax amount (₹)</label>
            <input className="app-input" type="number" step="any" value={fields.tax_amount} onChange={(e) => f("tax_amount", e.target.value)} />
          </div>
          <div>
            <label className="label block mb-1.5">Invoice total (₹)</label>
            <input className="app-input" type="number" step="any" value={fields.total_amount} onChange={(e) => f("total_amount", e.target.value)} />
          </div>
        </div>
      </div>

      {/* Extracted line items */}
      {(inv.invoice_items?.length ?? 0) > 0 && (
        <div className="card p-6 mb-4">
          <p className="label mb-3">Line items read from the PDF</p>
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Description", "Qty", "Rate", "Amount"].map((h) => <th key={h} className="text-left px-3 py-2 label">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {inv.invoice_items.map((it: any) => (
                <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-3 py-2.5" style={{ color: "var(--text-dark)" }}>{it.description}</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--text-mid)" }}>{it.quantity ?? "—"}</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--text-mid)" }}>{it.unit_price != null ? formatINR(Number(it.unit_price)) : "—"}</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--text-dark)", fontWeight: 600 }}>{it.line_total != null ? formatINR(Number(it.line_total)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Match results */}
      {flags.length > 0 && (
        <div className="card p-6 mb-4">
          <p className="label mb-3">3-way match results — invoice vs PO vs GRN</p>
          <div className="flex flex-col gap-2">
            {flags.map((fl, i) => {
              const s = FLAG_STYLE[fl.severity];
              return (
                <div key={i} className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg" style={{ background: s.bg }}>
                  <s.Icon size={15} style={{ color: s.color, flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: 13, color: "var(--text-dark)" }}>{fl.message}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl mb-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <p style={{ fontSize: 13, color: "#EF4444" }}>{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => patch("match")} disabled={busy || !fields.po_id} className="btn btn-dark flex-1" style={{ padding: 13, opacity: busy || !fields.po_id ? 0.6 : 1 }}>
          <GitCompareArrows size={15} /> {busy ? "Working…" : "Save & run 3-way match"}
        </button>
        {(inv.status === "review_required" || inv.status === "approved") && (
          <>
            <button onClick={() => patch("approve")} disabled={busy} className="btn btn-outline" style={{ padding: "13px 22px", color: "#15803D", borderColor: "#15803D" }}>
              Approve for payment
            </button>
            <button onClick={() => patch("reject")} disabled={busy} className="btn btn-outline" style={{ padding: "13px 22px", color: "#DC2626", borderColor: "#DC2626" }}>
              Reject
            </button>
          </>
        )}
      </div>
      {!fields.po_id && <p className="body-sm mt-2" style={{ fontSize: 12 }}>Link a purchase order to enable matching.</p>}
    </div>
  );
}
