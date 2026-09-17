-- ---------------------------------------------------------------------------
-- 0021_trades_realtime
--
-- Enable Supabase Realtime for the `trades` and `closed_trades` tables.
--
-- Why: fills and exits now happen SERVER-SIDE (the settle-positions Edge
-- Function runs on a cron and mutates these tables via the service role). With
-- Realtime on, a browser that's open sees a pending order flip to open, or an
-- open position get banked into closed_trades, the moment the server writes it —
-- instead of waiting for the next manual refresh/hydrate. Mirrors the `prices`
-- Realtime setup (migration 0010).
--
-- RLS still applies to Realtime: anon already has SELECT on both tables
-- (migration 0011), so the read-only browser can receive these events. Writes
-- remain service-role (server) / anon-CRUD (manual actions) as before.
--
-- Idempotent: skip the ALTER when the table is already published.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'trades'
  ) then
    alter publication supabase_realtime add table public.trades;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'closed_trades'
  ) then
    alter publication supabase_realtime add table public.closed_trades;
  end if;
end
$$;
