-- Quote form + comparison upgrades: vendor-facing fields, officer notes,
-- winner tracking, realtime.

alter table quotes add column if not exists delivery_terms text;       -- e.g. "FOR destination, freight included"
alter table quotes add column if not exists validity_days integer;     -- quote valid for N days
alter table quotes add column if not exists internal_note text;        -- purchase officer's private note
alter table quotes add column if not exists is_winner boolean not null default false;

alter table quote_items add column if not exists available_qty numeric; -- vendor's available quantity

-- Officer edits internal notes from the dashboard (authenticated)
create policy "auth update quote notes" on quotes for update to authenticated
  using (true) with check (true);

-- Realtime: comparison table subscribes to quote inserts/updates
do $$
begin
  alter publication supabase_realtime add table quotes;
exception when duplicate_object then null;
end $$;
