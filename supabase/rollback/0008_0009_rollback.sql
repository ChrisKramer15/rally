-- ---------------------------------------------------------------------------
-- ROLLBACK for 0008_multi_watchlist.sql + 0009_per_watchlist_cron.sql
--
-- Run this MANUALLY only if you need to back out the multi-watchlist change.
-- It is intentionally NOT numbered into the migrations sequence, so
-- `supabase db push` will not pick it up automatically.
--
-- What it restores:
--   * Removes all per-watchlist cron jobs (rally-wl-*) and the helper/trigger
--     functions added in 0009, then recreates the original single universe-wide
--     jobs from 0006 (rally-daily-bars + rally-daily-bars-catchup).
--   * Drops the watchlist-attribution + stage columns added to pipeline_runs.
--   * Drops the watchlist_id column from `watchlist` and the `watchlists` table.
--
-- IMPORTANT — data preservation:
--   * `prices` is never touched by any of this, so ALL bar history is retained.
--   * Your symbol rows in `watchlist` are retained (only the watchlist_id link
--     is dropped). After rollback, the collector again treats every active row
--     as one flat universe — exactly the pre-0008 behaviour.
--   * If you created extra lists, their symbols remain as active rows and will
--     all be collected together by the restored single job. Deactivate any you
--     don't want before/after rolling back.
--
-- Re-runnable / idempotent where practical.
-- ---------------------------------------------------------------------------

begin;

-- 1) Stop cron from being rebuilt by the sync trigger, then remove per-list jobs.
drop trigger if exists watchlists_sync_cron on public.watchlists;

do $$
declare
  job record;
begin
  for job in select jobname from cron.job where jobname like 'rally-wl-%' loop
    perform cron.unschedule(job.jobname);
  end loop;
end;
$$;

-- 2) Drop the 0009 functions.
drop function if exists public.watchlists_after_change() cascade;
drop function if exists public.reschedule_watchlist_jobs() cascade;
drop function if exists public.invoke_watchlist_collector(uuid, text) cascade;

-- 3) Recreate the original single universe-wide jobs (as of 0006).
--    Uses the still-present invoke_daily_collector() helper from 0005.
select cron.unschedule('rally-daily-bars')
  where exists (select 1 from cron.job where jobname = 'rally-daily-bars');
select cron.schedule(
  'rally-daily-bars',
  '30 1 * * 2-6',
  $$ select public.invoke_daily_collector(); $$
);

select cron.unschedule('rally-daily-bars-catchup')
  where exists (select 1 from cron.job where jobname = 'rally-daily-bars-catchup');
select cron.schedule(
  'rally-daily-bars-catchup',
  '0 14 * * 2-6',
  $$ select public.invoke_daily_collector(); $$
);

-- 4) Drop the pipeline_runs columns added in 0008.
alter table public.pipeline_runs
  drop column if exists watchlist_id,
  drop column if exists watchlist_name,
  drop column if exists mode,
  drop column if exists symbols_skipped,
  drop column if exists stages;

-- 5) Drop the watchlist link + the watchlists table.
drop index if exists public.watchlist_list_idx;
alter table public.watchlist drop column if exists watchlist_id;

drop trigger if exists watchlists_cap on public.watchlists;
drop function if exists public.enforce_watchlist_cap() cascade;
drop table if exists public.watchlists cascade;

-- 6) Remove the anon delete policy added for list deletion in 0008.
drop policy if exists watchlist_client_delete on public.watchlist;

commit;

-- NOTE: after rolling back the DB, redeploy the PREVIOUS version of the
-- collect-daily-bars Edge Function (the one that reads the whole active
-- watchlist and ignores watchlistId), or the current version will still work
-- but simply fall back to the whole-universe path when no watchlistId is sent.
