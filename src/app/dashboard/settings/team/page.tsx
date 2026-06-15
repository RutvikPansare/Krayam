"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users, Plus, X, Loader2, Copy, Check,
  Crown, Shield, PieChart, ShoppingCart, Wrench, Trash2, ChevronDown,
  History, UserPlus, UserMinus, ArrowRight, Building2, Pencil,
} from "lucide-react";
import { ROLE_LABELS, type TeamMember, type TeamRole } from "@/types/roles";

/* ─── Role meta (visual) ─────────────────────────────────── */

const ROLE_STYLE: Record<TeamRole, { color: string; bg: string; border: string; icon: React.ElementType }> = {
  owner:            { icon: Crown,        color: "#B45309", bg: "rgba(251,191,36,0.1)",  border: "rgba(251,191,36,0.3)" },
  admin:            { icon: Shield,       color: "#6366F1", bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.2)" },
  cfo:              { icon: PieChart,     color: "#15803D", bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.25)" },
  purchase_officer: { icon: ShoppingCart, color: "#2A6286", bg: "rgba(61,126,166,0.1)",  border: "rgba(61,126,166,0.25)" },
  engineer:         { icon: Wrench,       color: "var(--text-mid)", bg: "rgba(20,24,29,0.05)", border: "var(--border)" },
};

const ASSIGNABLE: TeamRole[] = ["admin", "cfo", "purchase_officer", "engineer"];

function RoleBadge({ role }: { role: TeamRole }) {
  const s = ROLE_STYLE[role];
  const Icon = s.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: "nowrap",
    }}>
      <Icon size={10} />{ROLE_LABELS[role].label}
    </span>
  );
}

function Avatar({ name, size = 36 }: { name: string | null; size?: number }) {
  const initials = (name ?? "?").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 3,
      background: "rgba(11,34,57,0.08)", border: "1px solid rgba(11,34,57,0.12)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 800, color: "var(--navy)", flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

/* ─── Role selector dropdown ─────────────────────────────── */

function RoleSelector({ value, onChange, disabled }: {
  value: TeamRole; onChange: (r: TeamRole) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const s = ROLE_STYLE[value];
  const Icon = s.icon;

  if (value === "owner" || disabled) return <RoleBadge role={value} />;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 8px 3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
          background: s.bg, color: s.color, border: `1px solid ${s.border}`,
          cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        <Icon size={10} />{ROLE_LABELS[value].label}<ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 20,
            background: "white", border: "1.5px solid var(--border)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.1)", overflow: "hidden", minWidth: 230,
          }}>
            {ASSIGNABLE.map((r) => {
              const rs = ROLE_STYLE[r];
              const RI = rs.icon;
              return (
                <button key={r} onClick={() => { onChange(r); setOpen(false); }}
                  style={{
                    width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start",
                    padding: "10px 14px", background: r === value ? "var(--paper)" : "white",
                    border: "none", cursor: "pointer", textAlign: "left",
                    borderBottom: "1px solid var(--border)",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--paper)")}
                  onMouseOut={(e)  => (e.currentTarget.style.background = r === value ? "var(--paper)" : "white")}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: rs.color }}>
                    <RI size={11} />{ROLE_LABELS[r].label}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{ROLE_LABELS[r].desc}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Invite modal ───────────────────────────────────────── */

interface CreatedCreds { email: string; password: string; name: string }

function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: (m: TeamMember) => void }) {
  const [form, setForm] = useState({ full_name: "", email: "", role: "engineer" as TeamRole, password: "" });
  const [autoPass, setAutoPass] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCreds | null>(null);
  const [copied, setCopied] = useState(false);

  const generatedPassword = useCallback(() => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$";
    return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }, []);
  const [genPass] = useState(generatedPassword);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const password = autoPass ? genPass : form.password;
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to invite member");
      setCreated({ email: form.email, password, name: form.full_name });
      onInvited(data.member as TeamMember);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function copyCredentials() {
    if (!created) return;
    navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(11,34,57,0.07)", border: "1px solid rgba(11,34,57,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Users size={14} style={{ color: "var(--navy)" }} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-dark)" }}>Add team member</p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>Create a login for a colleague</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6, borderRadius: 8, color: "var(--text-muted)", display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {created ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(21,128,61,0.06)", border: "1px solid rgba(21,128,61,0.2)" }}>
                <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 700, color: "#15803D" }}>✓ Account created for {created.name}</p>
                <p style={{ margin: 0, fontSize: 12, color: "#166534" }}>Share these credentials securely — the password won&apos;t be shown again.</p>
              </div>
              <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--paper)", border: "1.5px solid var(--border)", fontFamily: "monospace", fontSize: 13, lineHeight: 1.8 }}>
                <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Login credentials</div>
                <div><span style={{ color: "var(--text-muted)" }}>Email: </span><span style={{ color: "var(--text-dark)", fontWeight: 600 }}>{created.email}</span></div>
                <div><span style={{ color: "var(--text-muted)" }}>Password: </span><span style={{ color: "var(--text-dark)", fontWeight: 600 }}>{created.password}</span></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={copyCredentials} className="btn btn-outline" style={{ flex: 1, padding: "10px" }}>
                  {copied ? <><Check size={13} style={{ color: "#15803D" }} /> Copied!</> : <><Copy size={13} /> Copy credentials</>}
                </button>
                <button onClick={onClose} className="btn btn-dark" style={{ flex: 1, padding: "10px" }}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="label block mb-1.5">Full name</label>
                <input className="app-input" placeholder="Priya Sharma" required
                  value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
              </div>

              <div>
                <label className="label block mb-1.5">Email</label>
                <input className="app-input" type="email" placeholder="priya@company.com" required
                  value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>

              <div>
                <label className="label block mb-1.5">Role</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {ASSIGNABLE.map((r) => {
                    const rs = ROLE_STYLE[r];
                    const RI = rs.icon;
                    const sel = form.role === r;
                    return (
                      <button key={r} type="button" onClick={() => setForm((f) => ({ ...f, role: r }))} style={{
                        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3,
                        padding: "12px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                        border: `1.5px solid ${sel ? "var(--navy)" : "var(--border)"}`,
                        background: sel ? "rgba(11,34,57,0.04)" : "white",
                      }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: sel ? "var(--navy)" : "var(--text-dark)" }}>
                          <RI size={11} />{ROLE_LABELS[r].label}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{ROLE_LABELS[r].desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label className="label">Password</label>
                  <button type="button" onClick={() => setAutoPass((a) => !a)} style={{ fontSize: 11, fontWeight: 600, color: "var(--navy)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    {autoPass ? "Set custom password" : "Auto-generate"}
                  </button>
                </div>
                {autoPass ? (
                  <div className="app-input" style={{ background: "var(--paper)", color: "var(--text-muted)", fontFamily: "monospace" }}>
                    {genPass}
                  </div>
                ) : (
                  <input className="app-input" type="password" placeholder="Min 8 characters" required minLength={8}
                    value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
                )}
              </div>

              {error && (
                <p style={{ margin: 0, fontSize: 12, color: "#DC2626", background: "rgba(239,68,68,0.06)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)" }}>
                  {error}
                </p>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button type="button" onClick={onClose} className="btn btn-outline" style={{ flex: 1, padding: "10px" }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-dark" style={{ flex: 2, padding: "10px", opacity: saving ? 0.6 : 1 }}>
                  {saving ? <><Loader2 size={13} className="animate-spin" /> Creating…</> : <><Plus size={13} /> Create account</>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Remove confirm ─────────────────────────────────────── */

function RemoveConfirm({ member, onCancel, onConfirm }: { member: TeamMember; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 380, padding: 28 }}>
        <p style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--text-dark)" }}>Remove {member.full_name ?? member.email}?</p>
        <p style={{ margin: "0 0 22px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Their account will be permanently deleted. They won&apos;t be able to log in anymore.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} className="btn btn-outline" style={{ flex: 1, padding: "10px" }}>Cancel</button>
          <button onClick={onConfirm} className="btn" style={{ flex: 1, padding: "10px", background: "#DC2626", color: "white", border: "none" }}>Remove</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Activity log (governance audit trail) ──────────────── */

interface AuditEntry {
  id: string;
  entity_type: string;
  action: string;
  actor: string | null;
  detail: Record<string, any> | null;
  created_at: string;
}

const ACTIVITY_META: Record<string, { icon: React.ElementType; color: string }> = {
  role_changed:         { icon: ArrowRight, color: "#6366F1" },
  member_invited:       { icon: UserPlus,   color: "#15803D" },
  member_removed:       { icon: UserMinus,  color: "#DC2626" },
  profile_updated:      { icon: Pencil,     color: "var(--text-mid)" },
  organization_updated: { icon: Building2,  color: "#2A6286" },
};

function activitySentence(e: AuditEntry): React.ReactNode {
  const d = e.detail ?? {};
  const who = <b style={{ color: "var(--text-dark)" }}>{e.actor ?? "system"}</b>;
  const target = <b style={{ color: "var(--text-dark)" }}>{d.target_name ?? d.target_email ?? "a member"}</b>;
  switch (e.action) {
    case "role_changed":
      return <>{who} changed {target}&apos;s role from <b>{d.from_label ?? d.from}</b> to <b>{d.to_label ?? d.to}</b></>;
    case "member_invited":
      return <>{who} added {target} as <b>{d.role_label ?? d.role}</b></>;
    case "member_removed":
      return <>{who} removed {target} ({d.role_label ?? d.role})</>;
    case "profile_updated":
      return <>{who} updated their profile ({Object.keys(d.changes ?? {}).join(", ") || "details"})</>;
    case "organization_updated":
      return <>{who} updated the organization profile ({Object.keys(d.changes ?? {}).join(", ") || "details"})</>;
    default:
      return <>{who} — {e.action}</>;
  }
}

function ActivityLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/team/activity")
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card overflow-hidden mt-6">
      <div className="flex items-center gap-2 px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <History size={14} style={{ color: "var(--text-muted)" }} />
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-dark)" }}>Activity log</p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          Role changes, invites and removals — kept for compliance
        </p>
      </div>
      {loading ? (
        <div style={{ padding: 28, display: "flex", justifyContent: "center" }}>
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : entries.length === 0 ? (
        <p style={{ padding: "24px 20px", margin: 0, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
          No team changes recorded yet.
        </p>
      ) : (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {entries.map((e, i) => {
            const meta = ACTIVITY_META[e.action] ?? { icon: History, color: "var(--text-muted)" };
            const Icon = meta.icon;
            return (
              <div key={e.id} style={{
                display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 20px",
                borderBottom: i < entries.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0, marginTop: 1,
                  background: "var(--paper)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon size={12} style={{ color: meta.color }} />
                </div>
                <p style={{ margin: 0, flex: 1, fontSize: 12.5, color: "var(--text-mid)", lineHeight: 1.5 }}>
                  {activitySentence(e)}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
                  {new Date(e.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────── */

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [myRole, setMyRole] = useState<TeamRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const canManage = myRole === "owner" || myRole === "admin";

  async function fetchMembers() {
    setLoading(true);
    try {
      const res = await fetch("/api/team");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load team");
      setMembers(data.members ?? []);
      setMyRole(data.me?.role ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchMembers(); }, []);

  async function handleRoleChange(memberId: string, newRole: TeamRole) {
    setUpdating(memberId);
    try {
      const res = await fetch(`/api/team/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUpdating(null);
    }
  }

  async function handleRemove(member: TeamMember) {
    setRemoving(null);
    try {
      const res = await fetch(`/api/team/${member.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="p-8 max-w-5xl w-full mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="heading-lg mb-1">Team</h1>
          <p className="body-sm">Who has access to Krayam, and what they can do. Notifications route by role.</p>
        </div>
        {canManage && (
          <button className="btn btn-dark" style={{ padding: "11px 20px" }} onClick={() => setInviting(true)}>
            <Plus size={14} /> Add member
          </button>
        )}
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {(Object.keys(ROLE_LABELS) as TeamRole[]).map((role) => {
          const s = ROLE_STYLE[role];
          const Icon = s.icon;
          const count = members.filter((m) => m.role === role).length;
          return (
            <div key={role} className="card p-4 flex items-start gap-3">
              <div style={{ width: 34, height: 34, borderRadius: 9, background: s.bg, border: `1px solid ${s.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon size={15} style={{ color: s.color }} />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text-dark)" }}>{ROLE_LABELS[role].label} · {count}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{ROLE_LABELS[role].desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Member list */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-dark)" }}>Members</p>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{members.length} {members.length === 1 ? "person" : "people"}</p>
        </div>

        {loading ? (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
            <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <p style={{ fontSize: 13, color: "#DC2626" }}>{error}</p>
            <button onClick={fetchMembers} style={{ marginTop: 10, fontSize: 12, color: "var(--navy)", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Retry</button>
          </div>
        ) : members.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "var(--text-muted)" }}>No members yet</p>
          </div>
        ) : (
          <div>
            {members.map((member, i) => (
              <div key={member.id} style={{
                display: "flex", alignItems: "center", gap: 14, padding: "14px 20px",
                borderBottom: i < members.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <Avatar name={member.full_name} size={38} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-dark)" }}>
                    {member.full_name ?? "—"}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{member.email}</p>
                </div>

                <p style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
                  {new Date(member.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>

                <div style={{ flexShrink: 0 }}>
                  <RoleSelector
                    value={member.role}
                    disabled={!canManage || updating === member.id}
                    onChange={(r) => handleRoleChange(member.id, r)}
                  />
                </div>

                {canManage && (
                  <button
                    onClick={() => setRemoving(member)}
                    disabled={member.role === "owner"}
                    title={member.role === "owner" ? "Cannot remove the Managing Director" : "Remove member"}
                    style={{
                      padding: 8, borderRadius: 8, background: "transparent", border: "none",
                      cursor: member.role === "owner" ? "not-allowed" : "pointer",
                      color: member.role === "owner" ? "var(--border)" : "var(--text-muted)",
                      display: "flex", flexShrink: 0,
                    }}
                    onMouseOver={(e) => { if (member.role !== "owner") e.currentTarget.style.color = "#DC2626"; }}
                    onMouseOut={(e)  => { if (member.role !== "owner") e.currentTarget.style.color = "var(--text-muted)"; }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Governance trail — only MD / IT admin can see who changed what */}
      {canManage && <ActivityLog />}

      {inviting && (
        <InviteModal
          onClose={() => setInviting(false)}
          onInvited={(member) => setMembers((prev) => [...prev, member])}
        />
      )}

      {removing && (
        <RemoveConfirm
          member={removing}
          onCancel={() => setRemoving(null)}
          onConfirm={() => handleRemove(removing)}
        />
      )}
    </div>
  );
}
