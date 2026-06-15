"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User, Briefcase, Loader2, Check, LogOut, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, type TeamRole } from "@/types/roles";

interface Profile {
  member_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  department: string | null;
  role: TeamRole;
  member_since: string;
}

const DEPARTMENTS = [
  "Management", "Finance & Accounts", "Purchase", "Stores",
  "Production", "Maintenance", "Quality", "IT", "Other",
];

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(11,34,57,0.07)", border: "1px solid rgba(11,34,57,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={13} style={{ color: "var(--navy)" }} />
        </div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text-dark)" }}>{title}</p>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

/**
 * My Profile — the signed-in member's own details (Tellero's profile page,
 * enterprise edition). The team role is read-only here: only the Managing
 * Director or IT Administrator can change roles, from Settings → Team, and
 * every role change is recorded in the audit log.
 */
export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ full_name: "", phone: "", department: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          setProfile(d.profile);
          setForm({
            full_name: d.profile.full_name ?? "",
            phone: d.profile.phone ?? "",
            department: d.profile.department ?? "",
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setProfile(data.profile);
      // keep the top-bar initials in sync
      if (data.profile?.full_name) {
        const ini = data.profile.full_name.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
        localStorage.setItem("_kui", ini);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem("_kui");
    router.push("/login");
    router.refresh();
  }

  const initials = form.full_name
    ? form.full_name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    : profile?.email?.[0]?.toUpperCase() ?? "?";

  const roleInfo = profile ? ROLE_LABELS[profile.role] : null;

  if (loading) {
    return (
      <div className="p-8 flex-1 flex items-center justify-center">
        <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl w-full mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(11,34,57,0.07)", border: "1px solid rgba(11,34,57,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <User size={17} style={{ color: "var(--navy)" }} />
          </div>
          <h1 className="heading-lg">My Profile</h1>
        </div>
        <button form="profile-form" type="submit" disabled={saving} className="btn btn-dark" style={{ padding: "10px 20px", opacity: saving ? 0.6 : 1 }}>
          {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> :
           saved ? <><Check size={13} /> Saved</> : "Save changes"}
        </button>
      </div>
      <p className="body-sm mb-8">Your personal account details. Your role is assigned by the Managing Director or IT Administrator.</p>

      <form id="profile-form" onSubmit={save}>
        <div className="grid md:grid-cols-2 gap-5">
          {/* Left column */}
          <div className="flex flex-col gap-5">
            {/* Avatar card */}
            <div className="card p-5 flex items-center gap-4">
              <div style={{
                width: 64, height: 64, borderRadius: 16, flexShrink: 0,
                background: "rgba(11,34,57,0.08)", border: "2px solid rgba(11,34,57,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, fontWeight: 800, color: "var(--navy)",
              }}>
                {initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-dark)" }}>
                  {form.full_name || "Your name"}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{profile?.email}</p>
                {roleInfo && (
                  <span style={{
                    display: "inline-block", marginTop: 6, padding: "2px 10px", borderRadius: 99,
                    fontSize: 11, fontWeight: 700,
                    background: "rgba(245,166,35,0.12)", color: "#B97A0A",
                    border: "1px solid rgba(245,166,35,0.3)",
                  }}>
                    {roleInfo.label}
                  </span>
                )}
              </div>
            </div>

            <Section title="Personal info" icon={User}>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="label block mb-1.5">Full name *</label>
                  <input
                    className="app-input" required
                    value={form.full_name}
                    onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                    placeholder="Your full name"
                  />
                </div>
                <div>
                  <label className="label block mb-1.5">Email</label>
                  <input className="app-input" value={profile?.email ?? ""} disabled style={{ background: "var(--paper)", color: "var(--text-muted)" }} />
                  <p className="body-sm mt-1" style={{ fontSize: 12 }}>Ask your IT Administrator to change your email.</p>
                </div>
                <div>
                  <label className="label block mb-1.5">Phone</label>
                  <input
                    className="app-input" type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+91 98765 43210"
                  />
                </div>
                <div>
                  <label className="label block mb-1.5">Department</label>
                  <select
                    className="app-input" style={{ cursor: "pointer" }}
                    value={form.department}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  >
                    <option value="">Select a department…</option>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
            </Section>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-5">
            <Section title="Role & permissions" icon={ShieldCheck}>
              {roleInfo ? (
                <div className="flex flex-col gap-2">
                  <span style={{
                    alignSelf: "flex-start", padding: "3px 12px", borderRadius: 99,
                    fontSize: 12, fontWeight: 700,
                    background: "rgba(245,166,35,0.12)", color: "#B97A0A",
                    border: "1px solid rgba(245,166,35,0.3)",
                  }}>
                    {roleInfo.label}
                  </span>
                  <p className="body-sm" style={{ margin: 0 }}>{roleInfo.desc}</p>
                  <p className="body-sm" style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
                    Roles are assigned by the Managing Director or IT Administrator in Settings → Team.
                    Every role change is recorded in the audit trail.
                  </p>
                </div>
              ) : (
                <p className="body-sm" style={{ margin: 0 }}>No team role assigned yet.</p>
              )}
            </Section>

            <Section title="Account" icon={Briefcase}>
              <div className="flex flex-col">
                {[
                  { label: "Member since", value: profile?.member_since ? new Date(profile.member_since).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—" },
                  { label: "Sign-in email", value: profile?.email ?? "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between" style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dark)", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="flex items-center justify-center gap-2 mt-4"
                  style={{
                    padding: "10px 16px", borderRadius: 9, cursor: "pointer",
                    border: "1.5px solid rgba(220,38,38,0.3)", background: "white",
                    fontSize: 13, fontWeight: 600, color: "#DC2626",
                    opacity: signingOut ? 0.6 : 1,
                  }}
                >
                  {signingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                  Sign out
                </button>
              </div>
            </Section>
          </div>
        </div>

        {error && (
          <p style={{ marginTop: 16, fontSize: 12, color: "#DC2626", background: "rgba(239,68,68,0.06)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)" }}>
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
