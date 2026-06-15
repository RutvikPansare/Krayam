/**
 * Feature 07 Part C — one-time material master import.
 *
 * Takes the SE16 MAKT export (saved as CSV) and loads it into the
 * `materials` mirror. Expected columns (header row, comma-separated):
 *
 *   material_code,description[,unit][,unit_price][,category]
 *
 * Usage:
 *   npx tsx scripts/import-materials.ts path/to/makt-export.csv
 *
 * Reads .env.local for Supabase credentials. Upserts on material_code,
 * so re-running is safe.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import fs from "fs";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("Usage: npx tsx scripts/import-materials.ts <makt-export.csv>");
  process.exit(1);
}

// Minimal CSV parse — handles quoted fields with commas
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (field || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  const rows = parseCsv(fs.readFileSync(file!, "utf8"));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iCode = idx("material_code"), iDesc = idx("description");
  if (iCode < 0 || iDesc < 0) {
    console.error(`CSV must have material_code and description columns. Found: ${header.join(", ")}`);
    process.exit(1);
  }
  const iUnit = idx("unit"), iPrice = idx("unit_price"), iCat = idx("category");

  const records = rows.slice(1)
    .filter((r) => r[iCode]?.trim() && r[iDesc]?.trim())
    .map((r) => ({
      material_code: r[iCode].trim(),
      description: r[iDesc].trim(),
      unit: iUnit >= 0 && r[iUnit]?.trim() ? r[iUnit].trim() : "piece",
      unit_price: iPrice >= 0 ? Number(r[iPrice]) || 0 : 0,
      category: iCat >= 0 && r[iCat]?.trim() ? r[iCat].trim() : null,
    }));

  console.log(`Importing ${records.length} materials…`);
  const supabase = createClient(url!, key!);
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await supabase.from("materials").upsert(batch, { onConflict: "material_code" });
    if (error) { console.error(`Batch ${i / 500 + 1} failed:`, error.message); process.exit(1); }
    console.log(`  ${Math.min(i + 500, records.length)}/${records.length}`);
  }
  console.log("Done. Run the dedup audit at /dashboard/audit to see what it finds.");
}

main();
