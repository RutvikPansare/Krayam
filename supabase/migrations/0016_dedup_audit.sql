-- Krayam — Feature 08: material master deduplication audit.
--
-- A paid onboarding scan that runs as a resumable background job, persists
-- versioned results, and feeds a human-review workflow. Every table is
-- org-scoped (RLS + explicit filters) — audit data is commercially sensitive
-- and must never cross tenants.
--
-- Encryption at rest: Supabase/Postgres storage is encrypted at the disk
-- layer. For column-level protection of descriptions/values, wrap the
-- sensitive columns with pgcrypto in a follow-up — not done here because it
-- would block the similarity reads the report needs. Documented, not silent.

-- ── Audit run — one row per scan, versioned per org ──────────────
create table if not exists audit_runs (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade default krayam_default_org(),
  version               int  not null,
  -- resumable state machine; `step` is the last COMPLETED step so a resume
  -- continues from the next one.
  status                text not null default 'queued'
                        check (status in ('queued','pulling','embedding','clustering','stock','report','complete','failed')),
  step                  text,
  -- headline metrics (filled as steps complete)
  materials_analyzed    int  not null default 0,
  confirmed_count       int  not null default 0,
  probable_count        int  not null default 0,
  review_count          int  not null default 0,
  duplicate_value_paise bigint not null default 0,
  -- ops
  started_by            text,
  cfo_email             text,
  report_pdf_path       text,
  error                 text,
  heartbeat_at          timestamptz,         -- watchdog: stale heartbeat ⇒ timed out
  started_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  finished_at           timestamptz,
  unique (org_id, version)
);
create index if not exists audit_runs_org_idx on audit_runs (org_id, version desc);

-- ── Clusters (duplicate families) for a run ──────────────────────
create table if not exists audit_clusters (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade default krayam_default_org(),
  run_id                uuid not null references audit_runs(id) on delete cascade,
  label                 text not null check (label in ('confirmed','probable','review')),
  cohesion              real not null,        -- representative cosine similarity of the family
  primary_code          text not null,
  member_count          int  not null,
  duplicate_units       numeric not null default 0,
  duplicate_value_paise bigint not null default 0,
  review_status         text not null default 'pending' check (review_status in ('pending','confirmed','rejected')),
  reviewed_by           text,
  reviewed_at           timestamptz
);
create index if not exists audit_clusters_run_idx on audit_clusters (run_id, duplicate_value_paise desc);
create index if not exists audit_clusters_org_idx on audit_clusters (org_id);

create table if not exists audit_cluster_members (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade default krayam_default_org(),
  cluster_id            uuid not null references audit_clusters(id) on delete cascade,
  material_code         text not null,
  description           text,
  unit                  text,
  unit_price_paise      bigint not null default 0,   -- moving avg price × 100
  stock_qty             numeric not null default 0,
  stock_value_paise     bigint not null default 0,
  similarity_to_primary real not null default 1,
  is_primary            boolean not null default false
);
create index if not exists audit_cluster_members_cluster_idx on audit_cluster_members (cluster_id);
create index if not exists audit_cluster_members_org_idx on audit_cluster_members (org_id);

-- ── RLS — org members read their own audit data; writes via service role ─
alter table audit_runs            enable row level security;
alter table audit_clusters        enable row level security;
alter table audit_cluster_members enable row level security;
create policy "audit_runs_org"     on audit_runs            for select to authenticated using (org_id in (select auth_org_ids()));
create policy "audit_clusters_org" on audit_clusters        for select to authenticated using (org_id in (select auth_org_ids()));
create policy "audit_members_org"  on audit_cluster_members for select to authenticated using (org_id in (select auth_org_ids()));

-- ── Per-org version allocator ────────────────────────────────────
create or replace function next_audit_version(p_org uuid)
returns int language sql stable as $$
  select coalesce(max(version), 0) + 1 from audit_runs where org_id = p_org;
$$;

-- ── Private bucket for branded PDF reports ───────────────────────
insert into storage.buckets (id, name, public) values ('audit-reports', 'audit-reports', false)
on conflict (id) do nothing;
