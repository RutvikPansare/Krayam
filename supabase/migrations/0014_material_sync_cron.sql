-- Krayam — nightly material master sync via pg_cron + pg_net.
--
-- Same pattern as the PO sync worker (0012): pg_cron can't run the app's SAP
-- pull + embedding logic, so it HTTP-POSTs the protected endpoint and the app
-- does the work. Reuses the Vault secrets created for 0012 (krayam_app_url,
-- krayam_cron_secret) — no new setup if 0012 is already configured.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function krayam_sync_materials()
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
    raise notice 'krayam_sync_materials: vault secrets not set; skipping';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/api/cron/sync-materials',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body      := '{}'::jsonb,
    timeout_milliseconds := 290000
  );
end;
$$;

-- Nightly at 02:30 (server TZ). Idempotent re-create.
select cron.unschedule('krayam-sync-materials')
  where exists (select 1 from cron.job where jobname = 'krayam-sync-materials');

select cron.schedule('krayam-sync-materials', '30 2 * * *', $$ select krayam_sync_materials(); $$);

-- Manual one-off after setup:  select krayam_sync_materials();
-- Inspect cursor/health:       select * from material_sync_state;
