-- Krayam — Feature 11 (spec sheet attachments), Feature 12 (3-way invoice
-- matching), Feature 13 (GRN automation), Phase 2 Feature 05 (CFO spend
-- dashboard: budgets + plant column on POs).

-- ── Feature 11: PR attachments ──────────────────────────────────
-- Files live in the Supabase Storage bucket "attachments"; this table is
-- the metadata index. pr_id is null while the file sits in staging (uploaded
-- before the PR row exists), then linked on PR submit.
create table if not exists pr_attachments (
  id            uuid primary key default gen_random_uuid(),
  pr_id         uuid references purchase_requests(id) on delete cascade,
  file_name     text not null,
  storage_path  text not null,
  size_bytes    integer not null,
  content_type  text not null default 'application/pdf',
  created_at    timestamptz not null default now()
);

alter table pr_attachments enable row level security;
create policy "auth read pr attachments" on pr_attachments for select to authenticated using (true);

-- Private buckets for spec sheets and uploaded invoices
insert into storage.buckets (id, name, public) values
  ('attachments', 'attachments', false),
  ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- ── Feature 13: Goods Receipt Notes ─────────────────────────────
create sequence if not exists grn_number_seq start 3001;

create table if not exists grns (
  id              uuid primary key default gen_random_uuid(),
  grn_number      text not null unique default ('GRN-' || nextval('grn_number_seq')),
  po_id           uuid not null references purchase_orders(id) on delete cascade,
  received_by     text,
  note            text,
  status          text not null default 'created' check (status in ('created','sap_pushed','failed')),
  sap_grn_number  text,          -- SAP material document number
  sap_mode        text,
  sap_error       text,
  created_at      timestamptz not null default now()
);

create table if not exists grn_items (
  id            uuid primary key default gen_random_uuid(),
  grn_id        uuid not null references grns(id) on delete cascade,
  po_item_id    uuid not null references po_items(id) on delete cascade,
  item_name     text not null,
  material_code text,
  quantity_received numeric not null check (quantity_received > 0),
  unit          text not null default 'piece'
);

alter table grns      enable row level security;
alter table grn_items enable row level security;
create policy "auth read grns"      on grns      for select to authenticated using (true);
create policy "auth read grn items" on grn_items for select to authenticated using (true);

-- PO gains a 'received' state once goods land
alter table purchase_orders drop constraint if exists purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check
  check (status in ('created','sap_pushed','sent','received','cancelled'));

-- ── Feature 12: Invoices + 3-way match ──────────────────────────
create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid references purchase_orders(id) on delete set null,
  vendor_name     text,
  invoice_number  text,
  invoice_date    date,
  gstin           text,
  subtotal        numeric,
  tax_amount      numeric,
  total_amount    numeric,
  file_name       text not null,
  storage_path    text not null,
  raw_text        text,                       -- extracted PDF text, kept for re-parse/debug
  status          text not null default 'extracted'
                  check (status in ('extracted','matched','discrepancy','approved','rejected')),
  match_results   jsonb,                      -- [{code, severity, message}]
  matched_at      timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id) on delete cascade,
  description   text not null,
  quantity      numeric,
  unit_price    numeric,
  line_total    numeric
);

alter table invoices      enable row level security;
alter table invoice_items enable row level security;
create policy "auth read invoices"      on invoices      for select to authenticated using (true);
create policy "auth read invoice items" on invoice_items for select to authenticated using (true);

-- ── Phase 2 Feature 05: spend analytics ─────────────────────────
-- Plant lives on the PO so spend can slice by plant without joining PRs
-- (synthetic seed data has no PR).
alter table purchase_orders add column if not exists plant text;

create table if not exists budgets (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,
  month       date not null,     -- first of month
  amount      numeric not null,  -- INR
  unique (category, month)
);

alter table budgets enable row level security;
create policy "auth all budgets" on budgets for all to authenticated using (true) with check (true);
