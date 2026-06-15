import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { STATUS_META, type PurchaseRequest, type RFQ } from "@/types";
import { format } from "date-fns";
import { unitLabel } from "@/lib/units";
import CopyVendorLink from "./CopyVendorLink";

export const dynamic = "force-dynamic";

export default async function RequestDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const [{ data: pr }, { data: rfqs }, { data: attachments }] = await Promise.all([
    supabase.from("purchase_requests").select("*, pr_items(*)").eq("id", params.id).single(),
    supabase.from("rfqs").select("*").eq("pr_id", params.id),
    supabase.from("pr_attachments").select("id, file_name, size_bytes").eq("pr_id", params.id).is("deleted_at", null),
  ]);

  if (!pr) notFound();
  const r = pr as PurchaseRequest;
  const rfqList = (rfqs ?? []) as RFQ[];

  const facts: [string, string][] = [
    ["Requester", `${r.requester_name} (${r.requester_email})`],
    ["Department", r.department ?? "—"],
    ["Plant", r.plant ?? "—"],
    ["Priority", r.priority],
    ["Needed by", r.needed_by ? format(new Date(r.needed_by), "d MMM yyyy") : "—"],
    ["Approver", r.approver_email],
    ["Raised", format(new Date(r.created_at), "d MMM yyyy, HH:mm")],
    ["SAP PR number", r.sap_pr_number ? `${r.sap_pr_number}${r.sap_mode === "mock" ? " (sandbox)" : ""}` : "—"],
  ];

  return (
    <div className="p-8 max-w-5xl w-full mx-auto">
      <Link href="/dashboard/requests" className="body-sm" style={{ color: "var(--text-muted)", textDecoration: "none" }}>
        ← All requests
      </Link>

      <div className="flex items-center gap-4 mt-3 mb-8">
        <h1 className="heading-lg">{r.pr_number}</h1>
        <span className={`pill ${STATUS_META[r.status].pill}`}>{STATUS_META[r.status].label}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-6">
        <div className="card p-6">
          <h2 className="heading-sm mb-4">Request details</h2>
          <div className="flex flex-col gap-2.5">
            {facts.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <span className="body-sm" style={{ color: "var(--text-muted)" }}>{k}</span>
                <span className="body-sm text-right capitalize" style={{ color: "var(--text-dark)", fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
          {r.justification && (
            <p className="body-sm mt-4 p-3 rounded-lg" style={{ background: "var(--paper)", fontStyle: "italic" }}>
              &ldquo;{r.justification}&rdquo;
            </p>
          )}
          {r.approver_note && (
            <p className="body-sm mt-3 p-3 rounded-lg" style={{ background: "rgba(245,166,35,0.08)" }}>
              Approver note: &ldquo;{r.approver_note}&rdquo;
            </p>
          )}
          {r.sap_error && (
            <p className="body-sm mt-3 p-3 rounded-lg" style={{ background: "rgba(239,68,68,0.07)", color: "#DC2626" }}>
              SAP error: {r.sap_error}
            </p>
          )}
        </div>

        <div className="card p-6">
          <h2 className="heading-sm mb-4">Items</h2>
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th className="text-left py-2 label">Item</th>
                <th className="text-left py-2 label">Code</th>
                <th className="text-right py-2 label">Qty</th>
              </tr>
            </thead>
            <tbody>
              {(r.pr_items ?? []).map((it) => (
                <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="py-2.5" style={{ color: "var(--text-dark)", fontWeight: 500 }}>
                    {it.item_name}
                    {it.notes && <span className="block body-sm" style={{ fontSize: 12 }}>{it.notes}</span>}
                  </td>
                  <td className="py-2.5" style={{ color: "var(--text-mid)", fontFamily: "monospace", fontSize: 13 }}>{it.material_code ?? "—"}</td>
                  <td className="py-2.5 text-right" style={{ color: "var(--text-mid)" }}>{it.quantity} {unitLabel(it.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(attachments ?? []).length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="heading-sm mb-4">Spec sheets &amp; drawings</h2>
          <p className="body-sm mb-3" style={{ fontSize: 12 }}>Sent automatically with every RFQ email for this request.</p>
          <div className="flex flex-col gap-1.5">
            {(attachments ?? []).map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between py-2.5 px-4 rounded-lg gap-3"
                style={{ background: "var(--paper)" }}
              >
                <a href={`/api/attachments?id=${a.id}`} target="_blank" style={{ textDecoration: "none", flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: "var(--navy)", fontSize: 14 }}>{a.file_name}</span>
                </a>
                <span className="body-sm" style={{ flexShrink: 0 }}>{(a.size_bytes / 1024 / 1024).toFixed(2)} MB</span>
                <CopyVendorLink attachmentId={a.id} />
                <a href={`/api/attachments?id=${a.id}`} target="_blank" className="body-sm" style={{ flexShrink: 0, color: "var(--navy)" }}>View →</a>
              </div>
            ))}
          </div>
        </div>
      )}

      {rfqList.length > 0 && (
        <div className="card p-6">
          <h2 className="heading-sm mb-4">RFQs for this request</h2>
          {rfqList.map((q) => (
            <Link
              key={q.id}
              href={`/dashboard/rfqs/${q.id}`}
              className="flex items-center justify-between py-3 px-4 rounded-lg mb-1"
              style={{ background: "var(--paper)", textDecoration: "none" }}
            >
              <span style={{ fontWeight: 600, color: "var(--navy)", fontSize: 14 }}>{q.rfq_number}</span>
              <span className="body-sm">Compare quotes →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
