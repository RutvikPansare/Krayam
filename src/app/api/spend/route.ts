import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionOrgId } from "@/lib/org";
import { computeSpend } from "@/lib/spend";

export const dynamic = "force-dynamic";

/** Phase 2 Feature 05 — spend aggregates for the CFO dashboard (org-scoped). */
export async function GET(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getSessionOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization context" }, { status: 400 });

  const months = Math.min(24, Math.max(1, Number(new URL(req.url).searchParams.get("months") ?? "6")));
  const data = await computeSpend(months, orgId);
  return NextResponse.json(data);
}
