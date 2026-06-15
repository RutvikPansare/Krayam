// GET /api/unit-conversions — the conversion table (for the manual-entry
// converter preview). The preview reuses the same pure convertPrice() with
// these server-provided ratios; the authoritative conversion still runs
// server-side at storage. Ratios live in the DB, never hardcoded in the client.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("unit_conversions")
    .select("unit, dimension, to_base, ambiguous, label")
    .order("dimension");
  return NextResponse.json({ conversions: data ?? [] });
}
