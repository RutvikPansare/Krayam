"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard, ClipboardList, Send, Users, LogOut, ChevronRight, Smartphone,
  FileText, ScanSearch, ReceiptText, TrendingUp, Sparkles, UserCog, Building2, CircleUser,
} from "lucide-react";

const NAV_ITEMS = [
  { label: "Overview",  href: "/dashboard",          icon: LayoutDashboard, exact: true },
  { label: "Requests",  href: "/dashboard/requests", icon: ClipboardList,   exact: false },
  { label: "RFQs & Quotes", href: "/dashboard/rfqs", icon: Send,            exact: false },
  { label: "Purchase orders", href: "/dashboard/pos", icon: FileText,       exact: false },
  { label: "Invoices",  href: "/dashboard/invoices", icon: ReceiptText,     exact: false },
  { label: "Spend",     href: "/dashboard/spend",    icon: TrendingUp,      exact: false },
  { label: "Vendors",   href: "/dashboard/vendors",  icon: Users,           exact: false },
  { label: "Dedup audit", href: "/dashboard/audit",  icon: ScanSearch,      exact: false },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    localStorage.removeItem("_kui");
    router.push("/login");
    router.refresh();
  }

  const linkStyle = (active: boolean) => ({
    color:          active ? "var(--navy)" : "var(--text-mid)",
    background:     active ? "rgba(11,34,57,0.08)" : "transparent",
    border:         active ? "1px solid rgba(11,34,57,0.14)" : "1px solid transparent",
    textDecoration: "none",
  });

  return (
    <aside
      className="flex flex-col h-full w-[220px] flex-shrink-0 overflow-hidden"
      style={{
        background:  "var(--paper-2)",
        borderRight: "1px solid var(--border)",
        fontFamily:  "var(--font-dm-sans,'DM Sans',sans-serif)",
      }}
    >
      {/* Brand header */}
      <div
        className="px-4 py-4 flex items-center gap-2.5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--navy)" }}
        >
          <span className="font-logo" style={{ fontSize: 15, color: "var(--amber)" }}>K</span>
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dark)", lineHeight: 1.2 }}>
            Krayam
          </span>
          <span style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.06em", lineHeight: 1.2, marginTop: 1 }}>
            PROCUREMENT INTELLIGENCE
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        <p className="label px-3 mb-2">Menu</p>

        {NAV_ITEMS.map(({ label, href, icon: Icon, exact }) => {
          const isActive = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all"
              style={linkStyle(isActive)}
              onMouseOver={(e) => { if (!isActive) { e.currentTarget.style.background = "var(--paper-3)"; e.currentTarget.style.color = "var(--text-dark)"; } }}
              onMouseOut={(e)  => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-mid)"; } }}
            >
              <Icon size={15} />
              <span className="flex-1">{label}</span>
              {isActive && <ChevronRight size={12} style={{ color: "var(--navy)", opacity: 0.5 }} />}
            </Link>
          );
        })}

        <p className="label px-3 mb-2 mt-6">Shop floor</p>
        <a
          href="/pr/new"
          target="_blank"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all"
          style={linkStyle(false)}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--paper-3)"; e.currentTarget.style.color = "var(--text-dark)"; }}
          onMouseOut={(e)  => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-mid)"; }}
        >
          <Smartphone size={15} />
          <span className="flex-1">Mobile PR form</span>
          <span className="pill pill-amber" style={{ fontSize: 9, padding: "1px 7px" }}>PWA</span>
        </a>
        <a
          href="/pr/assistant"
          target="_blank"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all"
          style={linkStyle(false)}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--paper-3)"; e.currentTarget.style.color = "var(--text-dark)"; }}
          onMouseOut={(e)  => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-mid)"; }}
        >
          <Sparkles size={15} />
          <span className="flex-1">AI assistant</span>
          <span className="pill pill-amber" style={{ fontSize: 9, padding: "1px 7px" }}>NEW</span>
        </a>

        <p className="label px-3 mb-2 mt-6">Settings</p>
        {[
          { label: "My Profile",   href: "/dashboard/settings/profile",      icon: CircleUser },
          { label: "Team",         href: "/dashboard/settings/team",         icon: UserCog },
          { label: "Organization", href: "/dashboard/settings/organization", icon: Building2 },
        ].map(({ label, href, icon: Icon }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all"
              style={linkStyle(isActive)}
              onMouseOver={(e) => { if (!isActive) { e.currentTarget.style.background = "var(--paper-3)"; e.currentTarget.style.color = "var(--text-dark)"; } }}
              onMouseOut={(e)  => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-mid)"; } }}
            >
              <Icon size={15} />
              <span className="flex-1">{label}</span>
              {isActive && <ChevronRight size={12} style={{ color: "var(--navy)", opacity: 0.5 }} />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom — Sign out */}
      <div
        className="px-3 pb-4 flex-shrink-0"
        style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}
      >
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all w-full text-left"
          style={{ color: "var(--text-muted)", background: "transparent", border: "none", cursor: "pointer" }}
          onMouseOver={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.07)"; e.currentTarget.style.color = "#DC2626"; }}
          onMouseOut={(e)  => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
