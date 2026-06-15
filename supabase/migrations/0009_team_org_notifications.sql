-- Krayam — Team management, organization profile, role-based notifications.
-- Single-tenant enterprise install: one company, one team.

-- ── Organization profile (replaces COMPANY_NAME env for display use) ──
create table if not exists company_settings (
  id            int primary key default 1 check (id = 1),
  company_name  text not null default 'Krayam Manufacturing',
  address       text,
  gstin         text,
  cin           text,
  logo_url      text,
  updated_at    timestamptz not null default now()
);

insert into company_settings (id) values (1) on conflict (id) do nothing;

alter table company_settings enable row level security;
create policy "auth read company" on company_settings for select to authenticated using (true);

-- ── Team members with enterprise roles ──────────────────────────
-- owner            Managing Director — full access, cannot be removed
-- admin            IT Administrator — full access, manages team & config
-- cfo              Finance Controller — spend, invoices, PO oversight
-- purchase_officer Purchase Officer — runs RFQs, quotes, POs
-- engineer         Plant Engineer — raises PRs, tracks own requests
create table if not exists team_members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        text not null default 'engineer'
              check (role in ('owner','admin','cfo','purchase_officer','engineer')),
  created_at  timestamptz not null default now()
);

alter table team_members enable row level security;
create policy "auth read team" on team_members for select to authenticated using (true);

-- ── Notifications (per-user fan-out, role-routed at write time) ─
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null,            -- pr_created | pr_approved | pr_rejected | quote_received | po_created | invoice_flagged | grn_posted
  title       text not null,
  body        text,
  link        text,                     -- in-app path, e.g. /dashboard/requests/<id>
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx on notifications (user_id, read, created_at desc);

alter table notifications enable row level security;
create policy "own notifications read"   on notifications for select to authenticated using (user_id = auth.uid());
create policy "own notifications update" on notifications for update to authenticated using (user_id = auth.uid());

-- Realtime for the bell
alter publication supabase_realtime add table notifications;
