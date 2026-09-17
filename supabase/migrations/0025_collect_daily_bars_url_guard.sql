-- 0025_collect_daily_bars_url_guard
--
-- Harden invoke_watchlist_collector() so a MISCONFIGURED function URL fails
-- LOUDLY and actionably instead of silently on every scheduled collector run.
--
-- This is the collector-side twin of the guard 0023 added to
-- invoke_settle_positions(). Same footgun, different secret:
--
-- BACKGROUND (the bug this prevents): 0009 stores the collector's function URL
-- in Vault (`collect_daily_bars_url`). If that secret is ever created/updated
-- with the example placeholder still in it
-- ('https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/collect-daily-bars'),
-- the <YOUR_PROJECT_REF> token is not a valid hostname. pg_net's net.http_post
-- then throws "invalid URL ...: Bad hostname" — but that error is buried inside
-- cron.job_run_details, NOT surfaced anywhere the app can see. Worse for the
-- collector than for the settler: because the POST never reaches the Edge
-- Function, NO pipeline_runs row is written at all, so the Data Pipeline page
-- just shows "no recent run" with no clue why. Every rally-wl-*-primary /
-- rally-wl-*-catchup job would fail this silent way.
--
-- The guards added here mirror 0023 exactly:
--   1) missing secret                                   -> raise (as in 0009)
--   2) URL still has a '<' / '>' placeholder, or isn't  -> raise with a message
--      https://                                            that says EXACTLY what
--                                                           to fix and how.
-- A raised exception still lands in cron.job_run_details, but the message is now
-- self-explanatory instead of a generic hostname error.
--
-- Everything else about the function is UNCHANGED from 0009: same signature
-- (p_watchlist_id uuid, p_mode text default 'primary'), same POST body
-- ({ trigger:'cron', mode, watchlistId }), same secrets.
--
-- Idempotent: pure CREATE OR REPLACE of the function; safe to re-run.
-- ---------------------------------------------------------------------------

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

  -- Guard against the classic misconfiguration: the URL was stored with the
  -- example placeholder still in it (or is otherwise not a real https URL). Bail
  -- with an actionable message rather than letting net.http_post fail every
  -- scheduled run with an opaque "Bad hostname" that never reaches pipeline_runs.
  if fn_url like '%<%' or fn_url like '%>%' or fn_url not like 'https://%' then
    raise exception
      'collect_daily_bars_url is not a real function URL (got %). '
      'Replace the <YOUR_PROJECT_REF> placeholder with your project ref, e.g. '
      'select vault.update_secret((select id from vault.secrets where name = '
      '''collect_daily_bars_url''), ''https://YOUR_REF.supabase.co/functions/v1/collect-daily-bars'');',
      fn_url;
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
  'Calls collect-daily-bars for one watchlist + mode (primary|catchup), passing watchlistId in the body. Raises an actionable error if collect_daily_bars_url is missing or still contains a placeholder (guards the 0009 setup footgun; mirrors 0023 for the settler).';
