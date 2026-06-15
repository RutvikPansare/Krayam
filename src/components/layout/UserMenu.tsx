"use client";

import { ChevronDown, User, Users, Building2, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, type TeamRole } from "@/types/roles";

export function UserMenu() {
  const router   = useRouter();
  const supabase = createClient();
  const ref      = useRef<HTMLDivElement>(null);

  const [open, setOpen]         = useState(false);
  const [initials, setInitials] = useState("");
  const [name, setName]         = useState<string | null>(null);
  const [email, setEmail]       = useState<string | null>(null);
  const [role, setRole]         = useState<TeamRole | null>(null);

  useEffect(() => {
    const cached = typeof window !== "undefined" ? localStorage.getItem("_kui") : null;
    if (cached) setInitials(cached);

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      const sessionEmail = session?.user?.email ?? null;
      if (sessionEmail) setEmail(sessionEmail);
      const metaName: string | null = session?.user?.user_metadata?.full_name ?? null;

      try {
        const res = await fetch("/api/profile");
        const data = await res.json();
        const resolved: string | null = data.profile?.full_name ?? metaName;
        if (data.profile?.role) setRole(data.profile.role);
        if (resolved) {
          const ini = resolved.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
          setName(resolved);
          setInitials(ini);
          localStorage.setItem("_kui", ini);
          return;
        }
      } catch { /* ignore */ }

      if (sessionEmail) {
        const ini = sessionEmail[0].toUpperCase();
        setInitials(ini);
        localStorage.setItem("_kui", ini);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    localStorage.removeItem("_kui");
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          background: open ? "var(--paper-2)" : "transparent",
          border: `1px solid ${open ? "var(--border)" : "transparent"}`,
          borderRadius: 10, padding: "3px 6px 3px 3px", cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseOver={(e) => { if (!open) { e.currentTarget.style.background = "var(--paper-2)"; e.currentTarget.style.borderColor = "var(--border)"; } }}
        onMouseOut={(e)  => { if (!open) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; } }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: "rgba(11,34,57,0.08)",
          border: "1px solid rgba(11,34,57,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 800, color: "var(--navy)", flexShrink: 0,
          letterSpacing: "0.02em",
        }}>
          {initials}
        </div>
        <ChevronDown size={12} style={{ color: "var(--text-muted)", transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 300,
          background: "white", border: "1.5px solid var(--border)", borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)", minWidth: 240, overflow: "hidden",
        }}>
          <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: "rgba(11,34,57,0.08)", border: "1px solid rgba(11,34,57,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 800, color: "var(--navy)",
              }}>
                {initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text-dark)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {name ?? "Your account"}
                </p>
                {email && (
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {email}
                  </p>
                )}
                {role && (
                  <span style={{
                    display: "inline-block", marginTop: 4, padding: "1px 8px", borderRadius: 99,
                    fontSize: 10, fontWeight: 700,
                    background: "rgba(245,166,35,0.12)", color: "#B97A0A",
                    border: "1px solid rgba(245,166,35,0.3)",
                  }}>
                    {ROLE_LABELS[role].label}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ padding: "6px" }}>
            {[
              { icon: User,      label: "My Profile",   href: "/dashboard/settings/profile" },
              { icon: Users,     label: "Team",         href: "/dashboard/settings/team" },
              { icon: Building2, label: "Organization", href: "/dashboard/settings/organization" },
            ].map(({ icon: Icon, label, href }) => (
              <Link key={href} href={href} onClick={() => setOpen(false)} style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "9px 12px", borderRadius: 8, textDecoration: "none",
                color: "var(--text-dark)", fontSize: 13, fontWeight: 500,
              }}
                onMouseOver={(e) => (e.currentTarget.style.background = "var(--paper)")}
                onMouseOut={(e)  => (e.currentTarget.style.background = "transparent")}
              >
                <Icon size={14} style={{ color: "var(--text-muted)" }} />
                {label}
              </Link>
            ))}
          </div>

          <div style={{ padding: "6px", borderTop: "1px solid var(--border)" }}>
            <button onClick={handleSignOut} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 9,
              padding: "9px 12px", borderRadius: 8, cursor: "pointer",
              background: "transparent", border: "none", textAlign: "left",
              color: "var(--text-muted)", fontSize: 13, fontWeight: 500,
            }}
              onMouseOver={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.07)"; e.currentTarget.style.color = "#DC2626"; }}
              onMouseOut={(e)  => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
