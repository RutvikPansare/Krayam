"use client";

import { useState } from "react";
import { Link2, Check, Loader2 } from "lucide-react";

/**
 * Feature 11 — re-issue a 7-day signed link for a vendor whose copy expired.
 * Fetches a fresh signed URL and copies it to the clipboard.
 */
export default function CopyVendorLink({ attachmentId }: { attachmentId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setState("loading");
    try {
      const res = await fetch(`/api/attachments?id=${attachmentId}&format=json`);
      const body = await res.json();
      if (!res.ok || !body.signed_url) throw new Error(body.error ?? "failed");
      await navigator.clipboard.writeText(body.signed_url);
      setState("done");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <button
      onClick={copy}
      title="Copy a fresh 7-day download link to send a vendor"
      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}
    >
      {state === "loading" ? <Loader2 size={13} className="animate-spin" />
        : state === "done" ? <><Check size={13} style={{ color: "#15803D" }} /> copied (7-day link)</>
        : state === "error" ? "retry"
        : <><Link2 size={13} /> copy vendor link</>}
    </button>
  );
}
