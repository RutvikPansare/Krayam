"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload, ReceiptText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatINR } from "@/lib/units";
import { format } from "date-fns";

/** Feature 12 — invoice list + upload for 3-way matching. */

const INV_PILL: Record<string, string> = {
  received: "pill-gray", extracting: "pill-amber", matching: "pill-amber",
  review_required: "pill-red", approved: "pill-green", rejected: "pill-red",
  duplicate_blocked: "pill-red", failed: "pill-red",
};
const INV_LABEL: Record<string, string> = {
  received: "Received", extracting: "Extracting…", matching: "Matching…",
  review_required: "Review required", approved: "Approved ✓", rejected: "Rejected",
  duplicate_blocked: "Duplicate blocked", failed: "Extraction failed",
};

interface InvRow {
  id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  total_amount: number | null;
  status: string;
  created_at: string;
  po_id: string | null;
  purchase_orders: { po_number: string } | null;
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase
      .from("invoices")
      .select("id, invoice_number, vendor_name, total_amount, status, created_at, po_id, purchase_orders(po_number)")
      .order("created_at", { ascending: false });
    setInvoices((data ?? []) as unknown as InvRow[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", files[0]);
      const res = await fetch("/api/invoices", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      router.push(`/dashboard/invoices/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  }

  return (
    <div className="p-8 max-w-6xl w-full mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="heading-lg mb-1">Invoices</h1>
          <p className="body-sm">Upload vendor invoices — data is extracted automatically and 3-way matched against the PO and GRN before payment.</p>
        </div>
        <label className="btn btn-dark flex-shrink-0" style={{ cursor: "pointer", opacity: uploading ? 0.6 : 1 }}>
          <Upload size={15} /> {uploading ? "Extracting…" : "Upload invoice PDF"}
          <input type="file" accept="application/pdf,.pdf" hidden disabled={uploading} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </label>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl mb-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <p style={{ fontSize: 13, color: "#EF4444" }}>{error}</p>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="px-6 py-16 text-center body-md">Loading…</div>
        ) : invoices.length === 0 ? (
          <div className="px-6 py-16 text-center body-md">
            <ReceiptText size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
            No invoices yet. Upload a vendor invoice PDF to start the 3-way match.
          </div>
        ) : (
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Invoice #", "Vendor", "PO", "Total", "Status", "Uploaded", ""].map((h, i) => (
                  <th key={i} className="text-left px-5 py-3 label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-5 py-3.5" style={{ fontWeight: 600, color: "var(--navy)" }}>{inv.invoice_number ?? "—"}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-dark)" }}>{inv.vendor_name ?? "—"}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>{inv.purchase_orders?.po_number ?? "unlinked"}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-dark)", fontWeight: 600 }}>
                    {inv.total_amount != null ? formatINR(Number(inv.total_amount)) : "—"}
                  </td>
                  <td className="px-5 py-3.5"><span className={`pill ${INV_PILL[inv.status] ?? "pill-gray"}`}>{INV_LABEL[inv.status] ?? inv.status}</span></td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-muted)", fontSize: 13 }}>{format(new Date(inv.created_at), "d MMM")}</td>
                  <td className="px-5 py-3.5">
                    <Link href={`/dashboard/invoices/${inv.id}`} className="body-sm" style={{ fontWeight: 600, color: "var(--navy)", textDecoration: "none" }}>
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
