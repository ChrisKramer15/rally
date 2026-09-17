-- ---------------------------------------------------------------------------
-- 0027_settle_positions_url_guard
--
-- (Renumbered from 0023 — it originally shared version 0023 with
-- trades_position_limits, which broke `supabase db push`. Only one 0023 was
-- ever recorded in schema_migrations, and this guard's SQL had never actually
-- been applied to the remote DB. Renumbered to 0027 and applied so history and
-- reality match.)
--
-- Harden invoke_settle_positions() so a MISCONFIGURED function URL fails LOUDLY
-- and actionably instead of silently every minute.
--
-- BACKGROUND (the bug this prevents): the one-time setup for 0022 stores the
-- function URL in Vault (`settle_positions_url`). If that secret is created with
-- the example value copied verbatim from the 0022 comment
-- ('https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/settle-positions'), the
-- placeholder <YOUR_PROJECT_REF> is not a valid hostname. pg_net's net.http_post
-- then throws "invalid URL ...: Bad hostname" — but that error is buried inside
-- cron.job_run_details, NOT surfaced anywhere the app can see. The result was a
-- live paper-trading engine that quietly did nothing for an entire session:
-- pending limit orders never filled, open positions never settled, and the only
-- symptom was "my order hit the limit but never went active."
--
-- This migration adds two cheap guards to the helper so the same mistake can't
-- silently recur:
--   1) missing secret            -> raise (unchanged from 0022)
--   2) URL still has a '<' / '>' placeholder, or isn't https://  -> raise with a
--      message that tells the operator EXACTLY what to fix and how.
-- A raised exception still lands in cron.job_run_details, but now the message is
-- self-explanatory ("replace the <YOUR_PROJECT_REF> placeholder ...") instead of
-- a generic hostname error, so the fix is obvious on first read.
--
-- Idempotent: pure CREATE OR REPLACE of the function; safe to re-run.
-- ---------------------------------------------------------------------------

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
    raise exception
      'Vault secrets settle_positions_url / service_role_key are not set. '
      'Create them once (see migration 0022 header) before the cron can run.';
  end if;

  -- Guard against the classic misconfiguration: the URL was stored with the
  -- example placeholder still in it (or is otherwise not a real https URL). Bail
  -- with an actionable message rather than letting net.http_post fail every
  -- minute with an opaque "Bad hostname".
  if fn_url like '%<%' or fn_url like '%>%' or fn_url not like 'https://%' then
    raise exception
      'settle_positions_url is not a real function URL (got %). '
      'Replace the <YOUR_PROJECT_REF> placeholder with your project ref, e.g. '
      'select vault.update_secret((select id from vault.secrets where name = '
      '''settle_positions_url''), ''https://YOUR_REF.supabase.co/functions/v1/settle-positions'');',
      fn_url;
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
  'Calls the settle-positions Edge Function using Vault-stored URL + service role key. Raises an actionable error if the URL is missing or still contains a placeholder (guards the 0022 setup footgun).';
