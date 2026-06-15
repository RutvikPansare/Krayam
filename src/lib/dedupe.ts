/**
 * Feature 08 — Material master deduplication.
 *
 * Clusters near-duplicate material descriptions:
 *   "Bearing 6205" / "SKF Brg 6205ZZ" / "Ball Bearing 6205" → one cluster.
 *
 * Approach: normalize (lowercase, expand trade abbreviations, strip brands),
 * extract model numbers, then union-find on pairwise similarity =
 * token Jaccard + a strong boost for a shared model number.
 */

export interface MaterialRow {
  material_code: string;
  description: string;
  unit: string;
  unit_price: number;
  stock: Record<string, number>;
  category?: string | null;
}

export interface DuplicateCluster {
  members: MaterialRow[];
  /** canonical (first/cheapest) member */
  primary: MaterialRow;
  /** stock value of NON-primary members — money locked in duplicates */
  duplicateValue: number;
  /** total units held across non-primary members */
  duplicateUnits: number;
}

const ABBREV: Record<string, string> = {
  brg: "bearing", brng: "bearing", bearng: "bearing",
  mtr: "metre", mm: "mm", elment: "element",
  hyd: "hydraulic", pneu: "pneumatic",
  ss: "ss", gi: "gi", ms: "ms",
  amp: "a", amps: "a", watt: "w", watts: "w",
  "in": "inch", "ins": "inch",
};

// Brand names carry no identity for dedup — same part, different supplier.
const BRANDS = new Set([
  "skf", "fag", "ntn", "nbc", "zkl", "fenner", "dunlop", "siemens", "legrand",
  "schneider", "abb", "havells", "polycab", "philips", "crompton", "omron",
  "festo", "smc", "janatics", "ador", "esab", "audco", "lt", "bharat", "servo",
  "castrol", "diamond", "tidc", "lovejoy", "delta", "danfoss",
]);

const STOPWORDS = new Set(["with", "and", "for", "of", "x", "type", "make", "base", "head"]);

export function normalizeTokens(desc: string): string[] {
  const raw = desc
    .toLowerCase()
    .replace(/([a-z])-(\d)/g, "$1$2") // "B-68" → "b68"
    .replace(/[^a-z0-9.]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBREV[t] ?? t)
    .filter((t) => !BRANDS.has(t) && !STOPWORDS.has(t));

  // Merge a standalone 1–2 letter token followed by digits: "b 68" → "b68"
  const merged: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (/^[a-z]{1,2}$/.test(raw[i]) && i + 1 < raw.length && /^\d+$/.test(raw[i + 1])) {
      merged.push(raw[i] + raw[i + 1]);
      i++;
    } else {
      merged.push(raw[i]);
    }
  }
  return merged;
}

/** model-ish tokens: digits or letter+digit mixes ("6205", "6205zz", "b68", "m12x50") */
export function modelTokens(tokens: string[]): string[] {
  return tokens
    .filter((t) => /\d/.test(t))
    .map((t) => t.replace(/(zz|2rs|rs|c3)$/i, "")) // bearing seal suffixes
    .map((t) => t.replace(/[^a-z0-9]/g, ""));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter++; });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function similarity(d1: string, d2: string): number {
  const t1 = normalizeTokens(d1);
  const t2 = normalizeTokens(d2);
  const s1 = new Set(t1);
  const s2 = new Set(t2);
  let score = jaccard(s1, s2);

  const m1 = new Set(modelTokens(t1));
  const m2 = new Set(modelTokens(t2));
  if (m1.size && m2.size) {
    let sharedModel = false;
    m1.forEach((m) => { if (m2.has(m)) sharedModel = true; });
    if (sharedModel) score += 0.45;          // same model number → almost certainly same part
    else if (jaccard(m1, m2) === 0) score -= 0.3; // different model numbers → different part
  }
  return Math.min(1, Math.max(0, score));
}

const THRESHOLD = 0.55;

export function findDuplicateClusters(materials: MaterialRow[]): DuplicateCluster[] {
  const n = materials.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  // Block by category to keep pairwise comparison tractable on 15–30k codes
  const blocks = new Map<string, number[]>();
  materials.forEach((m, i) => {
    const key = m.category ?? "uncategorized";
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key)!.push(i);
  });

  blocks.forEach((idxs) => {
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        if (similarity(materials[idxs[a]].description, materials[idxs[b]].description) >= THRESHOLD) {
          union(idxs[a], idxs[b]);
        }
      }
    }
  });

  const groups = new Map<number, MaterialRow[]>();
  materials.forEach((m, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(m);
  });

  const clusters: DuplicateCluster[] = [];
  groups.forEach((members) => {
    if (members.length < 2) return;
    const primary = [...members].sort((a, b) => a.unit_price - b.unit_price)[0];
    let duplicateValue = 0;
    let duplicateUnits = 0;
    for (const m of members) {
      if (m === primary) continue;
      const qty = Object.values(m.stock ?? {}).reduce((s, q) => s + Number(q || 0), 0);
      duplicateUnits += qty;
      duplicateValue += qty * Number(m.unit_price || 0);
    }
    clusters.push({ members, primary, duplicateValue, duplicateUnits });
  });

  return clusters.sort((a, b) => b.duplicateValue - a.duplicateValue);
}
