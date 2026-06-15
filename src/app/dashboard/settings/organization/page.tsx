"use client";

import { useEffect, useState } from "react";
import { Building2, Loader2, Check } from "lucide-react";

interface Company {
  company_name: string;
  address: string | null;
  gstin: string | null;
  cin: string | null;
  logo_url: string | null;
}

/**
 * Organization profile (Tellero's "Brand" section, enterprise edition).
 * These details appear on purchase order PDFs and vendor-facing emails.
 */
export default function OrganizationPage() {
  const [form, setForm] = useState<Company>({ company_name: "", address: "", gstin: "", cin: "", logo_url: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/company")
      .then((r) => r.json())
      .then((d) => {
        if (d.company) {
          setForm({
            company_name: d.company.company_name ?? "",
            address: d.company.address ?? "",
            gstin: d.company.gstin ?? "",
            cin: d.company.cin ?? "",
            logo_url: d.company.logo_url ?? "",
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl w-full mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(11,34,57,0.07)", border: "1px solid rgba(11,34,57,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Building2 size={17} style={{ color: "var(--navy)" }} />
        </div>
        <h1 className="heading-lg">Organization</h1>
      </div>
      <p className="body-sm mb-8">
        Your company identity. This appears on purchase order PDFs, RFQ emails to vendors,
        and approval emails — keep it exactly as it should appear to suppliers.
      </p>

      {loading ? (
        <div className="card p-10 flex justify-center">
          <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : (
        <form onSubmit={save} className="card p-6 flex flex-col gap-5">
          <div>
            <label className="label block mb-1.5">Company name *</label>
            <input
              className="app-input" required
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              placeholder="Bajaj Mukund Industries Pvt Ltd"
            />
          </div>

          <div>
            <label className="label block mb-1.5">Registered address</label>
            <textarea
              className="app-textarea" rows={3}
              value={form.address ?? ""}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder={"Plot 14, MIDC Industrial Area\nPune, Maharashtra 411019"}
            />
            <p className="body-sm mt-1" style={{ fontSize: 12 }}>Printed in the buyer block of every PO PDF.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label block mb-1.5">GSTIN</label>
              <input
                className="app-input"
                value={form.gstin ?? ""}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                placeholder="27AABCB1234A1Z5"
              />
            </div>
            <div>
              <label className="label block mb-1.5">CIN</label>
              <input
                className="app-input"
                value={form.cin ?? ""}
                onChange={(e) => setForm({ ...form, cin: e.target.value })}
                placeholder="U27100MH1998PTC123456"
              />
            </div>
          </div>

          <div>
            <label className="label block mb-1.5">Logo URL</label>
            <input
              className="app-input" type="url"
              value={form.logo_url ?? ""}
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              placeholder="https://…/logo.png"
            />
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: 12, color: "#DC2626", background: "rgba(239,68,68,0.06)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="btn btn-dark" style={{ padding: "11px 24px", opacity: saving ? 0.6 : 1 }}>
              {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : "Save changes"}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 body-sm" style={{ color: "#15803D", fontWeight: 600 }}>
                <Check size={14} /> Saved
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
