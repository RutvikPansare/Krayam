import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { STATUS_META, type PurchaseRequest } from "@/types";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  const supabase = await createClient();

  const [{ data: prs }, { count: vendorCount }, { count: rfqCount }, { count: quoteCount }] = await Promise.all([
    supabase.from("purchase_requests").select("*, pr_items(*)").order("created_at", { ascending: false }).limit(8),
    supabase.from("vendors").select("*", { count: "exact", head: true }),
    supabase.from("rfqs").select("*", { count: "exact", head: true }),
    supabase.from("quotes").select("*", { count: "exact", head: true }),
  ]);

  const requests = (prs ?? []) as PurchaseRequest[];
  const pending = requests.filter((r) => r.status === "pending_approval").length;

  const stats = [
    { label: "Open requests", value: requests.length, sub: `${pending} awaiting approval` },
    { label: "RFQs sent", value: rfqCount ?? 0, sub: "auto-generated on approval" },
    { label: "Quotes received", value: quoteCount ?? 0, sub: "portal + manual entry" },
    { label: "Active vendors", value: vendorCount ?? 0, sub: "in vendor master" },
  ];

  return (
    <div className="p-8 max-w-6xl w-full mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="heading-lg mb-1">Overview</h1>
          <p className="body-sm">Your procurement pipeline at a glance.</p>
        </div>
        <a href="/pr/new" target="_blank" className="btn btn-dark" style={{ textDecoration: "none", padding: "11px 20px" }}>
          + New request
        </a>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <p className="label mb-2">{s.label}</p>
            <p className="heading-lg" style={{ color: "var(--navy)" }}>{s.value}</p>
            <p className="body-sm mt-1" style={{ fontSize: 12 }}>{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="heading-sm">Recent requests</h2>
          <Link href="/dashboard/requests" className="body-sm" style={{ fontWeight: 600, color: "var(--navy)", textDecoration: "none" }}>
            View all →
          </Link>
        </div>
        {requests.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="body-md mb-2">No purchase requests yet.</p>
            <p className="body-sm">Share the <a href="/pr/new" style={{ color: "var(--navy)", fontWeight: 600 }}>mobile PR form</a> with your shop floor team to get started.</p>
          </div>
        ) : (
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["PR #", "Requester", "Items", "Priority", "Status", "Raised"].map((h) => (
                  <th key={h} className="text-left px-6 py-3 label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-6 py-3.5">
                    <Link href={`/dashboard/requests/${r.id}`} style={{ fontWeight: 600, color: "var(--navy)", textDecoration: "none" }}>
                      {r.pr_number}
                    </Link>
                  </td>
                  <td className="px-6 py-3.5" style={{ color: "var(--text-dark)" }}>{r.requester_name}</td>
                  <td className="px-6 py-3.5" style={{ color: "var(--text-mid)" }}>{r.pr_items?.length ?? 0}</td>
                  <td className="px-6 py-3.5 capitalize" style={{ color: r.priority === "urgent" ? "#DC2626" : "var(--text-mid)" }}>{r.priority}</td>
                  <td className="px-6 py-3.5"><span className={`pill ${STATUS_META[r.status].pill}`}>{STATUS_META[r.status].label}</span></td>
                  <td className="px-6 py-3.5" style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
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
