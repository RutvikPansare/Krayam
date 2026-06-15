import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { format } from "date-fns";
import { formatINR } from "@/lib/units";
import { FileDown, PackageCheck } from "lucide-react";
import RetrySyncButton from "./RetrySyncButton";

export const dynamic = "force-dynamic";

interface PORow {
  id: string;
  po_number: string;
  vendor_name: string;
  total_amount: number;
  status: string;
  sap_po_number: string | null;
  sap_mode: string | null;
  sap_error: string | null;
  stock_note: string | null;
  created_at: string;
  purchase_requests: { pr_number: string } | null;
  po_items: { id: string }[];
}

const PO_PILL: Record<string, string> = {
  draft: "pill-gray", pdf_ready: "pill-amber", vendor_notified: "pill-blue",
  sent_to_sap: "pill-green", sap_sync_failed: "pill-red", received: "pill-navy", cancelled: "pill-red",
  // legacy
  created: "pill-amber", sap_pushed: "pill-green", sent: "pill-blue",
};
const PO_LABEL: Record<string, string> = {
  draft: "Draft", pdf_ready: "PDF ready", vendor_notified: "Vendor notified",
  sent_to_sap: "In SAP", sap_sync_failed: "SAP failed", received: "Received", cancelled: "Cancelled",
  // legacy
  created: "Created", sap_pushed: "In SAP", sent: "Sent",
};

export default async function POsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("id, po_number, vendor_name, total_amount, status, sap_po_number, sap_mode, sap_error, stock_note, created_at, purchase_requests(pr_number), po_items(id)")
    .order("created_at", { ascending: false });

  const pos = (data ?? []) as unknown as PORow[];

  return (
    <div className="p-8 max-w-6xl w-full mx-auto">
      <div className="mb-8">
        <h1 className="heading-lg mb-1">Purchase orders</h1>
        <p className="body-sm">Generated from winning quotes, pushed to SAP, downloadable as PDF.</p>
      </div>

      <div className="card">
        {pos.length === 0 ? (
          <div className="px-6 py-16 text-center body-md">
            No POs yet. Open an RFQ comparison and click <b>Generate PO</b> on the winning quote.
          </div>
        ) : (
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["PO #", "Vendor", "PR", "Items", "Total", "SAP PO", "Status", "Date", ""].map((h, i) => (
                  <th key={i} className="text-left px-5 py-3 label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pos.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-5 py-3.5" style={{ fontWeight: 600, color: "var(--navy)" }}>{p.po_number}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-dark)" }}>{p.vendor_name}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>{p.purchase_requests?.pr_number ?? "—"}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>{p.po_items.length}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-dark)", fontWeight: 600 }}>{formatINR(Number(p.total_amount))}</td>
                  <td className="px-5 py-3.5" style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-mid)" }}>
                    {p.sap_po_number ?? "—"}{p.sap_mode === "mock" && p.sap_po_number ? " *" : ""}
                  </td>
                  <td className="px-5 py-3.5"><span className={`pill ${PO_PILL[p.status] ?? "pill-gray"}`}>{PO_LABEL[p.status] ?? p.status}</span></td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-muted)", fontSize: 13 }}>{format(new Date(p.created_at), "d MMM")}</td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-4">
                      <a
                        href={`/api/pos/${p.id}/pdf`}
                        target="_blank"
                        className="inline-flex items-center gap-1.5 body-sm"
                        style={{ fontWeight: 600, color: "var(--navy)", textDecoration: "none" }}
                      >
                        <FileDown size={14} /> PDF
                      </a>
                      {p.status === "sap_sync_failed" && <RetrySyncButton poId={p.id} />}
                      {p.status !== "cancelled" && p.status !== "received" && (
                        <Link
                          href={`/dashboard/pos/${p.id}/receive`}
                          className="inline-flex items-center gap-1.5 body-sm"
                          style={{ fontWeight: 600, color: "#15803D", textDecoration: "none" }}
                        >
                          <PackageCheck size={14} /> Receive
                        </Link>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pos.some((p) => p.sap_mode === "mock") && (
        <p className="body-sm mt-3" style={{ fontSize: 12 }}>* SAP number generated in sandbox mode (SAP_MODE=mock)</p>
      )}
    </div>
  );
}
