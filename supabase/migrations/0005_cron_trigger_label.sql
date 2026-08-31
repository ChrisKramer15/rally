-- Re-wire the daily cron job to tag its runs as trigger = 'cron'.
--
-- Migration 0002 originally invoked the collector with an empty body, so
-- pipeline_runs recorded scheduled runs as trigger = 'unknown'. Now that the
-- collector reads a `trigger` from the request body (and the pipeline_runs log
-- exists, see 0004), pass 'cron' so scheduled runs are distinguishable from
-- manual invocations in the Data Pipeline page.
--
-- 0002 is already applied on existing projects and won't re-run, so this
-- migration redefines the helper function + reschedules the job idempotently.

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
    body    := jsonb_build_object('trigger', 'cron')
  );
end;
$$;

comment on function public.invoke_daily_collector is
  'Calls the collect-daily-bars Edge Function using Vault-stored URL + service role key. Tags runs as trigger=cron.';

-- Reschedule with the same name/cadence so the job picks up the updated helper.
select cron.unschedule('rally-daily-bars')
  where exists (select 1 from cron.job where jobname = 'rally-daily-bars');

select cron.schedule(
  'rally-daily-bars',
  '10 21 * * 1-5',
  $$ select public.invoke_daily_collector(); $$
);
