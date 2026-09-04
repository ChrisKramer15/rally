-- ---------------------------------------------------------------------------
-- 0009_per_watchlist_cron.sql
--
-- Per-watchlist, staggered nightly collection with a SMART catch-up.
--
-- Schedule model (UTC, matching the existing convention in 0006):
--   The original Main job runs at 01:30 UTC (= 20:30 CT during CDT). Each
--   additional slot collects one hour later:
--       slot N primary  -> hour (1 + (N-1)) at minute 30, days Tue-Sat UTC
--       slot 1 = 01:30, slot 2 = 02:30, ... slot 10 = 10:30 UTC.
--   Each list also gets a staggered smart catch-up the next morning, one hour
--   apart starting at 14:00 UTC (~09:00 ET):
--       slot N catchup  -> hour (14 + (N-1)) at minute 00, days Tue-Sat UTC.
--   The catch-up is "smart" server-side: the collector skips any symbol whose
--   latest stored bar is already today, so on a normal day it pulls ~nothing.
--
-- Invocation reuses the Vault-stored URL + service-role key pattern from 0005,
-- but now passes the watchlist id + mode in the POST body so the collector can
-- scope the universe and attribute the run.
-- ---------------------------------------------------------------------------

-- Parameterized helper: invoke the collector for a single watchlist + mode.
create or replace function public.invoke_watchlist_collector(
  p_watchlist_id uuid,
  p_mode text default 'primary'
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  fn_url text;
  sr_key text;
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
    body    := jsonb_build_object(
      'trigger',     'cron',
      'mode',        p_mode,
      'watchlistId', p_watchlist_id
    )
  );
end;
$$;

comment on function public.invoke_watchlist_collector is
  'Calls collect-daily-bars for one watchlist + mode (primary|catchup), passing watchlistId in the body.';

-- ---------------------------------------------------------------------------
-- Reschedule ALL per-watchlist jobs from the current `watchlists` table.
-- Idempotent: unschedules any stale rally-wl-* jobs first, then (re)creates a
-- primary + catch-up job per active list based on its slot. Call this whenever
-- lists are added / removed / re-slotted.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_watchlist_jobs()
returns void
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
declare
  rec       record;
  job       record;
  primary_name text;
  catchup_name text;
  primary_hour integer;
  catchup_hour integer;
begin
  -- 1) Tear down every existing per-watchlist job (prefix rally-wl-). We rebuild
  --    from scratch so removed/renamed lists don't leave orphan jobs.
  for job in
    select jobname from cron.job where jobname like 'rally-wl-%'
  loop
    perform cron.unschedule(job.jobname);
  end loop;

  -- 2) Recreate a primary + catch-up job per active list, keyed by slot.
  for rec in
    select id, slot from public.watchlists where active order by slot
  loop
    primary_hour := 1 + (rec.slot - 1);   -- slot 1 -> 01:30 UTC (20:30 CT)
    catchup_hour := 14 + (rec.slot - 1);   -- slot 1 -> 14:00 UTC (~09:00 ET)
    primary_name := 'rally-wl-' || rec.slot || '-primary';
    catchup_name := 'rally-wl-' || rec.slot || '-catchup';

    perform cron.schedule(
      primary_name,
      format('30 %s * * 2-6', primary_hour),
      format(
        $cmd$ select public.invoke_watchlist_collector('%s'::uuid, 'primary'); $cmd$,
        rec.id
      )
    );

    perform cron.schedule(
      catchup_name,
      format('0 %s * * 2-6', catchup_hour),
      format(
        $cmd$ select public.invoke_watchlist_collector('%s'::uuid, 'catchup'); $cmd$,
        rec.id
      )
    );
  end loop;
end;
$$;

comment on function public.reschedule_watchlist_jobs is
  'Rebuilds all rally-wl-* pg_cron jobs (primary + smart catch-up) from the watchlists table by slot. Call after list changes.';

-- ---------------------------------------------------------------------------
-- Retire the old universe-wide jobs (0006) now that collection is per-list.
-- Main (slot 1) is covered by rally-wl-1-primary at the same 01:30 UTC time.
-- ---------------------------------------------------------------------------
select cron.unschedule('rally-daily-bars')
  where exists (select 1 from cron.job where jobname = 'rally-daily-bars');
select cron.unschedule('rally-daily-bars-catchup')
  where exists (select 1 from cron.job where jobname = 'rally-daily-bars-catchup');

-- ---------------------------------------------------------------------------
-- Keep cron in sync automatically: any change to `watchlists` reschedules jobs.
-- (Cheap: the table has at most 10 rows and changes are rare/manual.)
-- ---------------------------------------------------------------------------
create or replace function public.watchlists_after_change()
returns trigger
language plpgsql
security definer
set search_path = public, cron, extensions
as $$
begin
  perform public.reschedule_watchlist_jobs();
  return null;
end;
$$;

drop trigger if exists watchlists_sync_cron on public.watchlists;
create trigger watchlists_sync_cron
  after insert or update or delete on public.watchlists
  for each statement execute function public.watchlists_after_change();

-- Build the initial set of jobs from whatever lists exist right now (Main).
select public.reschedule_watchlist_jobs();
