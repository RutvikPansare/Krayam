-- Krayam — Feature 09: stock-check savings log (append-only audit trail).
--
-- One row per intercepted PO line: whether the officer accepted the stock
-- (reduced/cancelled the order) or overrode and ordered anyway, the rupee
-- value saved or put at risk (in paise), and — for overrides — the fixed
-- reason. Append-only: no UPDATE/DELETE policy exists.

create table if not exists savings_log (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade default krayam_default_org(),
  po_id                 uuid references purchase_orders(id) on delete set null,
  quote_id              uuid references quotes(id) on delete set null,  -- idempotency key for the no-PO (full cancellation) path
  material_code         text,
  item_name             text,
  po_value_paise        bigint not null default 0,   -- unit_price × ordered qty (paise)
  stock_qty_found       numeric not null default 0,
  -- accepted: order reduced/cancelled → money saved.
  -- overridden: ordered despite stock → money at risk.
  action                text not null check (action in ('accepted','overridden')),
  estimated_saving_paise bigint not null default 0,  -- accepted ⇒ saved; overridden ⇒ at-risk
  override_reason       text check (override_reason in (
                          'urgent_requirement','quality_reserved','wrong_location',
                          'committed_elsewhere','stock_data_unreliable','other')),
  officer               text,                          -- who accepted/overrode
  created_at            timestamptz not null default now()
);

create index if not exists savings_log_org_idx on savings_log (org_id, created_at desc);
-- Idempotency for the no-PO (full cancellation) path: one row per
-- (quote, material). A resubmit conflicts and is rejected, so savings are
-- never double-counted; distinct materials in the same cancellation still fit.
create unique index if not exists savings_log_quote_mat_uniq
  on savings_log (quote_id, material_code) where po_id is null;

alter table savings_log enable row level security;
-- Read-only to org members; writes happen via the service role. No update/delete
-- policy ⇒ append-only even for the service role's RLS-exempt path is the intent
-- (enforced in app code; the table is never updated/deleted from anywhere).
create policy "savings_log_org" on savings_log for select to authenticated
  using (org_id in (select auth_org_ids()));
