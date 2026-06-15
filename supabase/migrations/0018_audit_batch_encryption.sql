-- Krayam — Feature 08 hardening: OpenAI Batch API state + encryption at rest.

-- ── Batch embedding job tracking (OpenAI 24h Batch API) ──────────
-- The embedding step submits one batch, stores its id, and polls across
-- worker ticks — fully resumable: a crash leaves the batch id persisted and
-- the next tick resumes polling instead of re-submitting.
alter table audit_runs add column if not exists embed_batch_id     text;
alter table audit_runs add column if not exists embed_batch_status text;

-- ── Encryption at rest for commercially-sensitive audit fields ───
-- Material descriptions and per-line stock values are encrypted with
-- app-managed AES-256-GCM (key in AUDIT_ENC_KEY) before storage. Clustering
-- runs on the embedding vectors, never these columns, so encryption does not
-- block similarity. Cluster-level aggregate value (duplicate_value_paise) is
-- kept plaintext because the report must sort "top 10 by value" — it is
-- protected by RLS + Supabase disk-level at-rest encryption.
alter table audit_cluster_members add column if not exists description_enc   text;
alter table audit_cluster_members add column if not exists stock_value_enc   text;

-- The plaintext columns are no longer written for new runs; keep them for
-- backward compatibility with any pre-existing rows.
