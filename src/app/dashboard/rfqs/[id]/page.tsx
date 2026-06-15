"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { PRItem, Quote, RFQ } from "@/types";
import { normalizedUnitPrice, unitLabel, formatINR, UNIT_OPTIONS } from "@/lib/units";
import { Plus, X, RefreshCw, FileText, PackageCheck } from "lucide-react";
import { OVERRIDE_REASONS } from "@/types/savings";
import { convertPrice, UnknownConversionError, type UnitDef } from "@/lib/unit-convert";
import { toPaise } from "@/lib/money";

interface ConvDef extends UnitDef { label: string | null }

/** Feature 09 — per-item result from the pre-PO stock check */
interface StockCheckRow {
  item_name: string;
  material_code: string | null;
  quantity: number;
  found: boolean;
  stock: Record<string, number>;
  total: number;
  unit?: string;
  cached?: boolean;
  source?: string;
  last_movement_date?: string | null;
  suggestion: { type: "use_stock" | "reduce_qty"; reduceTo?: number; message: string } | null;
}

export default function RFQComparePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [rfq, setRfq] = useState<(RFQ & { purchase_requests: { pr_number: string; id: string } }) | null>(null);
  const [items, setItems] = useState<PRItem[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [sortBy, setSortBy] = useState<"submitted" | "total" | "lead" | "rating" | "name">("submitted");
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showManual, setShowManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manual, setManual] = useState<{
    vendor_id: string; vendor_name: string; delivery_days: string; payment_terms: string; delivery_terms: string; notes: string;
    prices: Record<string, { price: string; unit: string; available_qty?: string; pack_size?: string }>;
  }>({
    vendor_id: "", vendor_name: "", delivery_days: "", payment_terms: "", delivery_terms: "", notes: "", prices: {},
  });

  // Feature 06/09 — PO flow with stock-check intercept
  const [poQuote, setPoQuote] = useState<Quote | null>(null);
  const [stockRows, setStockRows] = useState<StockCheckRow[] | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [poSubmitting, setPoSubmitting] = useState(false);
  const [poResult, setPoResult] = useState<{ po_number?: string; po_id?: string; sap_po_number?: string | null; sap_mode?: string; no_po?: boolean; message?: string; saved?: number } | null>(null);
  const [poError, setPoError] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [convDefs, setConvDefs] = useState<ConvDef[]>([]);

  // Conversion ratios from the server table (preview reuses the pure engine).
  useEffect(() => {
    fetch("/api/unit-conversions").then((r) => r.json()).then((b) => setConvDefs(b.conversions ?? [])).catch(() => {});
  }, []);

  // Vendors already on this RFQ (have a vendor_id) — dropdown targets for
  // manual entry / overwrite. Deduped by vendor_id.
  const vendorOptions = Array.from(
    new Map(quotes.filter((q) => q.vendor_id).map((q) => [q.vendor_id, q.vendor_name])).entries(),
  ).map(([id, name]) => ({ id: id as string, name }));

  /** Live converter preview for the manual form (uses server-provided ratios). */
  function previewConversion(rawRupees: string, fromUnit: string, baseUnit: string, packSize?: string): string | null {
    const n = Number(rawRupees);
    if (!Number.isFinite(n) || n <= 0 || fromUnit === baseUnit || convDefs.length === 0) return null;
    try {
      const sizes = packSize ? { [fromUnit]: Number(packSize) } : {};
      const r = convertPrice(toPaise(n), fromUnit, baseUnit, convDefs, sizes);
      if (r.needsClarification) return `Pack size needed to convert ${unitLabel(fromUnit)} → ${unitLabel(baseUnit)}`;
      return `${formatINR(n)}/${unitLabel(fromUnit)} ÷ ${(1 / (r.factor ?? 1)).toFixed(r.factor && r.factor < 1 ? 0 : 4)} = ${formatINR((r.normalizedPaise ?? 0) / 100)}/${unitLabel(baseUnit)}`;
    } catch (e) {
      if (e instanceof UnknownConversionError) return `Cannot convert ${unitLabel(fromUnit)} → ${unitLabel(baseUnit)}`;
      return null;
    }
  }

  const load = useCallback(async () => {
    const { data: rfqData } = await supabase
      .from("rfqs")
      .select("*, purchase_requests(id, pr_number)")
      .eq("id", params.id)
      .single();
    if (!rfqData) { setLoading(false); return; }
    setRfq(rfqData as any);
    const [{ data: itemData }, { data: quoteData }] = await Promise.all([
      supabase.from("pr_items").select("*").eq("pr_id", (rfqData as any).purchase_requests.id).order("created_at"),
      supabase.from("quotes").select("*, quote_items(*), vendors(rating)").eq("rfq_id", params.id).order("submitted_at"),
    ]);
    setItems((itemData ?? []) as PRItem[]);
    setQuotes((quoteData ?? []) as Quote[]);
    setLoading(false);
  }, [params.id, supabase]);

  useEffect(() => {
    load();
    // Live updates: new quotes appear without refresh (test from multiple tabs)
    const channel = supabase
      .channel(`rfq-${params.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes", filter: `rfq_id=eq.${params.id}` }, () => load())
      .subscribe();
    const poll = setInterval(load, 10000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [load, params.id, supabase]);

  /** Normalized (per RFQ base unit) price for a quote on an item.
   *  Uses the server-stored normalized_price_paise (non-destructive); falls
   *  back to the legacy client calc only for pre-Feature-10 rows. */
  function priceFor(q: Quote, itemId: string): { norm: number | null; raw: number; unit: string; needsClarification: boolean } | null {
    const qi = q.quote_items?.find((x) => x.pr_item_id === itemId && x.available);
    if (!qi) return null;
    const norm = qi.needs_clarification
      ? null
      : qi.normalized_price_paise != null
        ? qi.normalized_price_paise / 100
        : normalizedUnitPrice(qi.price, qi.quote_unit);
    return { norm, raw: qi.price, unit: qi.raw_unit ?? qi.quote_unit, needsClarification: !!qi.needs_clarification };
  }

  function bestPrice(itemId: string): number | null {
    const prices = quotes.map((q) => priceFor(q, itemId)?.norm).filter((p): p is number => p != null);
    return prices.length ? Math.min(...prices) : null;
  }

  /** total normalized cost of fulfilling the whole PR with this vendor */
  function vendorTotal(q: Quote): number | null {
    let total = 0;
    for (const it of items) {
      const p = priceFor(q, it.id);
      if (!p || p.norm == null) return null; // can't fulfill / awaiting clarification
      total += p.norm * it.quantity;
    }
    return total;
  }

  // Sort vendor columns. Client-side on purpose: an RFQ has a bounded
  // handful of vendors, so a server round-trip per sort would be slower.
  const sortedQuotes = [...quotes].sort((a, b) => {
    switch (sortBy) {
      case "total": {
        const ta = vendorTotal(a), tb = vendorTotal(b);
        return (ta ?? Infinity) - (tb ?? Infinity);
      }
      case "lead": return (a.delivery_days ?? Infinity) - (b.delivery_days ?? Infinity);
      case "rating": return (b.vendors?.rating ?? -1) - (a.vendors?.rating ?? -1);
      case "name": return a.vendor_name.localeCompare(b.vendor_name);
      default: return a.submitted_at.localeCompare(b.submitted_at);
    }
  });

  const totals = sortedQuotes.map((q) => ({ q, total: vendorTotal(q) }));
  const bestTotal = totals.filter((t) => t.total != null).sort((a, b) => a.total! - b.total!)[0];

  async function saveInternalNote(quoteId: string) {
    await supabase.from("quotes").update({ internal_note: noteDraft[quoteId] || null }).eq("id", quoteId);
    setNoteEditing(null);
    load();
  }

  async function submitManual(e: React.FormEvent, confirmOverwrite = false) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      method: "manual" as const,
      rfq_id: params.id,
      vendor_id: manual.vendor_id || null,
      vendor_name: manual.vendor_name,
      source: "manual",
      confirm_overwrite: confirmOverwrite,
      delivery_days: manual.delivery_days ? Number(manual.delivery_days) : null,
      payment_terms: manual.payment_terms || null,
      delivery_terms: manual.delivery_terms || null,
      notes: manual.notes || null,
      items: items
        .filter((it) => manual.prices[it.id]?.price)
        .map((it) => ({
          pr_item_id: it.id,
          price: Number(manual.prices[it.id].price),
          quote_unit: manual.prices[it.id].unit || "piece",
          available_qty: manual.prices[it.id].available_qty ? Number(manual.prices[it.id].available_qty) : null,
          pack_size: manual.prices[it.id].pack_size ? Number(manual.prices[it.id].pack_size) : null,
        })),
    };
    const res = await fetch("/api/quotes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    // Overwrite confirmation: a quote already exists for this vendor.
    if (res.status === 409 && out.needs_confirm && !confirmOverwrite) {
      setSaving(false);
      if (window.confirm(`${manual.vendor_name} already has a quote for this RFQ. Overwrite it?`)) {
        return submitManual(e, true);
      }
      return;
    }
    setSaving(false);
    if (res.ok) {
      setShowManual(false);
      setManual({ vendor_id: "", vendor_name: "", delivery_days: "", payment_terms: "", delivery_terms: "", notes: "", prices: {} });
      load();
    } else {
      setPoError(out.error ?? "Could not save the manual quote.");
    }
  }

  /** Feature 09 — intercept the PO button: check stock across warehouses first. */
  async function startPoFlow(q: Quote) {
    setPoQuote(q);
    setStockRows(null);
    setOverrides({});
    setOverrideReason("");
    setPoError(null);
    setPoResult(null);
    setStockLoading(true);
    try {
      const quotedItems = items.filter((it) => q.quote_items?.some((x) => x.pr_item_id === it.id && x.available));
      const res = await fetch("/api/stock-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: quotedItems.map((it) => ({
            pr_item_id: it.id,
            material_code: it.material_code,
            item_name: it.item_name,
            quantity: Number(it.quantity),
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Stock check failed");
      setStockRows(body.results);
      // Pre-fill suggested reductions
      const o: Record<string, number> = {};
      for (const r of body.results as (StockCheckRow & { pr_item_id: string })[]) {
        if (r.suggestion?.type === "use_stock") o[(r as any).pr_item_id] = 0;
        else if (r.suggestion?.type === "reduce_qty" && r.suggestion.reduceTo != null) o[(r as any).pr_item_id] = r.suggestion.reduceTo;
      }
      setOverrides(o);
    } catch (e) {
      // Stock check must NEVER block a purchase. On any failure (SAP down,
      // timeout, network), proceed as if no stock was found — no error shown.
      console.error("Stock check failed; proceeding without it:", e);
      setStockRows([]);
    } finally {
      setStockLoading(false);
    }
  }

  async function confirmPo(useOverrides: boolean) {
    if (!poQuote) return;
    setPoSubmitting(true);
    setPoError(null);
    try {
      const stockNotes = (stockRows ?? [])
        .filter((r) => r.suggestion)
        .map((r) => `${r.item_name}: ${r.total} in stock (${Object.entries(r.stock).filter(([, v]) => Number(v) > 0).map(([w, v]) => `${w}: ${v}`).join(", ")})`)
        .join("; ");
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_id: poQuote.id,
          quantity_overrides: useOverrides ? overrides : {},
          stock_note: stockNotes || null,
          override_reason: overrideReason || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "PO creation failed");
      setPoResult(body);
      load();
    } catch (e) {
      setPoError(e instanceof Error ? e.message : "PO creation failed");
    } finally {
      setPoSubmitting(false);
    }
  }

  if (loading) return <div className="p-8 body-md">Loading comparison…</div>;
  if (!rfq) return <div className="p-8 body-md">RFQ not found.</div>;

  return (
    <div className="p-8 max-w-6xl w-full mx-auto">
      <Link href="/dashboard/rfqs" className="body-sm" style={{ color: "var(--text-muted)", textDecoration: "none" }}>
        ← All RFQs
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4 mt-3 mb-2">
        <div className="flex items-center gap-4">
          <h1 className="heading-lg">{rfq.rfq_number}</h1>
          <span className="pill pill-blue">{quotes.length} quote{quotes.length === 1 ? "" : "s"} in</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="body-sm" htmlFor="quote-sort" style={{ fontWeight: 600 }}>Sort vendors:</label>
          <select
            id="quote-sort"
            className="app-select"
            style={{ width: 170, padding: "9px 12px" }}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="submitted">First to quote</option>
            <option value="total">Lowest total</option>
            <option value="lead">Fastest delivery</option>
            <option value="rating">Best rating</option>
            <option value="name">Vendor name</option>
          </select>
          <button onClick={load} className="btn btn-outline" style={{ padding: "10px 16px" }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setShowManual(true)} className="btn btn-dark" style={{ padding: "10px 16px" }}>
            <Plus size={14} /> Enter quote manually
          </button>
        </div>
      </div>
      <p className="body-sm mb-8">
        For {rfq.purchase_requests.pr_number} · prices normalized to per-piece so dozens, boxes and gross compare fairly. Best price per row highlighted. Updates live as vendors submit.
      </p>

      {quotes.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <p className="body-md mb-1">No quotes yet.</p>
          <p className="body-sm">Vendors received their quote links by email. This table fills in live — or use manual entry for vendors who phoned in.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full" style={{ fontSize: 14, minWidth: 640 }} aria-label={`Quote comparison for ${rfq.rfq_number}`}>
            <caption className="sr-only">
              Quote comparison: items as rows, vendors as columns. Lowest price per item and lowest total are highlighted.
            </caption>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th scope="col" className="text-left px-5 py-3 label" style={{ minWidth: 180 }}>Item</th>
                {sortedQuotes.map((q) => (
                  <th scope="col" key={q.id} className="text-right px-5 py-3" style={{ minWidth: 150 }}>
                    <span className="label block">
                      {q.vendor_name}
                      {q.is_winner && <span className="pill pill-green ml-1.5" style={{ fontSize: 9, padding: "1px 7px" }}>WINNER</span>}
                    </span>
                    <span className="inline-flex items-center gap-1.5 mt-1" style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>
                      {/* Feature 10 — audit trail: how this quote entered the system */}
                      <span className={`pill ${q.source === "manual" ? "pill-amber" : "pill-blue"}`} style={{ fontSize: 9, padding: "1px 7px" }}>
                        {q.source === "manual" ? "entered manually" : "via form"}
                      </span>
                      {q.vendors?.rating != null && <span aria-label={`Past performance ${q.vendors.rating} out of 5`}>★ {Number(q.vendors.rating).toFixed(1)}</span>}
                      {q.delivery_days != null && `${q.delivery_days}d`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const best = bestPrice(it.id);
                return (
                  <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <th scope="row" className="px-5 py-3.5 text-left" style={{ fontWeight: 600 }}>
                      <span style={{ color: "var(--text-dark)" }}>{it.item_name}</span>
                      <span className="block body-sm" style={{ fontSize: 12, fontWeight: 400 }}>{it.quantity} {unitLabel(it.unit)}</span>
                    </th>
                    {sortedQuotes.map((q) => {
                      const p = priceFor(q, it.id);
                      const isBest = p != null && p.norm != null && best != null && Math.abs(p.norm - best) < 0.005;
                      return (
                        <td
                          key={q.id}
                          className="px-5 py-3.5 text-right"
                          style={{
                            background: isBest ? "rgba(34,197,94,0.08)" : undefined,
                            fontWeight: isBest ? 700 : 500,
                            color: p ? (isBest ? "#15803D" : "var(--text-dark)") : "var(--text-muted)",
                          }}
                        >
                          {!p ? "—" : p.norm == null ? (
                            <span className="pill pill-amber" style={{ fontSize: 10 }} title="Box/set size unknown — clarify to normalize">needs clarification</span>
                          ) : (
                            <>
                              {formatINR(p.norm)}<span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>/{unitLabel(it.unit)}</span>
                              {p.unit !== it.unit && (
                                <span className="block" style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>
                                  quoted {formatINR(p.raw)}/{unitLabel(p.unit)}
                                </span>
                              )}
                              {isBest && <span className="block" style={{ fontSize: 10, letterSpacing: "0.08em" }}>BEST</span>}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {/* Vendor terms + officer notes */}
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th scope="row" className="px-5 py-3 text-left label">Terms &amp; validity</th>
                {sortedQuotes.map((q) => (
                  <td key={q.id} className="px-5 py-3 text-right body-sm" style={{ fontSize: 12 }}>
                    {q.payment_terms && <span className="block">{q.payment_terms}</span>}
                    {q.delivery_terms && <span className="block">{q.delivery_terms}</span>}
                    {q.validity_days != null && <span className="block" style={{ color: "var(--text-muted)" }}>valid {q.validity_days} days</span>}
                    {q.notes && <span className="block mt-1" style={{ fontStyle: "italic", color: "var(--text-muted)" }}>&ldquo;{q.notes}&rdquo;</span>}
                    {!q.payment_terms && !q.delivery_terms && q.validity_days == null && !q.notes && "—"}
                  </td>
                ))}
              </tr>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th scope="row" className="px-5 py-3 text-left label">Internal note</th>
                {sortedQuotes.map((q) => (
                  <td key={q.id} className="px-5 py-3 text-right body-sm" style={{ fontSize: 12 }}>
                    {noteEditing === q.id ? (
                      <span className="flex gap-1.5 justify-end">
                        <input
                          className="app-input"
                          style={{ padding: "6px 9px", fontSize: 12, width: 130 }}
                          autoFocus
                          aria-label={`Internal note for ${q.vendor_name}`}
                          value={noteDraft[q.id] ?? q.internal_note ?? ""}
                          onChange={(e) => setNoteDraft({ ...noteDraft, [q.id]: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") saveInternalNote(q.id); if (e.key === "Escape") setNoteEditing(null); }}
                        />
                        <button onClick={() => saveInternalNote(q.id)} className="btn btn-dark" style={{ padding: "5px 10px", fontSize: 11 }}>Save</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => { setNoteDraft({ ...noteDraft, [q.id]: q.internal_note ?? "" }); setNoteEditing(q.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: q.internal_note ? "var(--text-dark)" : "var(--text-muted)", textDecoration: "underline dotted" }}
                        aria-label={`Edit internal note for ${q.vendor_name}`}
                      >
                        {q.internal_note || "+ add note"}
                      </button>
                    )}
                  </td>
                ))}
              </tr>
              {/* Totals row */}
              <tr style={{ background: "var(--paper)" }}>
                <th scope="row" className="px-5 py-4 text-left" style={{ fontWeight: 700, color: "var(--text-dark)" }}>Total (full PR)</th>
                {totals.map(({ q, total }) => {
                  const isBest = bestTotal && q.id === bestTotal.q.id;
                  return (
                    <td key={q.id} className="px-5 py-4 text-right" style={{ fontWeight: 700, color: isBest ? "#15803D" : total == null ? "var(--text-muted)" : "var(--text-dark)" }}>
                      {total == null ? "partial" : formatINR(total)}
                      {isBest && <span className="block" style={{ fontSize: 10, letterSpacing: "0.08em" }}>LOWEST TOTAL</span>}
                    </td>
                  );
                })}
              </tr>
              {/* Feature 06 — winner selection: PO + winner/rejection emails */}
              <tr style={{ background: "var(--paper)" }}>
                <td className="px-5 py-3" />
                {sortedQuotes.map((q) => (
                  <td key={q.id} className="px-5 py-3 text-right">
                    <button
                      onClick={() => startPoFlow(q)}
                      className="btn btn-dark"
                      style={{ padding: "8px 14px", fontSize: 12 }}
                      aria-label={`Select ${q.vendor_name} as winner and generate purchase order`}
                    >
                      <FileText size={13} /> Select winner → PO
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Feature 06 + 09 — PO confirmation with stock-check intercept */}
      {poQuote && (
        <div className="modal-overlay" onClick={() => !poSubmitting && setPoQuote(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="heading-sm">
                {poResult?.no_po ? "Order cancelled — using stock" : poResult ? "Purchase order created" : `PO for ${poQuote.vendor_name}`}
              </h2>
              <button onClick={() => setPoQuote(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                <X size={18} />
              </button>
            </div>

            {poResult?.no_po ? (
              <div className="modal-body text-center py-10">
                <PackageCheck size={44} className="mx-auto mb-4" style={{ color: "#15803D" }} />
                <p className="heading-sm mb-2" style={{ color: "#15803D" }}>Issued from existing stock</p>
                <p className="body-sm mb-1">{poResult.message}</p>
                {poResult.saved != null && poResult.saved > 0 && (
                  <p className="body-sm" style={{ color: "#15803D", fontWeight: 700 }}>≈ {formatINR(poResult.saved)} avoided</p>
                )}
              </div>
            ) : poResult ? (
              <div className="modal-body text-center py-10">
                <PackageCheck size={44} className="mx-auto mb-4" style={{ color: "#15803D" }} />
                <p className="heading-md mb-2" style={{ color: "var(--navy)" }}>{poResult.po_number}</p>
                <p className="body-sm mb-1">
                  SAP PO: <b>{poResult.sap_po_number ?? "—"}</b>{poResult.sap_mode === "mock" ? " (sandbox)" : ""}
                </p>
                <a
                  href={`/api/pos/${poResult.po_id}/pdf`}
                  target="_blank"
                  className="btn btn-dark mt-5"
                  style={{ textDecoration: "none", padding: "11px 22px" }}
                >
                  <FileText size={14} /> Download PO PDF
                </a>
              </div>
            ) : (
              <>
                <div className="modal-body flex flex-col gap-4">
                  {stockLoading && <p className="body-md text-center py-6">Checking stock across warehouses…</p>}

                  {!stockLoading && stockRows && (
                    <>
                      {stockRows.some((r) => r.suggestion) ? (
                        <div className="px-4 py-3 rounded-xl" style={{ background: "rgba(245,166,35,0.1)", border: "1px solid rgba(245,166,35,0.3)" }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: "#B97A0A" }}>
                            ⚠ Stock found — you may be about to order something you already have.
                          </p>
                        </div>
                      ) : (
                        <p className="body-sm px-4 py-3 rounded-xl" style={{ background: "var(--paper)" }}>
                          ✓ No usable stock found for these items — full quantities will be ordered.
                        </p>
                      )}

                      {stockRows.map((r: any) => (
                        <div key={r.pr_item_id} className="rounded-xl p-4" style={{ border: "1px solid var(--border)" }}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-dark)" }}>{r.item_name}</p>
                              <p className="body-sm" style={{ fontSize: 12 }}>
                                Requested: {r.quantity} · {r.material_code ?? "no material code"}
                              </p>
                            </div>
                            {r.total > 0 ? (
                              <span className="pill pill-amber">{r.total} in stock{r.cached ? " (cached)" : ""}</span>
                            ) : (
                              <span className="pill pill-gray">no stock</span>
                            )}
                          </div>
                          {r.total > 0 && (
                            <>
                              <p className="body-sm mt-2" style={{ fontSize: 12 }}>
                                {Object.entries(r.stock as Record<string, number>).filter(([, v]) => Number(v) > 0).map(([w, v]) => `${w}: ${v}`).join(" · ")}
                                {r.last_movement_date ? ` · last movement ${new Date(r.last_movement_date).toLocaleDateString("en-IN")}` : ""}
                              </p>
                              {r.suggestion && (
                                <p className="body-sm mt-1.5" style={{ fontSize: 12, color: "#B97A0A", fontWeight: 600 }}>
                                  {r.suggestion.message}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-3">
                                <label className="label" style={{ fontSize: 10 }}>Order qty</label>
                                <input
                                  className="app-input"
                                  style={{ width: 110, padding: "7px 10px" }}
                                  type="number" min={0} step="any"
                                  value={overrides[r.pr_item_id] ?? r.quantity}
                                  onChange={(e) => setOverrides({ ...overrides, [r.pr_item_id]: Number(e.target.value) })}
                                />
                                <span className="body-sm" style={{ fontSize: 12 }}>0 = use existing stock, skip this line</span>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </>
                  )}

                  {/* Override reason — required to order despite available stock */}
                  {!stockLoading && stockRows?.some((r) => r.suggestion) && (
                    <div className="rounded-xl p-4" style={{ background: "var(--paper)", border: "1px solid var(--border)" }}>
                      <label className="label block mb-1.5" style={{ fontSize: 10 }}>Reason for ordering despite stock *</label>
                      <select className="app-select" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}>
                        <option value="">— select a reason —</option>
                        {OVERRIDE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  )}

                  {poError && <p className="body-sm" style={{ color: "#DC2626" }}>{poError}</p>}
                </div>
                <div className="modal-footer">
                  <button
                    onClick={() => confirmPo(false)}
                    disabled={poSubmitting || stockLoading || (!!stockRows?.some((r) => r.suggestion) && !overrideReason)}
                    title={stockRows?.some((r) => r.suggestion) && !overrideReason ? "Select an override reason first" : undefined}
                    className="btn btn-outline"
                    style={{ padding: "10px 16px" }}
                  >
                    Order full quantities
                  </button>
                  <button
                    onClick={() => confirmPo(true)}
                    disabled={poSubmitting || stockLoading}
                    className="btn btn-dark"
                    style={{ padding: "10px 16px" }}
                  >
                    {poSubmitting ? "Creating PO…" : "Confirm PO →"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Manual quote entry — for the vendor who calls instead */}
      {showManual && (
        <div className="modal-overlay" onClick={() => setShowManual(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="heading-sm">Manual quote entry</h2>
              <button onClick={() => setShowManual(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={(e) => submitManual(e)}>
              <div className="modal-body flex flex-col gap-4">
                <p className="body-sm">For vendors who quote over the phone — record it here so it lands in the comparison. You are recorded as the submitter.</p>
                <div>
                  <label className="label block mb-1.5">Vendor *</label>
                  <select
                    className="app-select"
                    value={manual.vendor_id || (manual.vendor_name && !vendorOptions.some((v) => v.name === manual.vendor_name) ? "__other" : "")}
                    onChange={(e) => {
                      if (e.target.value === "__other") setManual({ ...manual, vendor_id: "", vendor_name: "" });
                      else { const v = vendorOptions.find((o) => o.id === e.target.value); setManual({ ...manual, vendor_id: v?.id ?? "", vendor_name: v?.name ?? "" }); }
                    }}
                  >
                    <option value="">— select vendor —</option>
                    {vendorOptions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    <option value="__other">Other (new phone vendor)…</option>
                  </select>
                  {!manual.vendor_id && (
                    <input className="app-input mt-2" required value={manual.vendor_name} onChange={(e) => setManual({ ...manual, vendor_name: e.target.value })} placeholder="New vendor name (phone quote)" />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label block mb-1.5">Lead time (days)</label>
                    <input className="app-input" type="number" min={0} max={365} value={manual.delivery_days} onChange={(e) => setManual({ ...manual, delivery_days: e.target.value })} />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Payment terms</label>
                    <input className="app-input" value={manual.payment_terms} onChange={(e) => setManual({ ...manual, payment_terms: e.target.value })} placeholder="30 days credit" />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Delivery terms</label>
                    <input className="app-input" value={manual.delivery_terms} onChange={(e) => setManual({ ...manual, delivery_terms: e.target.value })} placeholder="Ex-works / FOR site" />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Notes</label>
                    <input className="app-input" value={manual.notes} onChange={(e) => setManual({ ...manual, notes: e.target.value })} placeholder="any caveats" />
                  </div>
                </div>
                {items.map((it) => {
                  const row = manual.prices[it.id] ?? { price: "", unit: it.unit };
                  const setRow = (patch: Partial<typeof row>) => setManual({ ...manual, prices: { ...manual.prices, [it.id]: { ...row, ...patch } } });
                  const ambiguous = row.unit === "box" || row.unit === "set";
                  const preview = previewConversion(row.price, row.unit || it.unit, it.unit, row.pack_size);
                  return (
                    <div key={it.id} className="flex flex-col gap-2 pb-2" style={{ borderBottom: "1px dashed var(--border)" }}>
                      <label className="label">{it.item_name} — needs {it.quantity} {unitLabel(it.unit)} (base unit, locked)</label>
                      <div className="grid grid-cols-[1fr_1fr_120px] gap-2">
                        <input className="app-input" type="number" step="0.01" min={0} placeholder="₹ price"
                          value={row.price} onChange={(e) => setRow({ price: e.target.value })} />
                        <select className="app-select" value={row.unit || it.unit} onChange={(e) => setRow({ unit: e.target.value })}>
                          {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>per {u.label}</option>)}
                        </select>
                        <input className="app-input" type="number" min={0} placeholder="qty avail"
                          value={row.available_qty ?? ""} onChange={(e) => setRow({ available_qty: e.target.value })} />
                      </div>
                      {ambiguous && (
                        <input className="app-input" type="number" min={1} placeholder={`Units per ${unitLabel(row.unit)} (e.g. 50)`}
                          value={row.pack_size ?? ""} onChange={(e) => setRow({ pack_size: e.target.value })} />
                      )}
                      {preview && <p className="body-sm" style={{ fontSize: 11, color: "var(--navy)" }}>↳ {preview}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowManual(false)} className="btn btn-outline" style={{ padding: "10px 18px" }}>Cancel</button>
                <button type="submit" disabled={saving} className="btn btn-dark" style={{ padding: "10px 18px" }}>
                  {saving ? "Saving…" : "Save quote"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
