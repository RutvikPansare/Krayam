"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Vendor } from "@/types";
import { Plus, X } from "lucide-react";

export default function VendorsPage() {
  const supabase = createClient();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", city: "", categories: "" });

  async function load() {
    const { data } = await supabase.from("vendors").select("*").order("name");
    setVendors((data ?? []) as Vendor[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function addVendor(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("vendors").insert({
      name: form.name,
      email: form.email,
      phone: form.phone || null,
      city: form.city || null,
      categories: form.categories.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean),
    });
    setSaving(false);
    if (!error) {
      setShowModal(false);
      setForm({ name: "", email: "", phone: "", city: "", categories: "" });
      load();
    }
  }

  async function toggleActive(v: Vendor) {
    await supabase.from("vendors").update({ active: !v.active }).eq("id", v.id);
    load();
  }

  return (
    <div className="p-8 max-w-6xl w-full mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="heading-lg mb-1">Vendor master</h1>
          <p className="body-sm">Vendors here receive RFQ emails automatically when a PR is approved.</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn btn-dark" style={{ padding: "11px 20px" }}>
          <Plus size={15} /> Add vendor
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="px-6 py-16 text-center body-sm">Loading vendors…</div>
        ) : vendors.length === 0 ? (
          <div className="px-6 py-16 text-center body-md">No vendors yet — add your first one.</div>
        ) : (
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Vendor", "Email", "City", "Categories", "Status", ""].map((h, i) => (
                  <th key={i} className="text-left px-5 py-3 label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} style={{ borderBottom: "1px solid var(--border)", opacity: v.active ? 1 : 0.5 }}>
                  <td className="px-5 py-3.5" style={{ fontWeight: 600, color: "var(--text-dark)" }}>{v.name}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>{v.email}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>{v.city ?? "—"}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {v.categories.map((c) => <span key={c} className="pill pill-gray">{c}</span>)}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`pill ${v.active ? "pill-green" : "pill-gray"}`}>{v.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => toggleActive(v)}
                      className="body-sm"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontWeight: 600 }}
                    >
                      {v.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="heading-sm">Add vendor</h2>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={addVendor}>
              <div className="modal-body flex flex-col gap-4">
                <div>
                  <label className="label block mb-1.5">Vendor name *</label>
                  <input className="app-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sharma Bearings & Co" />
                </div>
                <div>
                  <label className="label block mb-1.5">Email *</label>
                  <input className="app-input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="sales@vendor.com" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label block mb-1.5">Phone</label>
                    <input className="app-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91…" />
                  </div>
                  <div>
                    <label className="label block mb-1.5">City</label>
                    <input className="app-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Pune" />
                  </div>
                </div>
                <div>
                  <label className="label block mb-1.5">Categories (comma-separated)</label>
                  <input className="app-input" value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} placeholder="bearings, mechanical" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-outline" style={{ padding: "10px 18px" }}>Cancel</button>
                <button type="submit" disabled={saving} className="btn btn-dark" style={{ padding: "10px 18px" }}>
                  {saving ? "Saving…" : "Add vendor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
