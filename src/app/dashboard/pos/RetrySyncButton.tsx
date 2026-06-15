"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";

/** Retry the SAP push for a PO stuck in 'sap_sync_failed'. */
export default function RetrySyncButton({ poId }: { poId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/pos/${poId}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.sap_error) throw new Error(data.sap_error ?? data.error ?? "Sync failed");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={retry}
        disabled={busy}
        className="inline-flex items-center gap-1.5 body-sm"
        style={{ fontWeight: 600, color: "#B45309", background: "none", border: "none", cursor: busy ? "default" : "pointer", padding: 0 }}
        title={err ?? "Retry pushing this PO to SAP"}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Retry SAP
      </button>
    </span>
  );
}
