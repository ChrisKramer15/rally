-- Move the daily-bar collector to run AFTER Tiingo finalizes the session's EOD
-- adjusted bar, and add a next-morning catch-up run.
--
-- WHY:
--   The original schedule (10 21 * * 1-5 = 17:10 ET) fired only ~70 minutes
--   after the 16:00 ET close. Tiingo's finalized end-of-day *adjusted* daily bar
--   for that same session is frequently not published that early, so the run
--   pulled data only through the PRIOR trading day and logged "success" with the
--   current session's bar missing entirely (e.g. no 2026-09-01 row despite a
--   successful 2026-09-01 run). It effectively lagged one session behind.
--
-- FIX:
--   1. Primary run in the evening ET, well after Tiingo's EOD publish.
--   2. A next-morning catch-up run as a safety net for evenings when Tiingo is
--      slow. Upserts are idempotent (PK symbol,date), so a redundant run is a
--      no-op cost-wise beyond a re-pull of the lookback window.
--
-- pg_cron uses UTC. US market days are Mon-Fri ET; the evening/next-morning UTC
-- times therefore land on the FOLLOWING UTC weekday, so the day-of-week fields
-- below are Tue-Sat (2-6) to line up with Mon-Fri ET sessions.

-- ---------------------------------------------------------------------------
-- Primary run: ~20:30 ET.
--   EDT (UTC-4): 20:30 ET -> 00:30 UTC (next day)
--   EST (UTC-5): 20:30 ET -> 01:30 UTC (next day)
--   Using 01:30 UTC guarantees it is >= 20:30 ET year-round (never earlier than
--   the intended evening slot), giving Tiingo ample time to finalize the bar.
-- Replaces the old 'rally-daily-bars' job of the same name.
-- ---------------------------------------------------------------------------
select cron.unschedule('rally-daily-bars')
  where exists (select 1 from cron.job where jobname = 'rally-daily-bars');

select cron.schedule(
  'rally-daily-bars',
  '30 1 * * 2-6',
  $$ select public.invoke_daily_collector(); $$
);

-- ---------------------------------------------------------------------------
-- Catch-up run: ~09:00 ET the next morning.
--   EDT (UTC-4): 09:00 ET -> 13:00 UTC
--   EST (UTC-5): 09:00 ET -> 14:00 UTC
--   Using 14:00 UTC guarantees it is >= 09:00 ET year-round. This backfills the
--   prior session if the evening run predated Tiingo's publish. Idempotent.
-- ---------------------------------------------------------------------------
select cron.unschedule('rally-daily-bars-catchup')
  where exists (select 1 from cron.job where jobname = 'rally-daily-bars-catchup');

select cron.schedule(
  'rally-daily-bars-catchup',
  '0 14 * * 2-6',
  $$ select public.invoke_daily_collector(); $$
);
