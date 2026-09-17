-- ---------------------------------------------------------------------------
-- 0022_settle_positions_cron
--
-- Schedule the settle-positions Edge Function on pg_cron: every minute during
-- US market hours (weekdays), it fills pending limit orders and settles open
-- positions against live Finnhub quotes. Mirrors the collect-daily-bars cron
-- pattern (0002/0009): a Vault-stored function URL + the reused service_role
-- key, invoked via pg_net.
--
-- ── ONE-TIME manual setup (run once, NOT re-run by migrations) ──────────────
-- The function URL is stored in Vault (secrets never live in migrations). The
-- service_role_key Vault secret already exists (created for collect-daily-bars);
-- reuse it. In the SQL editor, run once:
--
--   select vault.create_secret(
--     'https://<PROJECT_REF>.supabase.co/functions/v1/settle-positions',
--     'settle_positions_url'
--   );
--
-- Also set the Finnhub server secret (CLI), so the function can quote prices:
--
--   supabase secrets set FINNHUB_KEY=your_finnhub_token
--
-- Deploy the function:
--
--   supabase functions deploy settle-positions
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- Helper: invoke settle-positions using the Vault-stored URL + service role key.
create or replace function public.invoke_settle_positions()
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
    from vault.decrypted_secrets where name = 'settle_positions_url';
  select decrypted_secret into sr_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if fn_url is null or sr_key is null then
    raise exception 'Vault secrets settle_positions_url / service_role_key are not set';
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

comment on function public.invoke_settle_positions is
  'Calls the settle-positions Edge Function using Vault-stored URL + service role key.';

-- ---------------------------------------------------------------------------
-- Schedule: every minute, 13:00–21:59 UTC, Mon–Fri.
--   US regular session is 09:30–16:00 ET = 13:30–20:00 UTC (EDT) or
--   14:30–21:00 UTC (EST). The 13–21 UTC window covers the session in BOTH DST
--   states with margin; the Edge Function itself re-checks isRegularSessionOpen
--   and no-ops outside 09:30–16:00 ET, so the extra edge minutes are harmless
--   (they just log a "market closed" no-op run).
-- pg_cron runs in UTC. Re-running this migration replaces the same-named job.
-- ---------------------------------------------------------------------------
select cron.unschedule('rally-settle-positions')
  where exists (select 1 from cron.job where jobname = 'rally-settle-positions');

select cron.schedule(
  'rally-settle-positions',
  '* 13-21 * * 1-5',
  $$ select public.invoke_settle_positions(); $$
);
