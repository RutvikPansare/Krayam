-- Krayam — Feature 06 hardening: paise-integer money, PO saga state,
-- idempotency, stored PDFs, and customer-configurable PO numbering + terms.

-- ── Money in paise (integer, exact) ──────────────────────────────
-- The numeric rupee columns stay for backward-compatible display reads,
-- but the *_paise bigint columns are the source of truth: all arithmetic
-- happens in integer paise, so no floating-point drift can accumulate.
alter table po_items        add column if not exists unit_price_paise bigint;
alter table po_items        add column if not exists line_total_paise bigint;
alter table purchase_orders add column if not exists total_paise      bigint;

-- ── Saga state — each step is persisted so partial completion is
--    detectable and a manual sync can resume from where it failed. ─
alter table purchase_orders add column if not exists pdf_path           text;
alter table purchase_orders add column if not exists pdf_url            text;
alter table purchase_orders add column if not exists pdf_generated_at   timestamptz;
alter table purchase_orders add column if not exists vendor_notified_at timestamptz;
alter table purchase_orders add column if not exists sap_synced_at      timestamptz;
alter table purchase_orders add column if not exists sap_raw            jsonb;   -- full SAP response body on failure/success
alter table purchase_orders add column if not exists sap_attempts       integer not null default 0;

-- Expand the status machine: draft → pdf_ready → vendor_notified →
-- (sent_to_sap | sap_sync_failed). 'cancelled' retained.
alter table purchase_orders drop constraint if exists purchase_orders_status_check;
alter table purchase_orders add  constraint purchase_orders_status_check
  check (status in (
    'draft','pdf_ready','vendor_notified','sent_to_sap','sap_sync_failed',
    'created','sap_pushed','sent','cancelled'   -- legacy values kept for old rows
  ));
alter table purchase_orders alter column status set default 'draft';

-- ── Idempotency — one PO per winning quote. A second "select winner"
--    click hits this unique violation and the route returns the
--    existing PO instead of creating a duplicate. ─────────────────
create unique index if not exists purchase_orders_quote_unique
  on purchase_orders (quote_id) where quote_id is not null;

-- Vendor postal address — printed in the PO's TO block.
alter table vendors add column if not exists address text;

-- ── Customer-configurable PO numbering + standard terms (onboarding) ─
alter table company_settings add column if not exists po_prefix        text not null default 'PO-';
alter table company_settings add column if not exists delivery_address text;
alter table company_settings add column if not exists standard_terms   text;

-- App-side PO number generation honouring the customer's configured prefix.
-- Returns e.g. 'BMI/PO/00042' from the shared counter; the prefix is whatever
-- was set during onboarding.
create or replace function next_po_number(p_prefix text)
returns text language sql as $$
  select coalesce(p_prefix, 'PO-') || lpad(nextval('po_number_seq')::text, 5, '0');
$$;

-- ── Private bucket for generated PO PDFs (stored once, re-sent without
--    regeneration). ───────────────────────────────────────────────
insert into storage.buckets (id, name, public) values
  ('po-pdfs', 'po-pdfs', false)
on conflict (id) do nothing;
