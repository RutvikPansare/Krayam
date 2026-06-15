-- Krayam — background worker for the dedup audit job (Feature 08).
-- Same pg_cron + pg_net pattern as 0012/0014; reuses the Vault secrets
-- (krayam_app_url, krayam_cron_secret). Runs every 2 minutes to advance and
-- resume any active audit run, and to clean up runs that have timed out.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function krayam_run_audits()
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
    raise notice 'krayam_run_audits: vault secrets not set; skipping';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/api/cron/run-audits',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 290000
  );
end;
$$;

select cron.unschedule('krayam-run-audits')
  where exists (select 1 from cron.job where jobname = 'krayam-run-audits');

select cron.schedule('krayam-run-audits', '*/2 * * * *', $$ select krayam_run_audits(); $$);
