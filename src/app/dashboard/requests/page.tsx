import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { STATUS_META, type PurchaseRequest } from "@/types";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_requests")
    .select("*, pr_items(*)")
    .order("created_at", { ascending: false });

  const requests = (data ?? []) as PurchaseRequest[];

  return (
    <div className="p-8 max-w-6xl w-full mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="heading-lg mb-1">Purchase requests</h1>
          <p className="body-sm">Every request raised from the shop floor, with live status.</p>
        </div>
        <a href="/pr/new" target="_blank" className="btn btn-dark" style={{ textDecoration: "none", padding: "11px 20px" }}>
          + New request
        </a>
      </div>

      <div className="card">
        {requests.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="body-md">No requests yet. Open the <a href="/pr/new" style={{ color: "var(--navy)", fontWeight: 600 }}>mobile PR form</a> to raise the first one.</p>
          </div>
        ) : (
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["PR #", "Requester", "Dept", "Items", "Priority", "Status", "SAP PR", "Raised"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-5 py-3.5">
                    <Link href={`/dashboard/requests/${r.id}`} style={{ fontWeight: 600, color: "var(--navy)", textDecoration: "none" }}>
                      {r.pr_number}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-dark)" }}>{r.requester_name}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>{r.department ?? "—"}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>{r.pr_items?.length ?? 0}</td>
                  <td className="px-5 py-3.5 capitalize" style={{ color: r.priority === "urgent" ? "#DC2626" : "var(--text-mid)" }}>{r.priority}</td>
                  <td className="px-5 py-3.5"><span className={`pill ${STATUS_META[r.status].pill}`}>{STATUS_META[r.status].label}</span></td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)", fontFamily: "monospace", fontSize: 13 }}>{r.sap_pr_number ?? "—"}</td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    {format(new Date(r.created_at), "d MMM yyyy")}
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
