-- Krayam — Feature 07: AI duplicate detection + material multi-tenancy.
--
-- Adds: pgvector embeddings (semantic search), per-customer isolation
-- (customer_id + RLS), a delta-sync cursor, and the cosine-match RPC.

create extension if not exists vector;

-- ── Customers (tenants) ──────────────────────────────────────────
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

-- Default tenant for this install; existing material rows backfill to it.
insert into customers (name, slug)
values (coalesce(current_setting('app.company_name', true), 'Default Company'), 'default')
on conflict (slug) do nothing;

-- ── materials: tenancy + embeddings + sync metadata ──────────────
alter table materials add column if not exists customer_id    uuid references customers(id) on delete cascade;
alter table materials add column if not exists embedding      vector(1536);
alter table materials add column if not exists updated_at      timestamptz not null default now();
alter table materials add column if not exists sap_changed_at  timestamptz;          -- LastChangeDate from SAP (delta cursor source)
alter table materials add column if not exists embedding_text  text;                 -- text the current embedding was built from (skip re-embed if unchanged)

-- Backfill existing rows to the default tenant, then enforce NOT NULL.
update materials
  set customer_id = (select id from customers where slug = 'default')
  where customer_id is null;
alter table materials alter column customer_id set not null;

-- Material codes are unique *per customer*, not globally — two customers may
-- legitimately use the same code. Replace the global unique constraint.
alter table materials drop constraint if exists materials_material_code_key;
create unique index if not exists materials_customer_code_uniq
  on materials (customer_id, material_code);

-- ── Indexes ──────────────────────────────────────────────────────
-- HNSW cosine index: vector search uses the index, never a full scan.
create index if not exists materials_embedding_hnsw
  on materials using hnsw (embedding vector_cosine_ops);
-- Keep the trigram index for the no-embedding-provider fallback path.
create index if not exists materials_desc_trgm on materials using gin (description gin_trgm_ops);
-- Tenant-scoped lookups.
create index if not exists materials_customer_idx on materials (customer_id);

-- ── RLS: authenticated dashboard reads are limited to this install's
--    customer. The real cross-tenant guard is the search route, which runs
--    as the service role and ALWAYS filters by the resolved customer_id —
--    RLS here is defense in depth, not the only layer.
--
-- Single install = one customer (KRAYAM_CUSTOMER_SLUG, default 'default').
-- Set it per database so the policy resolves the right tenant:
--   alter database postgres set app.customer_slug = 'default';
drop policy if exists "auth read materials" on materials;
create policy "tenant read materials" on materials
  for select to authenticated
  using (
    customer_id = (
      select id from customers
      where slug = coalesce(current_setting('app.customer_slug', true), 'default')
    )
  );

-- When a material's description changes, drop its embedding so the next sync
-- re-embeds it. Keeps semantic search honest without per-row diffing in app code.
create or replace function materials_clear_embedding_on_change()
returns trigger language plpgsql as $$
begin
  if new.description is distinct from old.description then
    new.embedding := null;
    new.embedding_text := null;
  end if;
  return new;
end;
$$;

drop trigger if exists materials_desc_embedding on materials;
create trigger materials_desc_embedding
  before update on materials
  for each row execute function materials_clear_embedding_on_change();

-- ── Delta-sync cursor (one row per customer) ─────────────────────
create table if not exists material_sync_state (
  customer_id    uuid primary key references customers(id) on delete cascade,
  last_synced_at timestamptz,           -- max SAP LastChangeDate pulled so far
  last_run_at    timestamptz,
  last_status    text,
  last_error     text
);

-- ── Cosine match RPC — tenant-scoped, index-backed, thresholded ──
-- Returns matches with cosine similarity >= match_threshold (e.g. 0.82),
-- highest first. Operates only within p_customer.
create or replace function match_materials(
  p_customer       uuid,
  query_embedding  vector(1536),
  match_threshold  float default 0.82,
  match_count      int default 3
)
returns table (
  material_code text,
  description   text,
  unit          text,
  unit_price    numeric,
  stock         jsonb,
  score         real
)
language sql stable as $$
  select m.material_code, m.description, m.unit, m.unit_price, m.stock,
         (1 - (m.embedding <=> query_embedding))::real as score
  from materials m
  where m.customer_id = p_customer
    and m.embedding is not null
    and (1 - (m.embedding <=> query_embedding)) >= match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- Trigram fallback gains a tenant filter too.
create or replace function search_materials(p_customer uuid, q text, max_results int default 3)
returns table (
  material_code text,
  description   text,
  unit          text,
  unit_price    numeric,
  stock         jsonb,
  score         real
)
language sql stable as $$
  select m.material_code, m.description, m.unit, m.unit_price, m.stock,
         greatest(similarity(m.description, q), word_similarity(q, m.description)) as score
  from materials m
  where m.customer_id = p_customer
    and (m.description % q
      or word_similarity(q, m.description) > 0.25
      or m.description ilike '%' || q || '%'
      or m.material_code ilike '%' || q || '%')
  order by score desc
  limit max_results;
$$;
