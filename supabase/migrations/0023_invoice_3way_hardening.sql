-- Krayam — Feature 12 hardening: production 3-way invoice matching.
--
-- Adds the schema the fraud-prevention and matching logic needs:
--   • vendor master bank details (the baseline bank-change detection compares to)
--   • per-org tolerances + a dedicated inbound-invoice email token (tenant isolation)
--   • invoice columns: source, vendor link, extracted bank, dedup/content hashes,
--     raw extraction payload (audit), extraction error, expanded status
--   • a DB-enforced duplicate guard (unique index on org_id + dedup_hash)
--   • bank_change_alerts: every CFO alert is persisted, not just emailed
--
-- All statements are idempotent so re-running the migration set is safe.

-- ── Vendor master: GSTIN + bank details ─────────────────────────
-- These are the authoritative values. An invoice whose bank details differ
-- from these triggers the high-priority CFO alert.
alter table vendors add column if not exists gstin                 text;
alter table vendors add column if not exists bank_account_number   text;
alter table vendors add column if not exists bank_ifsc             text;
alter table vendors add column if not exists bank_name             text;

-- ── Per-org configuration ───────────────────────────────────────
-- Tolerances are configurable per customer; defaults match the spec
-- (2% price, 0% quantity). invoice_inbox_token is the unguessable local-part
-- of that customer's dedicated invoice inbox (e.g. inv-<token>@in.krayam.app),
-- so one tenant's vendor email can never land in another tenant's queue.
alter table organizations add column if not exists price_tolerance_pct numeric not null default 2;
alter table organizations add column if not exists qty_tolerance_pct   numeric not null default 0;
alter table organizations add column if not exists invoice_inbox_token text;

update organizations
   set invoice_inbox_token = encode(gen_random_bytes(12), 'hex')
 where invoice_inbox_token is null;

create unique index if not exists organizations_invoice_inbox_uniq
  on organizations (invoice_inbox_token);

-- ── Invoices: extraction audit, fraud hashes, lifecycle ─────────
alter table invoices add column if not exists source              text not null default 'upload'
  check (source in ('upload','email'));
alter table invoices add column if not exists vendor_id           uuid references vendors(id) on delete set null;
alter table invoices add column if not exists bank_account_number text;
alter table invoices add column if not exists bank_ifsc           text;
alter table invoices add column if not exists bank_name           text;

-- content_hash = sha256 of the raw file bytes → blocks a byte-identical re-send
--   BEFORE any OCR cost is incurred.
-- dedup_hash   = sha256(normalized invoice_number + '|' + vendor GSTIN) → the
--   semantic duplicate key, set after extraction. Collision-resistant (256-bit).
alter table invoices add column if not exists content_hash        text;
alter table invoices add column if not exists dedup_hash          text;

-- Raw provider extraction payload, preserved verbatim for audit even if the
-- parsing/matching logic later changes. raw_text kept for legacy/debug.
alter table invoices add column if not exists raw_extraction      jsonb;
alter table invoices add column if not exists extraction_error    text;
alter table invoices add column if not exists extraction_provider text;

-- Expand the lifecycle. Old rows used extracted/matched/discrepancy; remap them
-- onto the new real-time status set before tightening the constraint.
alter table invoices alter column status set default 'received';

update invoices set status = 'review_required' where status = 'discrepancy';
update invoices set status = 'approved'         where status = 'matched';
update invoices set status = 'received'         where status = 'extracted';

alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check
  check (status in (
    'received','extracting','matching','review_required',
    'approved','rejected','duplicate_blocked','failed'
  ));

-- DB-level duplicate guard: even if two requests race past the application
-- check, the database refuses the second insert of the same (org, dedup_hash).
create unique index if not exists invoices_org_dedup_uniq
  on invoices (org_id, dedup_hash) where dedup_hash is not null;

-- Fast pre-OCR content-hash lookup, scoped per org.
create index if not exists invoices_org_content_idx
  on invoices (org_id, content_hash) where content_hash is not null;

-- ── Bank-change alerts (high priority, CFO) ─────────────────────
-- One row per detected bank-detail change. Persisted regardless of match
-- outcome so finance has an auditable trail; the email/notification is sent
-- synchronously by the application before any further processing.
create table if not exists bank_change_alerts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  invoice_id      uuid references invoices(id) on delete set null,
  vendor_id       uuid references vendors(id) on delete set null,
  vendor_name     text,
  old_account     text,
  new_account     text,
  old_ifsc        text,
  new_ifsc        text,
  severity        text not null default 'high' check (severity in ('high')),
  notified        boolean not null default false,  -- did the synchronous CFO alert send?
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now()
);

alter table bank_change_alerts add column if not exists org_id uuid;
create index if not exists bank_change_alerts_org_idx on bank_change_alerts (org_id, created_at desc);

alter table bank_change_alerts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'bank_change_alerts' and policyname = 'org read bank alerts') then
    create policy "org read bank alerts" on bank_change_alerts
      for select to authenticated using (org_id in (select auth_org_ids()));
  end if;
end $$;
