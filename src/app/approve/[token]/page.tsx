"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle } from "lucide-react";
import { unitLabel } from "@/lib/units";

interface PRView {
  pr_number: string;
  requester_name: string;
  department: string | null;
  priority: string;
  justification: string | null;
  status: string;
  needed_by: string | null;
  pr_items: { id: string; item_name: string; quantity: number; unit: string; notes: string | null }[];
}

export default function ApprovePage({ params, searchParams }: { params: { token: string }; searchParams: { action?: string } }) {
  const [pr, setPr] = useState<PRView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);
  const [result, setResult] = useState<{ status: string; sap_pr_number?: string | null } | null>(null);

  useEffect(() => {
    fetch(`/api/approvals/${params.token}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Invalid or expired link");
        setPr(body.pr);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.token]);

  async function act(action: "approve" | "reject") {
    setActing(action);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Action failed");
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActing(null);
    }
  }

  const shellStyle = { background: "var(--navy)" };

  if (loading) {
    return <div className="min-h-dvh flex items-center justify-center" style={shellStyle}><p className="body-md" style={{ color: "rgba(255,255,255,0.6)" }}>Loading request…</p></div>;
  }

  if (error && !pr) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6" style={shellStyle}>
        <div className="card p-10 text-center" style={{ maxWidth: 420 }}>
          <XCircle size={44} className="mx-auto mb-4" style={{ color: "#DC2626" }} />
          <h1 className="heading-md mb-2">Link not valid</h1>
          <p className="body-md">{error}</p>
        </div>
      </div>
    );
  }

  if (result || (pr && pr.status !== "pending_approval")) {
    const approved = result ? result.status !== "rejected" : pr!.status !== "rejected";
    const sapNo = result?.sap_pr_number;
    return (
      <div className="min-h-dvh flex items-center justify-center px-6" style={shellStyle}>
        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="card p-10 text-center" style={{ maxWidth: 440 }}>
          {approved
            ? <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: "#15803D" }} />
            : <XCircle size={48} className="mx-auto mb-4" style={{ color: "#DC2626" }} />}
          <h1 className="heading-md mb-2">{approved ? "Approved" : "Rejected"}</h1>
          <p className="body-md mb-2">
            {pr?.pr_number} has been {approved ? "approved" : "rejected"}.
            {result == null && " (This link was already used.)"}
          </p>
          {approved && sapNo && (
            <p className="body-sm p-3 rounded-lg mt-3" style={{ background: "var(--paper)" }}>
              SAP Purchase Requisition <b>{sapNo}</b> created · RFQs emailed to vendors automatically.
            </p>
          )}
          <p className="label mt-6">The requester has been notified · Krayam</p>
        </motion.div>
      </div>
    );
  }

  const preselect = searchParams.action;

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-10" style={shellStyle}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card w-full p-7 md:p-9" style={{ maxWidth: 520 }}>
        <p className="label mb-2" style={{ color: "#B97A0A" }}>Approval required</p>
        <h1 className="heading-md mb-1">{pr!.pr_number}</h1>
        <p className="body-sm mb-5">
          Raised by <b style={{ color: "var(--text-dark)" }}>{pr!.requester_name}</b>
          {pr!.department && ` · ${pr!.department}`} · priority{" "}
          <b className="capitalize" style={{ color: pr!.priority === "urgent" ? "#DC2626" : "var(--text-dark)" }}>{pr!.priority}</b>
        </p>

        {pr!.justification && (
          <p className="body-sm p-3 rounded-lg mb-5" style={{ background: "var(--paper)", fontStyle: "italic" }}>
            &ldquo;{pr!.justification}&rdquo;
          </p>
        )}

        <table className="w-full mb-6" style={{ fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th className="text-left py-2 label">Item</th>
              <th className="text-right py-2 label">Qty</th>
            </tr>
          </thead>
          <tbody>
            {pr!.pr_items.map((it) => (
              <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="py-2.5" style={{ color: "var(--text-dark)", fontWeight: 500 }}>
                  {it.item_name}
                  {it.notes && <span className="block body-sm" style={{ fontSize: 12 }}>{it.notes}</span>}
                </td>
                <td className="py-2.5 text-right" style={{ color: "var(--text-mid)" }}>{it.quantity} {unitLabel(it.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <label className="label block mb-1.5">Note (optional)</label>
        <textarea className="app-textarea mb-5" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any comment for the requester…" />

        {error && <p className="body-sm mb-4" style={{ color: "#DC2626" }}>{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => act("reject")}
            disabled={acting != null}
            className="btn w-full"
            style={{ border: "1.5px solid #DC2626", color: "#DC2626", background: preselect === "reject" ? "rgba(239,68,68,0.06)" : "white" }}
          >
            {acting === "reject" ? "Rejecting…" : "✕ Reject"}
          </button>
          <button
            onClick={() => act("approve")}
            disabled={acting != null}
            className="btn w-full"
            style={{ background: "#15803D", color: "white", border: "none" }}
          >
            {acting === "approve" ? "Approving…" : "✓ Approve"}
          </button>
        </div>
        <p className="label text-center mt-5">On approval: SAP PR created + RFQs emailed to vendors automatically</p>
      </motion.div>
    </div>
  );
}
