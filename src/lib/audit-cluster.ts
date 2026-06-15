import { CONFIRMED_THRESHOLD, PROBABLE_THRESHOLD, type ClusterLabel } from "@/types/audit";

/**
 * Feature 08 — duplicate clustering over embedding vectors (not string match).
 *
 * DBSCAN-style: two materials are neighbours when their cosine similarity is
 * ≥ PROBABLE_THRESHOLD (0.82). A duplicate family is a connected component of
 * the neighbour graph (min size 2). Embeddings are stored L2-normalized, so
 * cosine similarity is the dot product.
 *
 * The family's cohesion is the average pairwise similarity; the label follows:
 *   cohesion ≥ 0.92 → confirmed, ≥ 0.82 → probable, else → review.
 * The primary (canonical) member is the medoid — the item most similar to the
 * rest — i.e. the code the others should consolidate into.
 */

export interface ClusterInput {
  material_code: string;
  embedding: number[];
}

export interface ClusterShape {
  label: ClusterLabel;
  cohesion: number;
  primary_code: string;
  members: { material_code: string; similarity_to_primary: number; is_primary: boolean }[];
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// Union-find
class DSU {
  parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(x: number): number { return this.parent[x] === x ? x : (this.parent[x] = this.find(this.parent[x])); }
  union(a: number, b: number) { this.parent[this.find(a)] = this.find(b); }
}

export function clusterMaterials(items: ClusterInput[]): ClusterShape[] {
  const n = items.length;
  if (n < 2) return [];

  // Pairwise neighbour graph at the probable threshold. O(n²) — fine for the
  // onboarding batch (a few thousand materials); chunk/ANN if it grows.
  const sim: Map<string, number> = new Map(); // "i,j" (i<j) → similarity
  const dsu = new DSU(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = dot(items[i].embedding, items[j].embedding);
      if (s >= PROBABLE_THRESHOLD) {
        sim.set(`${i},${j}`, s);
        dsu.union(i, j);
      }
    }
  }
  const simOf = (i: number, j: number) => (i === j ? 1 : sim.get(i < j ? `${i},${j}` : `${j},${i}`) ?? dot(items[i].embedding, items[j].embedding));

  // Group indices by component.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = dsu.find(i);
    const arr = groups.get(r);
    if (arr) arr.push(i);
    else groups.set(r, [i]);
  }

  const clusters: ClusterShape[] = [];
  for (const idxs of Array.from(groups.values())) {
    if (idxs.length < 2) continue;

    // medoid = member with the highest total similarity to the rest
    let medoid = idxs[0];
    let bestSum = -Infinity;
    let pairCount = 0;
    let pairSum = 0;
    for (const a of idxs) {
      let sum = 0;
      for (const b of idxs) if (a !== b) sum += simOf(a, b);
      if (sum > bestSum) { bestSum = sum; medoid = a; }
    }
    for (let x = 0; x < idxs.length; x++)
      for (let y = x + 1; y < idxs.length; y++) { pairSum += simOf(idxs[x], idxs[y]); pairCount++; }

    const cohesion = pairCount > 0 ? pairSum / pairCount : 1;
    const label: ClusterLabel =
      cohesion >= CONFIRMED_THRESHOLD ? "confirmed" : cohesion >= PROBABLE_THRESHOLD ? "probable" : "review";

    clusters.push({
      label,
      cohesion,
      primary_code: items[medoid].material_code,
      members: idxs.map((i: number) => ({
        material_code: items[i].material_code,
        similarity_to_primary: i === medoid ? 1 : simOf(i, medoid),
        is_primary: i === medoid,
      })),
    });
  }

  // Largest/most-cohesive families first.
  clusters.sort((a, b) => b.members.length - a.members.length || b.cohesion - a.cohesion);
  return clusters;
}
