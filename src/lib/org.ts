import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Organization (tenant) resolution. "Customer" == organization.
 *
 * Two resolvers:
 *  - getOrgId(): the install/default org, used by public service-role routes
 *    (PR search, vendor quote links, cron) that have no user session. Resolved
 *    from KRAYAM_ORG_ID / KRAYAM_ORG_SLUG (default 'default').
 *  - getSessionOrgId(): the signed-in user's org, from their team_members row.
 *    Use this on authenticated dashboard pages so each page has org context.
 */

let cachedDefault: string | null = null;

export async function getOrgId(): Promise<string> {
  if (cachedDefault) return cachedDefault;

  const explicit = process.env.KRAYAM_ORG_ID;
  if (explicit) {
    cachedDefault = explicit;
    return explicit;
  }

  const slug = process.env.KRAYAM_ORG_SLUG || "default";
  const admin = createAdminClient();
  const { data } = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (!data) throw new Error(`No organization for slug "${slug}". Run migrations 0013 + 0015.`);
  cachedDefault = data.id;
  return data.id;
}

/** The authenticated caller's org, or null if not signed in / not a member. */
export async function getSessionOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("team_members").select("org_id").eq("user_id", user.id).maybeSingle();
  return data?.org_id ?? null;
}
