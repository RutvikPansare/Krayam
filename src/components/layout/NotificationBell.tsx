"use client";

import { Bell, CheckCheck, ClipboardList, FileText, ReceiptText, Send, PackageCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  pr_created: ClipboardList,
  pr_approved: ClipboardList,
  pr_rejected: ClipboardList,
  quote_received: Send,
  po_created: FileText,
  invoice_flagged: ReceiptText,
  grn_posted: PackageCheck,
};

export function NotificationBell() {
  const supabase = createClient();
  const ref = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      channel = supabase
        .channel("notifications-bell")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => load()
        )
        .subscribe();
    });
    const poll = setInterval(load, 60000);
    return () => {
      if (channel) supabase.removeChannel(channel);
      clearInterval(poll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
  }

  async function markOne(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        style={{
          position: "relative",
          width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 10, cursor: "pointer",
          background: open ? "var(--paper-2)" : "transparent",
          border: `1px solid ${open ? "var(--border)" : "transparent"}`,
          color: "var(--text-mid)", transition: "all 0.15s",
        }}
        onMouseOver={(e) => { if (!open) { e.currentTarget.style.background = "var(--paper-2)"; e.currentTarget.style.borderColor = "var(--border)"; } }}
        onMouseOut={(e)  => { if (!open) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; } }}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span style={{
            position: "absolute", top: 3, right: 3,
            minWidth: 15, height: 15, padding: "0 4px", borderRadius: 99,
            background: "#DC2626", color: "white",
            fontSize: 9, fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1.5px solid var(--paper)",
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 300,
          background: "white", border: "1.5px solid var(--border)", borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)", width: 340, overflow: "hidden",
        }}>
          <div style={{
            padding: "12px 16px", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text-dark)" }}>
              Notifications{unread > 0 && <span style={{ color: "#DC2626" }}> · {unread} new</span>}
            </p>
            {unread > 0 && (
              <button onClick={markAll} style={{
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 11, fontWeight: 600, color: "var(--navy)",
                background: "none", border: "none", cursor: "pointer", padding: 0,
              }}>
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>

          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {loading ? (
              <p style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
            ) : items.length === 0 ? (
              <div style={{ padding: "32px 24px", textAlign: "center" }}>
                <Bell size={22} style={{ color: "var(--text-muted)", margin: "0 auto 8px" }} />
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                  Nothing yet. You&apos;ll be notified here based on your role — new requests, quotes, purchase orders.
                </p>
              </div>
            ) : (
              items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const inner = (
                  <div
                    onClick={() => { if (!n.read) markOne(n.id); if (n.link) setOpen(false); }}
                    style={{
                      display: "flex", gap: 11, padding: "12px 16px", cursor: "pointer",
                      background: n.read ? "white" : "rgba(245,166,35,0.06)",
                      borderBottom: "1px solid var(--border)",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "var(--paper)")}
                    onMouseOut={(e)  => (e.currentTarget.style.background = n.read ? "white" : "rgba(245,166,35,0.06)")}
                  >
                    <div style={{
                      width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                      background: "rgba(11,34,57,0.06)", border: "1px solid rgba(11,34,57,0.1)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon size={13} style={{ color: "var(--navy)" }} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 12.5, fontWeight: n.read ? 500 : 700, color: "var(--text-dark)", lineHeight: 1.35 }}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--text-mid)", lineHeight: 1.4 }}>{n.body}</p>
                      )}
                      <p style={{ margin: "3px 0 0", fontSize: 10.5, color: "var(--text-muted)" }}>
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    {!n.read && (
                      <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--amber)", flexShrink: 0, marginTop: 5 }} />
                    )}
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link} style={{ textDecoration: "none", display: "block" }}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
