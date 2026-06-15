"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { Plus, Trash2, CheckCircle2, PackageSearch, Paperclip, X, FileText, Loader2, Warehouse, ShoppingCart } from "lucide-react";
import Fuse from "fuse.js";
import { UNIT_OPTIONS } from "@/lib/units";
import { prFormSchema, type PRFormData } from "@/lib/pr-schema";
import type { MaterialMatch, MaterialIndexRow, StockResponse } from "@/types/materials";
import { createClient } from "@/lib/supabase/client";
import { ATTACH_BUCKET, MAX_ATTACH_BYTES, MAX_ATTACH_PER_PR, ALLOWED_TYPES, allowedExt } from "@/lib/attachments";

const ACCEPT = ALLOWED_TYPES.map((t) => "." + t.ext).join(",") + ",application/pdf,image/png,image/jpeg";
interface PendingUpload { key: string; name: string; status: "uploading" | "verifying" | "error"; error?: string; file: File }

interface CostCenter {
  code: string;
  name: string;
}

const emptyItem = () => ({ item_name: "", material_code: "", quantity: undefined as unknown as number, unit: "piece", notes: "" });

const DEPARTMENTS = ["Maintenance", "Production", "Stores", "Quality", "Electrical", "Utilities", "Other"];

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p role="alert" style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }}>{message}</p>;
}

export default function NewPRPage() {
  const {
    register, control, handleSubmit, setValue, reset, getValues,
    formState: { errors, isSubmitting },
  } = useForm<PRFormData>({
    resolver: zodResolver(prFormSchema),
    defaultValues: {
      requester_name: "",
      requester_email: "",
      department: "Maintenance",
      plant: "",
      cost_center: "",
      priority: "normal",
      needed_by: "",
      justification: "",
      approver_email: "",
      items: [emptyItem()],
      attachment_ids: [],
    },
    mode: "onTouched",
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<{ pr_number: string } | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);

  // Feature 11 — spec sheet attachments (uploaded before submit, linked on submit)
  const [attachments, setAttachments] = useState<{ id: string; file_name: string; size_bytes: number }[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]); // in-flight / failed
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploading = uploads.some((u) => u.status !== "error");
  const atMax = attachments.length >= MAX_ATTACH_PER_PR;

  // Feature 07 — duplicate detection state, keyed by item row index
  const [suggestions, setSuggestions] = useState<Record<number, MaterialMatch[]>>({});
  const [picked, setPicked] = useState<Record<number, MaterialMatch | null>>({});
  const [searching, setSearching] = useState<Record<number, boolean>>({});
  const [noMatch, setNoMatch] = useState<Record<number, boolean>>({});
  const [stockLoading, setStockLoading] = useState<Record<number, boolean>>({});
  const [fromStock, setFromStock] = useState<Record<number, boolean>>({}); // line routed to warehouse
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const searchAborters = useRef<Record<number, AbortController>>({});
  const stockFetched = useRef<Set<string>>(new Set()); // dedupe lazy stock lookups
  const fuseRef = useRef<Fuse<MaterialIndexRow> | null>(null);

  // PWA service worker + cost center master + Fuse.js material index
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* PWA is progressive: form works without it */ });
    }
    fetch("/api/cost-centers")
      .then((r) => r.json())
      .then((b) => setCostCenters(b.cost_centers ?? []))
      .catch(() => { /* dropdown stays empty; validation will prompt */ });

    // Build the client-side fuzzy index once for instant approximate matches.
    fetch("/api/materials/index")
      .then((r) => r.json())
      .then((b) => {
        const rows: MaterialIndexRow[] = b.materials ?? [];
        fuseRef.current = new Fuse(rows, {
          keys: ["description", "material_code"],
          threshold: 0.4, // fuzzy distance, not cosine — instant-layer only
          includeScore: true,
        });
      })
      .catch(() => { /* Fuse is an enhancement; vector search still works */ });
  }, []);

  /** Instant local fuzzy matches from Fuse (shown while vector search runs). */
  function fuzzyMatches(q: string): MaterialMatch[] {
    if (!fuseRef.current) return [];
    return fuseRef.current.search(q, { limit: 3 }).map((r) => ({
      material_code: r.item.material_code,
      description: r.item.description,
      unit: r.item.unit,
      unit_price: r.item.unit_price,
      // Fuse score is a distance (0 = perfect); convert to a rough similarity.
      score: 1 - (r.score ?? 0),
      source: "fuzzy" as const,
    }));
  }

  /** Merge + dedupe by material_code, keeping the highest score; top 3. */
  function mergeMatches(a: MaterialMatch[], b: MaterialMatch[]): MaterialMatch[] {
    const byCode = new Map<string, MaterialMatch>();
    for (const m of [...a, ...b]) {
      const prev = byCode.get(m.material_code);
      // Prefer vector source on tie; otherwise higher score.
      if (!prev || m.score > prev.score || (m.score === prev.score && m.source === "vector")) {
        byCode.set(m.material_code, prev ? { ...m, stock: prev.stock, total_stock: prev.total_stock } : m);
      }
    }
    return Array.from(byCode.values()).sort((x, y) => y.score - x.score).slice(0, 3);
  }

  function searchMaterials(i: number, q: string) {
    setPicked((p) => ({ ...p, [i]: null }));
    setFromStock((f) => ({ ...f, [i]: false }));
    clearTimeout(searchTimers.current[i]);
    searchAborters.current[i]?.abort(); // cancel the previous in-flight request

    const query = q.trim();
    if (query.length < 3) {
      setSuggestions((s) => ({ ...s, [i]: [] }));
      setNoMatch((n) => ({ ...n, [i]: false }));
      setSearching((s) => ({ ...s, [i]: false }));
      return;
    }

    // Instant fuzzy layer (no network) while the debounced vector search runs.
    const fuzzy = fuzzyMatches(query);
    if (fuzzy.length) setSuggestions((s) => ({ ...s, [i]: fuzzy }));

    searchTimers.current[i] = setTimeout(async () => {
      const ac = new AbortController();
      searchAborters.current[i] = ac;
      setSearching((s) => ({ ...s, [i]: true }));
      try {
        const res = await fetch(`/api/materials/search?q=${encodeURIComponent(query)}`, { signal: ac.signal });
        const body = await res.json();
        const vector: MaterialMatch[] = body.results ?? [];
        const merged = mergeMatches(vector, fuzzy);
        setSuggestions((s) => ({ ...s, [i]: merged }));
        setNoMatch((n) => ({ ...n, [i]: merged.length === 0 }));
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // superseded — ignore
        /* search is best-effort — never block the form */
      } finally {
        setSearching((s) => ({ ...s, [i]: false }));
      }
    }, 300);
  }

  /** Lazy stock lookup — only when a result is hovered/focused. Deduped. */
  async function loadStock(i: number, code: string) {
    const key = `${i}:${code}`;
    if (stockFetched.current.has(key)) return;
    stockFetched.current.add(key);
    setStockLoading((s) => ({ ...s, [i]: true }));
    try {
      const res = await fetch(`/api/materials/${encodeURIComponent(code)}/stock`);
      const data: StockResponse = await res.json();
      setSuggestions((s) => {
        const list = (s[i] ?? []).map((m) =>
          m.material_code === code ? { ...m, stock: data.stock, total_stock: data.total, stock_source: data.source } : m,
        );
        return { ...s, [i]: list };
      });
    } catch {
      /* stock is optional — dropdown still works without numbers */
    } finally {
      setStockLoading((s) => ({ ...s, [i]: false }));
    }
  }

  function pickMaterial(i: number, m: MaterialMatch) {
    setValue(`items.${i}.item_name`, m.description, { shouldValidate: true });
    setValue(`items.${i}.material_code`, m.material_code);
    setValue(`items.${i}.unit`, m.unit);
    setPicked((p) => ({ ...p, [i]: m }));
    setSuggestions((s) => ({ ...s, [i]: [] }));
    setNoMatch((n) => ({ ...n, [i]: false }));
    // Fetch live stock for the chosen item so the use-stock decision is informed.
    if (m.total_stock == null) loadStock(i, m.material_code);
  }

  /**
   * Direct-to-storage upload: presign → browser uploads straight to the
   * private bucket (no API proxy) → server validates the bytes (magic-byte)
   * on confirm. Client-side size/type checks are UX only; the server repeats
   * them. Per-file status with a retry path on failure.
   */
  async function uploadOne(file: File) {
    const key = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // Client-side validation (UX) — server re-validates.
    if (!allowedExt(file.name)) {
      setUploads((u) => [...u, { key, name: file.name, status: "error", error: "Only PDF, PNG, JPG, DWG.", file }]);
      return;
    }
    if (file.size > MAX_ATTACH_BYTES) {
      setUploads((u) => [...u, { key, name: file.name, status: "error", error: "Max 10 MB.", file }]);
      return;
    }
    if (attachments.length + uploads.filter((x) => x.status !== "error").length >= MAX_ATTACH_PER_PR) {
      setUploads((u) => [...u, { key, name: file.name, status: "error", error: `Max ${MAX_ATTACH_PER_PR} attachments.`, file }]);
      return;
    }

    setUploads((u) => [...u, { key, name: file.name, status: "uploading", file }]);
    const fail = (msg: string) => setUploads((u) => u.map((x) => x.key === key ? { ...x, status: "error", error: msg } : x));
    try {
      // 1. presigned grant
      const signRes = await fetch("/api/attachments/sign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.name, size_bytes: file.size, staged_count: attachments.length }),
      });
      const grant = await signRes.json();
      if (!signRes.ok) return fail(grant.error ?? "Could not start upload");

      // 2. upload directly to storage (bypasses our API)
      const supabase = createClient();
      const { error: upErr } = await supabase.storage.from(ATTACH_BUCKET).uploadToSignedUrl(grant.storage_path, grant.token, file);
      if (upErr) return fail(upErr.message);

      // 3. server validates the actual bytes
      setUploads((u) => u.map((x) => x.key === key ? { ...x, status: "verifying" } : x));
      const confRes = await fetch(`/api/attachments/${grant.id}/confirm`, { method: "POST" });
      const conf = await confRes.json();
      if (!confRes.ok) return fail(conf.error ?? "File rejected on validation");

      setAttachments((a) => [...a, { id: conf.id, file_name: conf.file_name, size_bytes: conf.size_bytes }]);
      setUploads((u) => u.filter((x) => x.key !== key)); // done — drop from pending
    } catch (err) {
      fail(err instanceof Error ? err.message : "Upload failed");
    }
  }

  async function uploadSpecs(files: FileList | null) {
    if (!files) return;
    setUploadError(null);
    for (const file of Array.from(files)) await uploadOne(file);
  }

  function retryUpload(key: string) {
    const u = uploads.find((x) => x.key === key);
    if (!u) return;
    setUploads((list) => list.filter((x) => x.key !== key));
    uploadOne(u.file);
  }

  async function removeAttachment(id: string) {
    setAttachments((a) => a.filter((x) => x.id !== id));
    // Soft delete server-side (file is preserved in storage for audit).
    await fetch(`/api/attachments?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function onSubmit(data: PRFormData) {
    setServerError(null);
    try {
      const res = await fetch("/api/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, attachment_ids: attachments.map((a) => a.id) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Submission failed");
      setDone({ pr_number: body.pr_number });
    } catch (err) {
      setServerError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "Could not reach the server. Check your network signal and try again — nothing was lost."
      );
    }
  }

  function raiseAnother() {
    // Keep who-is-asking fields: the same engineer usually raises several
    // requests in a row. Everything request-specific resets.
    const keep = getValues();
    reset({
      requester_name: keep.requester_name,
      requester_email: keep.requester_email,
      department: keep.department,
      plant: keep.plant,
      cost_center: keep.cost_center,
      priority: "normal",
      needed_by: "",
      justification: "",
      approver_email: keep.approver_email,
      items: [emptyItem()],
      attachment_ids: [],
    });
    setAttachments([]);
    setSuggestions({});
    setPicked({});
    setServerError(null);
    setDone(null);
  }

  if (done) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-6" style={{ background: "var(--paper)" }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card w-full text-center p-10"
          style={{ maxWidth: 420 }}
        >
          <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: "#15803D" }} />
          <h1 className="heading-md mb-2">Request submitted</h1>
          <p className="body-md mb-1">Your request number:</p>
          <p className="heading-lg mb-5" style={{ color: "var(--navy)" }}>{done.pr_number}</p>
          <p className="body-sm mb-7">Your approver has been emailed. You&apos;ll get a confirmation once it&apos;s approved.</p>
          <button onClick={raiseAnother} className="btn btn-dark w-full">
            Raise another request
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-16" style={{ background: "var(--paper)" }}>
      {/* Header */}
      <div className="px-5 pt-8 pb-6" style={{ background: "var(--navy)" }}>
        <div className="max-w-md mx-auto">
          <a href="/" className="font-logo text-white" style={{ fontSize: 24, textDecoration: "none" }}>
            Krayam<span style={{ color: "var(--amber)" }}>.</span>
          </a>
          <h1 className="heading-md text-white mt-3">New purchase request</h1>
          <p className="body-sm mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
            Takes under a minute. No app install needed. Or{" "}
            <a href="/pr/assistant" style={{ color: "var(--amber)", textDecoration: "underline" }}>
              just describe what you need →
            </a>
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-md mx-auto px-5 -mt-3 flex flex-col gap-4">
        {/* Requester card */}
        <div className="card p-5 flex flex-col gap-4">
          <p className="label">Who&apos;s asking</p>
          <div>
            <label className="label block mb-1.5" htmlFor="requester_name">Your name *</label>
            <input id="requester_name" className="app-input" autoComplete="name" placeholder="Ramesh Kumar" {...register("requester_name")} />
            <FieldError message={errors.requester_name?.message} />
          </div>
          <div>
            <label className="label block mb-1.5" htmlFor="requester_email">Your email *</label>
            <input id="requester_email" className="app-input" type="email" inputMode="email" autoComplete="email" placeholder="you@company.com" {...register("requester_email")} />
            <FieldError message={errors.requester_email?.message} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label block mb-1.5" htmlFor="department">Department</label>
              <select id="department" className="app-select" {...register("department")}>
                {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label block mb-1.5" htmlFor="plant">Plant / unit</label>
              <input id="plant" className="app-input" placeholder="Plant 1" {...register("plant")} />
            </div>
          </div>
          <div>
            <label className="label block mb-1.5" htmlFor="cost_center">Cost center *</label>
            <select id="cost_center" className="app-select" {...register("cost_center")}>
              <option value="">— select cost center —</option>
              {costCenters.map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
              ))}
            </select>
            <FieldError message={errors.cost_center?.message} />
          </div>
        </div>

        {/* Items card */}
        <div className="card p-5 flex flex-col gap-5">
          <p className="label">What you need</p>
          {fields.map((field, i) => (
            <div key={field.id} className="flex flex-col gap-3 pb-4" style={{ borderBottom: i < fields.length - 1 ? "1px dashed var(--border)" : "none" }}>
              <div className="flex items-center justify-between">
                <span className="body-sm" style={{ fontWeight: 700, color: "var(--text-dark)" }}>Item {i + 1}</span>
                {fields.length > 1 && (
                  <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => remove(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#DC2626" }}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  className="app-input"
                  placeholder="Item name, e.g. Ball Bearing 6205ZZ *"
                  autoComplete="off"
                  {...register(`items.${i}.item_name`, {
                    onChange: (e) => searchMaterials(i, e.target.value),
                  })}
                />
                <FieldError message={errors.items?.[i]?.item_name?.message} />
                {searching[i] && (suggestions[i]?.length ?? 0) === 0 && (
                  <span className="absolute right-3 top-3" style={{ color: "var(--text-muted)" }}>
                    <Loader2 size={14} className="animate-spin" />
                  </span>
                )}
                {(suggestions[i]?.length ?? 0) > 0 && (
                  <div
                    className="absolute left-0 right-0 z-20 mt-1 rounded-xl overflow-hidden"
                    style={{ background: "white", border: "1.5px solid var(--border)", boxShadow: "0 12px 32px rgba(0,0,0,0.12)" }}
                  >
                    <p className="label px-3 pt-2.5 pb-1 flex items-center gap-1" style={{ fontSize: 9 }}>
                      <PackageSearch size={10} style={{ verticalAlign: -1 }} />
                      Already in material master — avoid creating a duplicate code
                      {searching[i] && <Loader2 size={9} className="animate-spin ml-1" />}
                    </p>
                    {suggestions[i].map((m) => (
                      <button
                        key={m.material_code}
                        type="button"
                        onClick={() => pickMaterial(i, m)}
                        onMouseEnter={() => loadStock(i, m.material_code)}
                        onFocus={() => loadStock(i, m.material_code)}
                        className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2"
                        style={{ background: "none", border: "none", borderTop: "1px solid var(--border)", cursor: "pointer" }}
                      >
                        <span style={{ minWidth: 0 }}>
                          <span className="block" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dark)" }}>{m.description}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                            {m.material_code} · {Math.round(m.score * 100)}% match
                          </span>
                        </span>
                        <span
                          className="pill flex-shrink-0"
                          style={{
                            background: (m.total_stock ?? 0) > 0 ? "rgba(34,197,94,0.1)" : "var(--paper-2)",
                            color: (m.total_stock ?? 0) > 0 ? "#15803D" : "var(--text-muted)",
                            border: "1px solid " + ((m.total_stock ?? 0) > 0 ? "rgba(34,197,94,0.25)" : "var(--border)"),
                          }}
                        >
                          {m.total_stock == null ? "stock…" : m.total_stock > 0 ? `${m.total_stock} in stock` : "no stock"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* No matches above threshold — engineer proceeds with a new item */}
              {noMatch[i] && !picked[i] && (
                <p className="px-3 py-2 rounded-lg" style={{ fontSize: 12, color: "var(--text-muted)", background: "var(--paper-2)", border: "1px solid var(--border)" }}>
                  No similar items found — creating a new item.
                </p>
              )}

              {/* Selected existing item with stock: offer the two clear options */}
              {picked[i] && stockLoading[i] && (
                <p className="px-3 py-2.5 rounded-lg flex items-center gap-2" style={{ fontSize: 12, color: "var(--text-mid)", background: "var(--paper-2)", border: "1px solid var(--border)" }}>
                  <Loader2 size={13} className="animate-spin" /> Checking live stock for {picked[i]!.material_code}…
                </p>
              )}
              {picked[i] && !stockLoading[i] && (picked[i]!.total_stock ?? 0) > 0 && (
                <div className="px-3 py-3 rounded-lg" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <p style={{ fontSize: 13, color: "#15803D", fontWeight: 700 }}>
                    {picked[i]!.total_stock} {picked[i]!.unit} available at {Object.entries(picked[i]!.stock ?? {}).filter(([, q]) => Number(q) > 0).map(([w]) => w).join(", ")} — use existing stock?
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-mid)", marginTop: 2 }}>
                    {Object.entries(picked[i]!.stock ?? {}).filter(([, q]) => Number(q) > 0).map(([w, q]) => `${w}: ${q}`).join(" · ")}
                    {picked[i]!.stock_source === "mirror" ? " (last synced stock)" : " (live SAP)"}
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      type="button"
                      onClick={() => { setFromStock((f) => ({ ...f, [i]: true })); setValue(`items.${i}.notes`, `Issue from existing stock (${picked[i]!.material_code}) — route to stores, do not order.`); }}
                      className="btn flex-1"
                      style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600,
                        background: fromStock[i] ? "#15803D" : "white",
                        color: fromStock[i] ? "white" : "#15803D",
                        border: "1.5px solid #15803D" }}
                    >
                      <Warehouse size={13} /> Use existing stock
                    </button>
                    <button
                      type="button"
                      onClick={() => { setFromStock((f) => ({ ...f, [i]: false })); setValue(`items.${i}.notes`, ""); }}
                      className="btn flex-1"
                      style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600,
                        background: !fromStock[i] ? "var(--navy)" : "white",
                        color: !fromStock[i] ? "white" : "var(--navy)",
                        border: "1.5px solid var(--navy)" }}
                    >
                      <ShoppingCart size={13} /> Order from vendor anyway
                    </button>
                  </div>
                  {fromStock[i] && (
                    <p style={{ fontSize: 11, color: "#15803D", marginTop: 6, fontWeight: 600 }}>
                      ✓ This line will be routed to the warehouse for issue from stock.
                    </p>
                  )}
                </div>
              )}
              {picked[i] && !stockLoading[i] && (picked[i]!.total_stock ?? 0) === 0 && (
                <p className="px-3 py-2 rounded-lg" style={{ fontSize: 12, color: "var(--text-mid)", background: "var(--paper-2)", border: "1px solid var(--border)" }}>
                  ✓ Existing code {picked[i]!.material_code} selected — no stock on hand, ordering required.
                </p>
              )}
              <input className="app-input" placeholder="Material code (if known)" {...register(`items.${i}.material_code`)} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input
                    className="app-input"
                    type="number" min="0.01" step="any" inputMode="decimal"
                    placeholder="Qty *"
                    {...register(`items.${i}.quantity`, { valueAsNumber: true })}
                  />
                  <FieldError message={errors.items?.[i]?.quantity?.message} />
                </div>
                <select className="app-select" {...register(`items.${i}.unit`)}>
                  {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <input className="app-input" placeholder="Notes — brand, spec, machine…" {...register(`items.${i}.notes`)} />
            </div>
          ))}
          <button type="button" onClick={() => append(emptyItem())} className="btn btn-outline w-full" style={{ padding: "11px" }}>
            <Plus size={15} /> Add another item
          </button>
        </div>

        {/* Spec sheets card — Feature 11 */}
        <div className="card p-5 flex flex-col gap-3">
          <p className="label">Spec sheets &amp; drawings (optional)</p>
          <p className="body-sm" style={{ fontSize: 12 }}>
            Attach drawings or spec sheets (PDF, PNG, JPG, DWG) — up to {MAX_ATTACH_PER_PR}, 10&nbsp;MB each. They&apos;re sent to every vendor with the RFQ email as secure links.
          </p>
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg" style={{ background: "var(--paper-2)", border: "1px solid var(--border)" }}>
              <FileText size={15} style={{ color: "var(--navy)", flexShrink: 0 }} />
              <span className="flex-1 truncate" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dark)" }}>{a.file_name}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{(a.size_bytes / 1024 / 1024).toFixed(2)} MB</span>
              <button type="button" aria-label={`Remove ${a.file_name}`} onClick={() => removeAttachment(a.id)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#DC2626", padding: 2 }}>
                <X size={14} />
              </button>
            </div>
          ))}
          {/* In-flight + failed uploads */}
          {uploads.map((u) => (
            <div key={u.key} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg"
              style={{ background: u.status === "error" ? "rgba(239,68,68,0.06)" : "var(--paper-2)", border: `1px solid ${u.status === "error" ? "rgba(239,68,68,0.3)" : "var(--border)"}` }}>
              {u.status === "error"
                ? <X size={15} style={{ color: "#DC2626", flexShrink: 0 }} />
                : <Loader2 size={15} className="animate-spin" style={{ color: "var(--navy)", flexShrink: 0 }} />}
              <span className="flex-1 truncate" style={{ fontSize: 13, color: "var(--text-dark)" }}>{u.name}</span>
              {u.status === "error" ? (
                <>
                  <span style={{ fontSize: 11, color: "#DC2626" }}>{u.error}</span>
                  <button type="button" onClick={() => retryUpload(u.key)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--navy)", fontSize: 12, fontWeight: 700 }}>Retry</button>
                  <button type="button" onClick={() => setUploads((l) => l.filter((x) => x.key !== u.key))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}><X size={13} /></button>
                </>
              ) : (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{u.status === "verifying" ? "Verifying…" : "Uploading…"}</span>
              )}
            </div>
          ))}
          {!atMax && (
            <label className="btn btn-outline w-full" style={{ padding: "11px", cursor: uploading ? "wait" : "pointer", opacity: uploading ? 0.6 : 1 }}>
              <Paperclip size={15} /> {uploading ? "Uploading…" : "Attach file"}
              <input type="file" accept={ACCEPT} multiple hidden disabled={uploading}
                onChange={(e) => { uploadSpecs(e.target.files); e.target.value = ""; }} />
            </label>
          )}
          {atMax && <p className="body-sm" style={{ fontSize: 12, color: "var(--text-muted)" }}>Maximum {MAX_ATTACH_PER_PR} attachments reached.</p>}
          {uploadError && <p role="alert" style={{ fontSize: 12, color: "#EF4444" }}>{uploadError}</p>}
        </div>

        {/* Approval card */}
        <div className="card p-5 flex flex-col gap-4">
          <p className="label">Urgency &amp; approval</p>
          <div>
            <label className="label block mb-1.5">Priority</label>
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <div className="grid grid-cols-4 gap-2">
                  {(["low", "normal", "high", "urgent"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => field.onChange(p)}
                      className="py-2.5 rounded-lg text-xs font-semibold capitalize"
                      style={{
                        border: field.value === p ? "1.5px solid var(--navy)" : "1.5px solid var(--border)",
                        background: field.value === p ? (p === "urgent" ? "rgba(239,68,68,0.1)" : "rgba(11,34,57,0.07)") : "white",
                        color: field.value === p ? (p === "urgent" ? "#DC2626" : "var(--navy)") : "var(--text-mid)",
                        cursor: "pointer",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            />
          </div>
          <div>
            <label className="label block mb-1.5" htmlFor="needed_by">Needed by</label>
            <input id="needed_by" className="app-input" type="date" {...register("needed_by")} />
          </div>
          <div>
            <label className="label block mb-1.5" htmlFor="justification">Why do you need this?</label>
            <textarea id="justification" className="app-textarea" rows={2} placeholder="CNC machine #3 spindle bearing worn out" {...register("justification")} />
          </div>
          <div>
            <label className="label block mb-1.5" htmlFor="approver_email">Approver email *</label>
            <input id="approver_email" className="app-input" type="email" inputMode="email" placeholder="manager@company.com" {...register("approver_email")} />
            <FieldError message={errors.approver_email?.message} />
          </div>
        </div>

        {serverError && (
          <div role="alert" className="px-4 py-3 rounded-xl" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <p style={{ fontSize: 13, color: "#EF4444" }}>{serverError}</p>
          </div>
        )}

        <button type="submit" disabled={isSubmitting} className="btn btn-dark w-full" style={{ padding: "16px", opacity: isSubmitting ? 0.7 : 1 }}>
          {isSubmitting ? "Submitting…" : "Submit request →"}
        </button>
        <p className="label text-center">Approver gets an email instantly · powered by Krayam</p>
      </form>
    </div>
  );
}
