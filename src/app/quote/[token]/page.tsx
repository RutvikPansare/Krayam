"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle, Clock, Pencil } from "lucide-react";
import { UNIT_OPTIONS, unitLabel, unitFactor, formatINR } from "@/lib/units";

interface PreviousQuote {
  delivery_days: number | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  validity_days: number | null;
  notes: string | null;
  submitted_at: string;
  quote_items: { pr_item_id: string; price: number; quote_unit: string; available: boolean; available_qty: number | null }[];
}

interface QuoteContext {
  rfq_number: string;
  due_date: string | null;
  rfq_closed: boolean;
  vendor_name: string;
  company_name: string;
  already_submitted: boolean;
  previous_quote: PreviousQuote | null;
  items: { id: string; item_name: string; quantity: number; unit: string; notes: string | null }[];
}

interface LineState {
  price: string;
  unit: string;          // locked to the RFQ unit unless altUnit is enabled
  altUnit: boolean;      // vendor explicitly chose to quote a different unit
  available: boolean;
  available_qty: string;
}

export default function VendorQuotePage({ params }: { params: { token: string } }) {
  const [ctx, setCtx] = useState<QuoteContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [meta, setMeta] = useState({ delivery_days: "", payment_terms: "", delivery_terms: "", validity_days: "30", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false); // resubmit flow from the already-submitted screen

  useEffect(() => {
    fetch(`/api/quotes?token=${encodeURIComponent(params.token)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Invalid or expired link");
        setCtx(body);
        const prev: PreviousQuote | null = body.previous_quote;
        const init: Record<string, LineState> = {};
        for (const it of body.items) {
          const pq = prev?.quote_items.find((q) => q.pr_item_id === it.id);
          init[it.id] = {
            price: pq ? String(pq.price) : "",
            unit: pq?.quote_unit ?? it.unit,
            altUnit: pq != null && pq.quote_unit !== it.unit,
            available: pq ? pq.available : true,
            available_qty: pq?.available_qty != null ? String(pq.available_qty) : "",
          };
        }
        setLines(init);
        if (prev) {
          setMeta({
            delivery_days: prev.delivery_days != null ? String(prev.delivery_days) : "",
            payment_terms: prev.payment_terms ?? "",
            delivery_terms: prev.delivery_terms ?? "",
            validity_days: prev.validity_days != null ? String(prev.validity_days) : "30",
            notes: prev.notes ?? "",
          });
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: params.token,
          delivery_days: meta.delivery_days ? Number(meta.delivery_days) : null,
          payment_terms: meta.payment_terms || null,
          delivery_terms: meta.delivery_terms || null,
          validity_days: meta.validity_days ? Number(meta.validity_days) : null,
          notes: meta.notes || null,
          items: Object.entries(lines)
            .filter(([, l]) => l.available && l.price)
            .map(([pr_item_id, l]) => ({
              pr_item_id,
              price: Number(l.price),
              quote_unit: l.unit,
              available_qty: l.available_qty ? Number(l.available_qty) : null,
            })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Submission failed");
      setDone(true);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--paper)" }}><p className="body-md">Loading RFQ…</p></div>;
  }

  if (error && !ctx) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6" style={{ background: "var(--paper)" }}>
        <div className="card p-10 text-center" style={{ maxWidth: 420 }}>
          <XCircle size={44} className="mx-auto mb-4" style={{ color: "#DC2626" }} />
          <h1 className="heading-md mb-2">Link not valid</h1>
          <p className="body-md">{error}</p>
        </div>
      </div>
    );
  }

  // RFQ deadline passed — clear close message, not an error
  if (ctx?.rfq_closed && !done) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6" style={{ background: "var(--paper)" }}>
        <div className="card p-10 text-center" style={{ maxWidth: 440 }}>
          <Clock size={44} className="mx-auto mb-4" style={{ color: "#B97A0A" }} />
          <h1 className="heading-md mb-2">This RFQ has closed</h1>
          <p className="body-md">
            The quotation window for {ctx.rfq_number} has ended
            {ctx.already_submitted ? " — your quote was received in time and is being evaluated." : ". Quotes are no longer being accepted for this enquiry."}
          </p>
          <p className="label mt-6">{ctx.company_name} · via Krayam</p>
        </div>
      </div>
    );
  }

  // Submitted (now or previously) — summary of what was quoted
  if (done || (ctx?.already_submitted && !editing)) {
    const prev = ctx?.previous_quote;
    const quotedLines = done
      ? Object.entries(lines).filter(([, l]) => l.available && l.price)
      : (prev?.quote_items ?? []).map((q) => [q.pr_item_id, { price: String(q.price), unit: q.quote_unit, available: q.available, altUnit: false, available_qty: q.available_qty != null ? String(q.available_qty) : "" }] as const);

    return (
      <div className="min-h-dvh flex items-center justify-center px-6 py-10" style={{ background: "var(--paper)" }}>
        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="card p-8 md:p-10 w-full" style={{ maxWidth: 480 }}>
          <div className="text-center">
            <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: "#15803D" }} />
            <h1 className="heading-md mb-2">Quote {done ? "submitted" : "already submitted"}</h1>
            <p className="body-md mb-6">
              Thank you{ctx ? `, ${ctx.vendor_name}` : ""}. Here is what we have on record for {ctx?.rfq_number}:
            </p>
          </div>

          <table className="w-full mb-5" style={{ fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th className="text-left py-2 label">Item</th>
                <th className="text-right py-2 label">Your price</th>
              </tr>
            </thead>
            <tbody>
              {quotedLines.map(([itemId, l]) => {
                const item = ctx?.items.find((i) => i.id === itemId);
                if (!item) return null;
                return (
                  <tr key={itemId} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="py-2.5" style={{ color: "var(--text-dark)", fontWeight: 500 }}>{item.item_name}</td>
                    <td className="py-2.5 text-right" style={{ color: "var(--text-dark)", fontWeight: 600 }}>
                      {formatINR(Number(l.price))} / {unitLabel(l.unit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex flex-wrap gap-x-6 gap-y-1 mb-6 body-sm" style={{ fontSize: 12.5 }}>
            {(done ? meta.delivery_days : prev?.delivery_days) ? <span>Lead time: <b>{done ? meta.delivery_days : prev?.delivery_days} days</b></span> : null}
            {(done ? meta.validity_days : prev?.validity_days) ? <span>Valid for: <b>{done ? meta.validity_days : prev?.validity_days} days</b></span> : null}
            {(done ? meta.payment_terms : prev?.payment_terms) ? <span>Payment: <b>{done ? meta.payment_terms : prev?.payment_terms}</b></span> : null}
          </div>

          {!ctx?.rfq_closed && (
            <button onClick={() => { setEditing(true); setDone(false); }} className="btn btn-outline w-full">
              <Pencil size={14} /> Edit &amp; resubmit
            </button>
          )}
          <p className="label text-center mt-5">Krayam · Procurement Intelligence</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-16" style={{ background: "var(--paper)" }}>
      <div className="px-5 pt-8 pb-6" style={{ background: "var(--navy)" }}>
        <div className="max-w-lg mx-auto">
          <span className="font-logo text-white" style={{ fontSize: 24 }}>
            Krayam<span style={{ color: "var(--amber)" }}>.</span>
          </span>
          <h1 className="heading-md text-white mt-3">Request for quotation — {ctx!.rfq_number}</h1>
          <p className="body-sm mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
            For {ctx!.vendor_name}, from {ctx!.company_name}.
            {ctx!.due_date && ` Quotes due by ${ctx!.due_date}.`}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="max-w-lg mx-auto px-5 -mt-3 flex flex-col gap-4">
        <div className="card p-5 flex flex-col gap-5">
          <p className="label">Your prices (INR, excl. GST)</p>
          {ctx!.items.map((it) => {
            const l = lines[it.id];
            const factor = unitFactor(l.unit);
            const perBase = l.price && factor > 0 ? Number(l.price) / factor : null;
            return (
              <div key={it.id} className="flex flex-col gap-2.5 pb-4" style={{ borderBottom: "1px dashed var(--border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="body-sm" style={{ fontWeight: 700, color: "var(--text-dark)" }}>{it.item_name}</p>
                    <p className="body-sm" style={{ fontSize: 12 }}>Required: {it.quantity} {unitLabel(it.unit)}{it.notes ? ` · ${it.notes}` : ""}</p>
                  </div>
                  <label className="flex items-center gap-1.5 body-sm" style={{ fontSize: 12, whiteSpace: "nowrap", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={l.available}
                      onChange={(e) => setLines({ ...lines, [it.id]: { ...l, available: e.target.checked } })}
                    />
                    Can supply
                  </label>
                </div>
                {l.available && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        className="app-input"
                        type="number" step="0.01" min="0.01" inputMode="decimal"
                        required placeholder={`₹ per ${unitLabel(it.unit)}`}
                        aria-label={`Price for ${it.item_name}`}
                        value={l.price}
                        onChange={(e) => setLines({ ...lines, [it.id]: { ...l, price: e.target.value } })}
                      />
                      <input
                        className="app-input"
                        type="number" min="0" step="any" inputMode="decimal"
                        placeholder={`Qty available`}
                        aria-label={`Available quantity for ${it.item_name}`}
                        value={l.available_qty}
                        onChange={(e) => setLines({ ...lines, [it.id]: { ...l, available_qty: e.target.value } })}
                      />
                    </div>
                    {/* Unit locked to the RFQ's unit; quoting differently is an explicit choice */}
                    {!l.altUnit ? (
                      <p className="body-sm" style={{ fontSize: 12 }}>
                        Price per <b>{unitLabel(it.unit)}</b> (as specified in the RFQ) ·{" "}
                        <button
                          type="button"
                          onClick={() => setLines({ ...lines, [it.id]: { ...l, altUnit: true } })}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--steel)", fontSize: 12, textDecoration: "underline" }}
                        >
                          quote in a different unit
                        </button>
                      </p>
                    ) : (
                      <div className="px-3 py-2.5 rounded-lg flex flex-col gap-2" style={{ background: "rgba(61,126,166,0.07)", border: "1px solid rgba(61,126,166,0.2)" }}>
                        <div className="flex items-center gap-2">
                          <select
                            className="app-select"
                            style={{ flex: 1 }}
                            aria-label={`Quote unit for ${it.item_name}`}
                            value={l.unit}
                            onChange={(e) => setLines({ ...lines, [it.id]: { ...l, unit: e.target.value } })}
                          >
                            {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>per {u.label}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => setLines({ ...lines, [it.id]: { ...l, altUnit: false, unit: it.unit } })}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12 }}
                          >
                            reset
                          </button>
                        </div>
                        {perBase != null && l.unit !== it.unit && (
                          <p style={{ fontSize: 12, color: "var(--steel)", fontWeight: 600 }}>
                            = {formatINR(perBase)} per piece (base unit) — this converted price is what the buyer compares
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="card p-5 flex flex-col gap-4">
          <p className="label">Terms</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label block mb-1.5" htmlFor="q-lead">Lead time (days)</label>
              <input id="q-lead" className="app-input" type="number" min={0} max={365} value={meta.delivery_days} onChange={(e) => setMeta({ ...meta, delivery_days: e.target.value })} placeholder="7" />
            </div>
            <div>
              <label className="label block mb-1.5" htmlFor="q-validity">Quote valid for (days)</label>
              <input id="q-validity" className="app-input" type="number" min={1} max={365} value={meta.validity_days} onChange={(e) => setMeta({ ...meta, validity_days: e.target.value })} placeholder="30" />
            </div>
            <div>
              <label className="label block mb-1.5" htmlFor="q-payment">Payment terms</label>
              <input id="q-payment" className="app-input" value={meta.payment_terms} onChange={(e) => setMeta({ ...meta, payment_terms: e.target.value })} placeholder="30 days credit" />
            </div>
            <div>
              <label className="label block mb-1.5" htmlFor="q-delivery">Delivery terms</label>
              <input id="q-delivery" className="app-input" value={meta.delivery_terms} onChange={(e) => setMeta({ ...meta, delivery_terms: e.target.value })} placeholder="FOR destination, freight included" />
            </div>
          </div>
          <div>
            <label className="label block mb-1.5" htmlFor="q-notes">Notes</label>
            <textarea id="q-notes" className="app-textarea" rows={2} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} placeholder="Brand offered, warranty, freight…" />
          </div>
        </div>

        {error && (
          <div role="alert" className="px-4 py-3 rounded-xl" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <p style={{ fontSize: 13, color: "#EF4444" }}>{error}</p>
          </div>
        )}

        <button type="submit" disabled={submitting} className="btn btn-dark w-full" style={{ padding: "16px", opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Submitting…" : editing ? "Update quote →" : "Submit quote →"}
        </button>
        <p className="label text-center">Takes 2 minutes · no account needed · Krayam</p>
      </form>
    </div>
  );
}
