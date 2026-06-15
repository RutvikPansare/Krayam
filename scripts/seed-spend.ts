/**
 * Phase 2 Feature 05 — synthetic spend data for local dashboard testing.
 *
 * Generates ~6 months of fake purchase orders across 10 vendors and the
 * 8 main material categories (line items reference real codes from the
 * materials seed, so category resolution works), plus monthly budgets
 * per category.
 *
 * Usage:
 *   npx tsx scripts/seed-spend.ts          # add synthetic data
 *   npx tsx scripts/seed-spend.ts --clean  # remove it first (POs marked [seed])
 *
 * Reads .env.local for Supabase credentials. Safe for local/demo databases;
 * don't run against production.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const VENDORS = [
  "Sharma Bearings & Co", "Patel Industrial Supply", "Verma Tools Pvt Ltd",
  "Krishna Pipes & Fittings", "Mehta Engineering Works", "Apex Electricals Mumbai",
  "Sundaram Hydraulics", "Bharat Lubricants Agency", "Omkar Fasteners Pune",
  "Deccan Safety Supplies",
];
const PLANTS = ["Pune Plant", "Bhiwandi WH", "Nashik Stores"];
const CATEGORIES = ["bearings", "belts", "fasteners", "electrical", "seals", "lubricants", "consumables", "mechanical"];

// monthly budget per category, INR
const BUDGETS: Record<string, number> = {
  bearings: 120000, belts: 60000, fasteners: 40000, electrical: 180000,
  seals: 30000, lubricants: 90000, consumables: 70000, mechanical: 110000,
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

async function clean() {
  const { data: pos } = await supabase.from("purchase_orders").select("id").like("stock_note", "[seed]%");
  if (pos?.length) {
    await supabase.from("purchase_orders").delete().in("id", pos.map((p) => p.id));
    console.log(`Removed ${pos.length} synthetic POs (items cascade).`);
  }
  await supabase.from("budgets").delete().gte("amount", 0);
  console.log("Removed budgets.");
}

async function main() {
  if (process.argv.includes("--clean")) {
    await clean();
    if (!process.argv.includes("--reseed")) return;
  }

  const { data: materials } = await supabase
    .from("materials")
    .select("material_code, description, unit, unit_price, category")
    .in("category", CATEGORIES);
  if (!materials?.length) {
    console.error("No materials found — run migrations first (materials seed lives in 0002).");
    process.exit(1);
  }
  const byCat = new Map<string, typeof materials>();
  for (const m of materials) {
    byCat.set(m.category!, [...(byCat.get(m.category!) ?? []), m]);
  }

  // ── 6 months of POs ──
  const now = new Date();
  let created = 0;
  for (let mo = 5; mo >= 0; mo--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - mo, 1);
    const poCount = Math.round(rand(10, 18));
    for (let i = 0; i < poCount; i++) {
      const day = Math.min(28, Math.ceil(rand(1, mo === 0 ? Math.max(1, now.getDate()) : 28)));
      const createdAt = new Date(monthStart.getFullYear(), monthStart.getMonth(), day, 10 + Math.floor(rand(0, 7)));
      const vendor = pick(VENDORS);
      const plant = pick(PLANTS);
      const category = pick(CATEGORIES);
      const pool = byCat.get(category) ?? materials;

      const lineCount = Math.ceil(rand(1, 4));
      const lines: any[] = [];
      for (let l = 0; l < lineCount; l++) {
        const mat = pick(pool);
        const qty = Math.ceil(rand(1, mat.unit_price > 5000 ? 3 : 40));
        const price = Math.round(Number(mat.unit_price) * rand(0.92, 1.12) * 100) / 100;
        lines.push({
          item_name: mat.description,
          material_code: mat.material_code,
          quantity: qty,
          unit: mat.unit,
          unit_price: price,
          line_total: Math.round(price * qty * 100) / 100,
        });
      }
      const total = lines.reduce((s, l) => s + l.line_total, 0);

      const { data: po, error } = await supabase
        .from("purchase_orders")
        .insert({
          vendor_name: vendor,
          plant,
          total_amount: Math.round(total * 100) / 100,
          payment_terms: pick(["30 days", "45 days", "Advance", "15 days"]),
          delivery_days: Math.ceil(rand(3, 21)),
          status: "sap_pushed",
          sap_po_number: "45" + String(Math.floor(10000000 + Math.random() * 89999999)),
          sap_mode: "mock",
          stock_note: "[seed] synthetic spend data",
          created_at: createdAt.toISOString(),
        })
        .select()
        .single();
      if (error || !po) { console.error("PO insert failed:", error?.message); continue; }

      await supabase.from("po_items").insert(lines.map((l) => ({ ...l, po_id: po.id })));
      created++;
    }
  }
  console.log(`Created ${created} synthetic POs over 6 months.`);

  // ── Budgets ──
  const budgetRows: any[] = [];
  for (let mo = 5; mo >= 0; mo--) {
    const d = new Date(now.getFullYear(), now.getMonth() - mo, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    for (const [category, amount] of Object.entries(BUDGETS)) {
      budgetRows.push({ category, month, amount });
    }
  }
  const { error: bErr } = await supabase.from("budgets").upsert(budgetRows, { onConflict: "category,month" });
  if (bErr) console.error("Budget upsert failed:", bErr.message);
  else console.log(`Upserted ${budgetRows.length} budget rows (8 categories × 6 months).`);

  console.log("\nDone. Open /dashboard/spend to see the charts.");
}

main();
