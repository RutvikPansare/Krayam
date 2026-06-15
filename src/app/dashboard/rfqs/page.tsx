import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

interface RFQRow {
  id: string;
  rfq_number: string;
  due_date: string | null;
  status: string;
  created_at: string;
  purchase_requests: { pr_number: string; requester_name: string } | null;
  rfq_vendors: { id: string }[];
  quotes: { id: string }[];
}

const RFQ_PILL: Record<string, string> = {
  draft: "pill-gray", sent: "pill-blue", quotes_in: "pill-green", closed: "pill-navy",
};

export default async function RFQsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rfqs")
    .select("id, rfq_number, due_date, status, created_at, purchase_requests(pr_number, requester_name), rfq_vendors(id), quotes(id)")
    .order("created_at", { ascending: false });

  const rfqs = (data ?? []) as unknown as RFQRow[];

  return (
    <div className="p-8 max-w-6xl w-full mx-auto">
      <div className="mb-8">
        <h1 className="heading-lg mb-1">RFQs &amp; quotes</h1>
        <p className="body-sm">Auto-generated when a PR is approved. Click one to compare quotes side by side.</p>
      </div>

      <div className="card">
        {rfqs.length === 0 ? (
          <div className="px-6 py-16 text-center body-md">
            No RFQs yet. Approve a purchase request and Krayam will generate one automatically.
          </div>
        ) : (
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["RFQ #", "Purchase request", "Vendors invited", "Quotes in", "Due", "Status", ""].map((h, i) => (
                  <th key={i} className="text-left px-5 py-3 label">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rfqs.map((q) => (
                <tr key={q.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-5 py-3.5">
                    <Link href={`/dashboard/rfqs/${q.id}`} style={{ fontWeight: 600, color: "var(--navy)", textDecoration: "none" }}>
                      {q.rfq_number}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>
                    {q.purchase_requests?.pr_number} · {q.purchase_requests?.requester_name}
                  </td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>{q.rfq_vendors.length}</td>
                  <td className="px-5 py-3.5" style={{ color: q.quotes.length > 0 ? "#15803D" : "var(--text-mid)", fontWeight: q.quotes.length > 0 ? 600 : 400 }}>
                    {q.quotes.length}
                  </td>
                  <td className="px-5 py-3.5" style={{ color: "var(--text-mid)" }}>
                    {q.due_date ? format(new Date(q.due_date), "d MMM") : "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`pill ${RFQ_PILL[q.status] ?? "pill-gray"}`}>{q.status.replace("_", " ")}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <Link href={`/dashboard/rfqs/${q.id}`} className="body-sm" style={{ fontWeight: 600, color: "var(--navy)", textDecoration: "none" }}>
                      Compare →
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
