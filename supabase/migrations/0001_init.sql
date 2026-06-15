-- Krayam — Procurement Intelligence
-- Core schema: purchase requests, approvals, vendors, RFQs, quotes.

create extension if not exists "pgcrypto";

-- ── Sequence-backed human-readable numbers ──────────────────────
create sequence if not exists pr_number_seq start 1001;
create sequence if not exists rfq_number_seq start 501;

-- ── Purchase Requests (Feature 01) ──────────────────────────────
create table if not exists purchase_requests (
  id              uuid primary key default gen_random_uuid(),
  pr_number       text not null unique default ('PR-' || nextval('pr_number_seq')),
  requester_name  text not null,
  requester_email text not null,
  department      text,
  plant           text,
  priority        text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  needed_by       date,
  justification   text,
  status          text not null default 'pending_approval'
                  check (status in ('pending_approval','approved','rejected','sap_created','rfq_sent','quotes_in','ordered')),
  approver_email  text not null,
  approver_note   text,
  approved_at     timestamptz,
  sap_pr_number   text,
  sap_mode        text,
  sap_error       text,
  created_at      timestamptz not null default now()
);

create table if not exists pr_items (
  id          uuid primary key default gen_random_uuid(),
  pr_id       uuid not null references purchase_requests(id) on delete cascade,
  item_name   text not null,
  material_code text,
  quantity    numeric not null check (quantity > 0),
  unit        text not null default 'piece',
  notes       text,
  created_at  timestamptz not null default now()
);

-- ── Vendors (master data for Features 04/05) ────────────────────
create table if not exists vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  phone       text,
  city        text,
  categories  text[] not null default '{}',
  rating      numeric,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── RFQs (Feature 04) ───────────────────────────────────────────
create table if not exists rfqs (
  id          uuid primary key default gen_random_uuid(),
  rfq_number  text not null unique default ('RFQ-' || nextval('rfq_number_seq')),
  pr_id       uuid not null references purchase_requests(id) on delete cascade,
  due_date    date,
  status      text not null default 'sent' check (status in ('draft','sent','quotes_in','closed')),
  created_at  timestamptz not null default now()
);

-- one row per vendor invited to an RFQ; carries the magic-link token
create table if not exists rfq_vendors (
  id          uuid primary key default gen_random_uuid(),
  rfq_id      uuid not null references rfqs(id) on delete cascade,
  vendor_id   uuid not null references vendors(id) on delete cascade,
  email_sent_at timestamptz,
  unique (rfq_id, vendor_id)
);

-- ── Quotes (Feature 05) ─────────────────────────────────────────
create table if not exists quotes (
  id              uuid primary key default gen_random_uuid(),
  rfq_id          uuid not null references rfqs(id) on delete cascade,
  vendor_id       uuid references vendors(id) on delete set null,
  vendor_name     text not null,          -- denormalized: supports manual entry
  source          text not null default 'portal' check (source in ('portal','manual')),
  delivery_days   integer,
  payment_terms   text,
  notes           text,
  submitted_at    timestamptz not null default now(),
  unique (rfq_id, vendor_id)
);

create table if not exists quote_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  pr_item_id  uuid not null references pr_items(id) on delete cascade,
  price       numeric not null check (price >= 0),  -- price per quoted unit, INR
  quote_unit  text not null default 'piece',
  available   boolean not null default true,
  unique (quote_id, pr_item_id)
);

-- ── RLS ─────────────────────────────────────────────────────────
-- Public flows (PR form, approval links, vendor quote forms) all go through
-- server API routes using the service-role key. Dashboard reads happen as
-- authenticated users. Lock tables down; allow read to authenticated.

alter table purchase_requests enable row level security;
alter table pr_items          enable row level security;
alter table vendors           enable row level security;
alter table rfqs              enable row level security;
alter table rfq_vendors       enable row level security;
alter table quotes            enable row level security;
alter table quote_items       enable row level security;

create policy "auth read prs"     on purchase_requests for select to authenticated using (true);
create policy "auth read items"   on pr_items          for select to authenticated using (true);
create policy "auth all vendors"  on vendors           for all    to authenticated using (true) with check (true);
create policy "auth read rfqs"    on rfqs              for select to authenticated using (true);
create policy "auth read rfqv"    on rfq_vendors       for select to authenticated using (true);
create policy "auth read quotes"  on quotes            for select to authenticated using (true);
create policy "auth read qitems"  on quote_items       for select to authenticated using (true);

-- ── Seed vendors (testing Feature 04: point emails at yourself) ─
insert into vendors (name, email, city, categories) values
  ('Sharma Bearings & Co',   'vendor1@example.com', 'Pune',      '{bearings,mechanical}'),
  ('Patel Industrial Supply','vendor2@example.com', 'Ahmedabad', '{electrical,consumables}'),
  ('Verma Tools Pvt Ltd',    'vendor3@example.com', 'Ludhiana',  '{tools,mechanical}'),
  ('Krishna Pipes & Fittings','vendor4@example.com','Chennai',   '{plumbing,fabrication}'),
  ('Mehta Engineering Works','vendor5@example.com', 'Mumbai',    '{mechanical,fabrication}')
on conflict do nothing;
