import { createAdminClient } from "@/lib/supabase/admin";
import { NOTIFY_ROUTING, type TeamRole } from "@/types/roles";

export interface NotifyPayload {
  /** The org whose members should be notified. Required — fan-out is
   *  strictly scoped to this org so one tenant never notifies another. */
  orgId: string;
  type: keyof typeof NOTIFY_ROUTING | string;
  title: string;
  body?: string;
  link?: string;
}

/**
 * Role-routed notification fan-out, scoped to a single org.
 * Looks up team members in payload.orgId whose role matches the event's
 * routing (NOTIFY_ROUTING, overridable per call) and writes one notification
 * row per user. The bell picks them up via Supabase Realtime.
 *
 * owner and admin oversee everything, so owner is always included
 * wherever admin is routed.
 *
 * Never throws — a failed notification must not break the business action.
 */
export async function notifyRoles(payload: NotifyPayload, rolesOverride?: TeamRole[]) {
  try {
    if (!payload.orgId) { console.error("notifyRoles called without orgId; skipping"); return; }
    const roles = new Set<TeamRole>(rolesOverride ?? NOTIFY_ROUTING[payload.type] ?? []);
    if (roles.size === 0) return;
    if (roles.has("admin")) roles.add("owner");

    const admin = createAdminClient();
    const { data: members } = await admin
      .from("team_members")
      .select("user_id, role")
      .eq("org_id", payload.orgId)            // tenant isolation: only this org's members
      .in("role", Array.from(roles))
      .not("user_id", "is", null);

    const rows = (members ?? []).map((m) => ({
      user_id: m.user_id,
      org_id: payload.orgId,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      link: payload.link ?? null,
    }));
    if (rows.length === 0) return;
    await admin.from("notifications").insert(rows);
  } catch (err) {
    console.error("notifyRoles failed:", err);
  }
}
