-- Krayam — background worker for invoice processing (Feature 12).
--
-- The upload / email routes kick off processing fire-and-forget, but a
-- serverless cold-stop can kill a run mid-flight, leaving an invoice stuck in
-- received / extracting / matching. This adds the bookkeeping + a pg_cron tick
-- (same pattern as 0012/0014/0017) that re-picks stuck invoices, bounded by an
-- attempt budget so a permanently-bad file does not loop forever.

alter table invoices add column if not exists process_attempts int not null default 0;
alter table invoices add column if not exists last_attempt_at   timestamptz;

-- Find invoices that look abandoned: still in a non-terminal status and either
-- never stamped (initial fire never ran) or last touched a while ago.
create index if not exists invoices_stuck_idx
  on invoices (status, last_attempt_at)
  where status in ('received','extracting','matching');

-- ── pg_cron tick → POST /api/cron/process-invoices ──
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function krayam_process_invoices()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'krayam_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'krayam_cron_secret';
  if v_url is null or v_secret is null then
    raise notice 'krayam_process_invoices: vault secrets not set; skipping';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/api/cron/process-invoices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 290000
  );
end;
$$;

select cron.unschedule('krayam-process-invoices')
  where exists (select 1 from cron.job where jobname = 'krayam-process-invoices');

select cron.schedule('krayam-process-invoices', '*/2 * * * *', $$ select krayam_process_invoices(); $$);
