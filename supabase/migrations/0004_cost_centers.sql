-- Cost centers for the PR form (mirrors SAP CSKS cost center master).
-- Seeded locally; in production imported from SAP or maintained by finance.

create table if not exists cost_centers (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table cost_centers enable row level security;
create policy "auth read cost centers" on cost_centers for select to authenticated using (true);

alter table purchase_requests add column if not exists cost_center text;

insert into cost_centers (code, name) values
  ('CC-1010', 'Maintenance - Plant 1'),
  ('CC-1020', 'Production - Plant 1'),
  ('CC-1030', 'Quality - Plant 1'),
  ('CC-2010', 'Maintenance - Plant 2'),
  ('CC-2020', 'Production - Plant 2'),
  ('CC-3010', 'Stores & Warehouse'),
  ('CC-4010', 'Electrical & Utilities'),
  ('CC-9010', 'Admin & General')
on conflict (code) do nothing;
