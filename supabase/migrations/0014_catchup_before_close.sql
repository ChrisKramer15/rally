-- ---------------------------------------------------------------------------
-- 0014_catchup_before_close.sql
--
-- Shift the per-watchlist SMART catch-up ladder EARLIER so that every slot runs
-- BEFORE the US regular-session close (16:00 ET), while preserving the 1-hour
-- spacing so no two loads ever share the same rolling hour (Tiingo per-hour cap).
--
-- WHY:
--   The 0009 catch-up base was 14:00 UTC with hour = 14 + (slot-1), so the top
--   slots landed at 22:00 / 23:00 UTC. In UTC->ET terms those cross the 16:01 ET
--   close cutoff:
--       EDT (UTC-4): close cutoff = 20:01 UTC  -> slots >= 20:00 UTC cross it
--       EST (UTC-5): close cutoff = 21:01 UTC  -> slots >= 21:00 UTC cross it
--   When a catch-up fires AFTER the cutoff, effectiveTradingDay() flips to the
--   session that just closed, whose finalized bar Tiingo hasn't published yet.
--   The freshness probe then sees "no symbol has today's bar" and re-pulls,
--   potentially grabbing an in-progress / partial bar. Catch-up's real job is to
--   backfill the PRIOR completed session the overnight primary may have missed —
--   not to chase a session that closed minutes ago.
--
-- FIX (this migration):
--   Move the catch-up base to 11:00 UTC with hour = 11 + (slot-1):
--       slot 1  -> 11:00 UTC (~06:00 ET EST / 07:00 ET EDT)
--       slot 10 -> 20:00 UTC (~15:00 ET EST / 16:00 ET EDT)
--   Primaries still end at 10:30 UTC (slot 10), so slot-1 catch-up at 11:00 UTC
--   keeps a 30-minute gap and one-run-per-hour spacing is preserved.
--   The companion collector change (effectiveCatchupDay) clamps the freshness
--   target away from a just-closed session, so exact cron timing is no longer
--   load-bearing for correctness — this migration is the defense-in-depth pair.
--
-- Re-runnable: redefines reschedule_watchlist_jobs() (same signature) and then
-- rebuilds all rally-wl-* jobs from the current watchlists table.
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
    primary_hour := 1 + (rec.slot - 1);    -- slot 1 -> 01:30 UTC (20:30 CT)
    catchup_hour := 11 + (rec.slot - 1);    -- slot 1 -> 11:00 UTC; slot 10 -> 20:00 UTC
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
  'Rebuilds all rally-wl-* pg_cron jobs (primary + smart catch-up) from the watchlists table by slot. Catch-up base 11:00 UTC keeps every slot before the US close while preserving 1-hour spacing. Call after list changes.';

-- Rebuild jobs now so the new catch-up times take effect immediately.
select public.reschedule_watchlist_jobs();
