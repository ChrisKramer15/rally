-- Schedule the daily-bar collector via pg_cron + pg_net.
--
-- This calls the `collect-daily-bars` Edge Function once per weekday evening,
-- after the US close. pg_cron runs inside the database, so it fires whether or
-- not any browser/laptop is open — which is the whole point of moving the
-- collector server-side.
--
-- SECRETS: the Edge Function is invoked with the project's service-role key in
-- the Authorization header. We DON'T hardcode it here; instead read it (and the
-- function URL) from Supabase Vault. Populate the Vault entries once (see the
-- "one-time setup" block below), then this migration wires the schedule.

-- Required extensions (available on Supabase; safe to re-run).
create extension if not exists pg_cron  with schema pg_catalog;
create extension if not exists pg_net   with schema extensions;

-- ---------------------------------------------------------------------------
-- ONE-TIME SETUP (run these once per project, replacing the placeholder values;
-- kept as comments so this migration stays non-secret and re-runnable):
--
--   -- The full Edge Function URL:
--   select vault.create_secret(
--     'https://YOUR_PROJECT_REF.supabase.co/functions/v1/collect-daily-bars',
--     'collect_daily_bars_url'
--   );
--
--   -- The project service-role key (Project Settings -> API):
--   select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
--
-- To ROTATE later, use vault.update_secret(...) with the secret's id.
-- ---------------------------------------------------------------------------

-- Helper: invoke the collector using the Vault-stored URL + key.
create or replace function public.invoke_daily_collector()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  fn_url  text;
  sr_key  text;
begin
  select decrypted_secret into fn_url
    from vault.decrypted_secrets where name = 'collect_daily_bars_url';
  select decrypted_secret into sr_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if fn_url is null or sr_key is null then
    raise exception 'Vault secrets collect_daily_bars_url / service_role_key are not set';
  end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || sr_key
    ),
    body    := '{}'::jsonb
  );
end;
$$;

comment on function public.invoke_daily_collector is
  'Calls the collect-daily-bars Edge Function using Vault-stored URL + service role key.';

-- ---------------------------------------------------------------------------
-- Schedule: Monday–Friday at 21:10 UTC.
--   Regular US close is 16:00 ET (20:00 UTC during EDT, 21:00 UTC during EST).
--   21:10 UTC is safely after the close in BOTH DST states and after Tiingo's
--   EOD data is typically available (~5:30 PM ET). pg_cron uses UTC.
-- Re-running this migration replaces the job of the same name.
-- ---------------------------------------------------------------------------
select cron.unschedule('rally-daily-bars')
  where exists (select 1 from cron.job where jobname = 'rally-daily-bars');

select cron.schedule(
  'rally-daily-bars',
  '10 21 * * 1-5',
  $$ select public.invoke_daily_collector(); $$
);
