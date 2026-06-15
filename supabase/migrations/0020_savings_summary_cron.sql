-- Krayam — monthly CFO stock-savings email (Feature 09).
-- pg_cron + pg_net, reusing the Vault secrets from 0012. Fires at 07:00 on the
-- 1st of each month; the app aggregates the previous month's savings_log.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function krayam_savings_summary()
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'krayam_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'krayam_cron_secret';
  if v_url is null or v_secret is null then
    raise notice 'krayam_savings_summary: vault secrets not set; skipping';
    return;
  end if;
  perform net.http_post(
    url     := v_url || '/api/cron/savings-summary',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 110000
  );
end;
$$;

select cron.unschedule('krayam-savings-summary')
  where exists (select 1 from cron.job where jobname = 'krayam-savings-summary');

select cron.schedule('krayam-savings-summary', '0 7 1 * *', $$ select krayam_savings_summary(); $$);
