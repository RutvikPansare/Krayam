-- RFQ engine upgrade: per-vendor delivery tracking, send log, 48h deadlines.

-- Per-vendor response lifecycle. 'sent' → 'delivered'/'opened' (Resend
-- webhooks) → 'quote_received' (vendor submits) or 'no_response' (48h close).
alter table rfq_vendors add column if not exists status text not null default 'sent'
  check (status in ('sent','delivered','opened','quote_received','no_response','failed'));
alter table rfq_vendors add column if not exists reminded_at timestamptz;
alter table rfq_vendors add column if not exists delivered_at timestamptz;
alter table rfq_vendors add column if not exists opened_at timestamptz;

-- Precise 48h deadline (rfqs.due_date is a date — keeps the vendor-facing
-- "quotes due by" display, but closing logic needs the timestamp).
alter table rfqs add column if not exists due_at timestamptz;

-- Every email touch on an RFQ: sends, reminders, failures, webhook events.
create table if not exists rfq_log (
  id              uuid primary key default gen_random_uuid(),
  rfq_id          uuid references rfqs(id) on delete cascade,
  rfq_vendor_id   uuid references rfq_vendors(id) on delete cascade,
  vendor_id       uuid,
  event           text not null,      -- 'sent','send_failed','reminder_sent','delivered','opened','quote_received','closed_no_response','no_vendors'
  provider_message_id text,           -- Resend email id, matched by webhooks
  detail          jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists rfq_log_rfq on rfq_log (rfq_id, created_at);
create index if not exists rfq_log_msg on rfq_log (provider_message_id);

alter table rfq_log enable row level security;
create policy "auth read rfq log" on rfq_log for select to authenticated using (true);
