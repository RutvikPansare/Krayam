import { createAdminClient } from "@/lib/supabase/admin";
import type { TeamRole } from "@/types/roles";

export interface TeamContext {
  memberId: string | null;
  orgId: string | null;
  role: TeamRole;
  fullName: string | null;
}

function slugify(base: string): string {
  const s = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "org";
}

/** Create a fresh organization + a seeded company_settings row, return its id. */
async function createOrgForUser(admin: ReturnType<typeof createAdminClient>, email: string): Promise<string> {
  const domain = email.split("@")[1]?.split(".")[0] ?? "company";
  const name = domain.charAt(0).toUpperCase() + domain.slice(1);
  // Slug must be unique; suffix on collision.
  let slug = slugify(domain);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name, slug })
      .select("id")
      .single();
    if (org) {
      await admin.from("company_settings").insert({ org_id: org.id, company_name: name }).then(() => {}, () => {});
      return org.id;
    }
    if ((error as any)?.code === "23505") { slug = `${slugify(domain)}-${Math.random().toString(36).slice(2, 6)}`; continue; }
    throw new Error(error?.message ?? "Could not create organization");
  }
  throw new Error("Could not allocate an organization slug");
}

/**
 * Resolve the caller's org + team role.
 *
 * SaaS bootstrap: a brand-new authenticated user (no membership, not invited)
 * gets a NEW organization created for them and becomes its owner. Users invited
 * by email join the inviter's org (their team_members row already carries
 * org_id; we just claim it on first login).
 */
export async function getTeamContext(userId: string, email?: string | null): Promise<TeamContext> {
  const admin = createAdminClient();

  const { data: me } = await admin
    .from("team_members")
    .select("id, org_id, role, full_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (me) return { memberId: me.id, orgId: me.org_id, role: me.role as TeamRole, fullName: me.full_name };

  // Invited by email before first login — claim the row (keeps its org_id).
  if (email) {
    const { data: byEmail } = await admin
      .from("team_members")
      .select("id, org_id, role, full_name")
      .is("user_id", null)
      .eq("email", email.toLowerCase())
      .maybeSingle();
    if (byEmail) {
      await admin.from("team_members").update({ user_id: userId }).eq("id", byEmail.id);
      return { memberId: byEmail.id, orgId: byEmail.org_id, role: byEmail.role as TeamRole, fullName: byEmail.full_name };
    }
  }

  // Brand-new user → spin up their own org and make them the owner.
  if (email) {
    const orgId = await createOrgForUser(admin, email);
    const { data: created } = await admin
      .from("team_members")
      .insert({ user_id: userId, org_id: orgId, email: email.toLowerCase(), role: "owner" })
      .select("id, org_id, role, full_name")
      .single();
    if (created) return { memberId: created.id, orgId: created.org_id, role: "owner", fullName: created.full_name };
  }

  return { memberId: null, orgId: null, role: "engineer", fullName: null };
}
