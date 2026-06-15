-- Krayam — background SAP sync worker via pg_cron + pg_net.
--
-- pg_cron runs SQL inside Postgres; the SAP push is application logic (CSRF +
-- OData + Resend) living in the Next.js app. So the cron job doesn't *do* the
-- sync — it HTTP-POSTs the protected drain endpoint (/api/cron/sync-pos) with
-- pg_net, and the app retries every PO stuck without a SAP PO number.
--
-- The app URL and the CRON_SECRET are environment-specific and secret, so they
-- live in Supabase Vault — never hardcoded in this migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─────────────────────────────────────────────────────────────────────────
-- ONE-TIME SETUP SCRIPT (run once per environment in the Supabase SQL editor)
-- Not run by this migration — these are secret, deployment-specific values.
-- Uncomment, fill in your own values, and execute:
--
--   -- 1. App base URL (no trailing slash) and the CRON_SECRET from your app env.
--   select vault.create_secret('https://app.krayam.example', 'krayam_app_url');
--   select vault.create_secret('paste-the-same-CRON_SECRET-here', 'krayam_cron_secret');
--
--   -- 2. Verify they are stored:
--   select name from vault.secrets where name in ('krayam_app_url', 'krayam_cron_secret');
--
--   -- 3. (Optional) fire the worker once to confirm wiring before waiting 5 min:
--   select krayam_sync_pos();
--   select * from net._http_response order by created desc limit 1;
--
--   -- To ROTATE a value later (look up the id, then update):
--   select id, name from vault.secrets where name = 'krayam_cron_secret';
--   select vault.update_secret('<id-from-above>', 'new-secret-value');
-- ─────────────────────────────────────────────────────────────────────────

-- ── The worker function: read secrets from Vault, fire the HTTP request ──
create or replace function krayam_sync_pos()
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
    raise notice 'krayam_sync_pos: vault secrets not set; skipping';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/api/cron/sync-pos',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body      := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

-- ── Schedule: every 5 minutes. Idempotent re-create on re-run. ──
select cron.unschedule('krayam-sync-pos')
  where exists (select 1 from cron.job where jobname = 'krayam-sync-pos');

select cron.schedule('krayam-sync-pos', '*/5 * * * *', $$ select krayam_sync_pos(); $$);

-- Inspect runs:   select * from cron.job_run_details where jobid =
--                   (select jobid from cron.job where jobname = 'krayam-sync-pos')
--                   order by start_time desc limit 20;
-- HTTP responses: select * from net._http_response order by created desc limit 20;
