/**
 * Text embeddings for semantic material search (Feature 07).
 *
 * Provider-agnostic, REST only (no SDK). Gemini preferred, OpenAI fallback.
 * Both are pinned to 1536 dimensions so a single pgvector(1536) column works
 * regardless of provider, and every vector is L2-normalized so cosine
 * similarity (pgvector's <=>) is exact and comparable across providers.
 *
 *   GEMINI_API_KEY  → gemini-embedding-001 (outputDimensionality 1536)
 *   OPENAI_API_KEY  → text-embedding-3-small (native 1536)
 *
 * If neither key is set, embedText returns null and callers degrade to
 * trigram/fuzzy search — the feature keeps working without embeddings.
 */

export const EMBED_DIM = 1536;

export function embeddingsEnabled(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

/**
 * fetch with exponential backoff on 429 / 5xx — respects provider rate limits.
 * Honors Retry-After when present; otherwise 0.5s, 1s, 2s, 4s… with jitter.
 */
async function fetchWithBackoff(url: string, init: RequestInit, maxRetries = 5): Promise<Response> {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt >= maxRetries) return res; // give up; caller handles !ok
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(500 * 2 ** attempt, 16000) + Math.random() * 250;
    await new Promise((r) => setTimeout(r, backoff));
    attempt++;
  }
}

/** L2-normalize so dot product == cosine similarity. */
function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

async function embedGemini(texts: string[], key: string): Promise<number[][]> {
  // Batch endpoint: one request, many values.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${key}`;
  const res = await fetchWithBackoff(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((t) => ({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: t }] },
        outputDimensionality: EMBED_DIM,
        taskType: "SEMANTIC_SIMILARITY",
      })),
    }),
  });
  if (!res.ok) throw new Error(`Gemini embed failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  // Dimensions other than 3072 are not pre-normalized by the API.
  return (body.embeddings ?? []).map((e: any) => normalize(e.values as number[]));
}

async function embedOpenAI(texts: string[], key: string): Promise<number[][]> {
  const res = await fetchWithBackoff("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: EMBED_DIM }),
  });
  if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return (body.data ?? []).map((d: any) => normalize(d.embedding as number[]));
}

/** Embed many texts in one call. Returns [] if no provider configured. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const gemini = process.env.GEMINI_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  try {
    if (gemini) return await embedGemini(texts, gemini);
    if (openai) return await embedOpenAI(texts, openai);
  } catch (err) {
    console.error("Embedding generation failed:", err);
  }
  return [];
}

/** Embed a single text. Returns null if no provider or on failure. */
export async function embedText(text: string): Promise<number[] | null> {
  const [v] = await embedTexts([text]);
  return v ?? null;
}

/** pgvector text literal: '[0.1,0.2,...]'. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

// ─────────────────────────────────────────────────────────────────────────
// OpenAI Batch API — async 24h embeddings at ~50% cost. Used by the dedup
// audit's embedding step, which is a background job that can wait. Fully
// resumable: submit returns a batch id we persist, then poll across ticks.
// ─────────────────────────────────────────────────────────────────────────

export function batchEmbeddingsEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export interface BatchPollResult {
  status: "validating" | "in_progress" | "finalizing" | "completed" | "failed" | "expired" | "cancelled";
  vectors?: Map<string, number[]>; // custom_id → normalized embedding (when completed)
}

/** Submit a batch embedding job. Returns the OpenAI batch id. */
export async function submitOpenAIEmbeddingBatch(items: { custom_id: string; text: string }[]): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");

  // 1. Build the JSONL request file (one embedding request per material).
  const jsonl = items
    .map((it) => JSON.stringify({
      custom_id: it.custom_id,
      method: "POST",
      url: "/v1/embeddings",
      body: { model: "text-embedding-3-small", input: it.text, dimensions: EMBED_DIM },
    }))
    .join("\n");

  // 2. Upload via the Files API (purpose: batch).
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new Blob([jsonl], { type: "application/jsonl" }), "audit-embeddings.jsonl");
  const upRes = await fetchWithBackoff("https://api.openai.com/v1/files", {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  if (!upRes.ok) throw new Error(`OpenAI file upload failed: ${upRes.status} ${await upRes.text()}`);
  const file = await upRes.json();

  // 3. Create the batch against the embeddings endpoint (24h completion window).
  const bRes = await fetchWithBackoff("https://api.openai.com/v1/batches", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input_file_id: file.id, endpoint: "/v1/embeddings", completion_window: "24h" }),
  });
  if (!bRes.ok) throw new Error(`OpenAI batch create failed: ${bRes.status} ${await bRes.text()}`);
  return (await bRes.json()).id as string;
}

/** Poll a batch; when completed, download and parse the output into vectors. */
export async function pollOpenAIEmbeddingBatch(batchId: string): Promise<BatchPollResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");

  const res = await fetchWithBackoff(`https://api.openai.com/v1/batches/${batchId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`OpenAI batch poll failed: ${res.status}`);
  const batch = await res.json();
  if (batch.status !== "completed") return { status: batch.status };

  const outRes = await fetchWithBackoff(`https://api.openai.com/v1/files/${batch.output_file_id}/content`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!outRes.ok) throw new Error(`OpenAI batch output download failed: ${outRes.status}`);
  const text = await outRes.text();

  const vectors = new Map<string, number[]>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const emb = row?.response?.body?.data?.[0]?.embedding;
    if (row.custom_id && Array.isArray(emb)) vectors.set(row.custom_id, normalize(emb));
  }
  return { status: "completed", vectors };
}
