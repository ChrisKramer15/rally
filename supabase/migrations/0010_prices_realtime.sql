-- Enable Supabase Realtime for the prices table.
--
-- Why: the browser derives its trading "signals" from daily bars cached from
-- `public.prices`. Previously the client only re-read bars when the effective
-- trading day rolled over (see marketCalendar), so writing new bars mid-session
-- did NOT cause the UI to recompute. By publishing `prices` change events over
-- Realtime, the frontend can subscribe and force a re-read (bypassing the
-- trading-day freshness gate) the moment the collector inserts/updates rows —
-- so the analysis re-runs whenever new bars land in the database.
--
-- The `supabase_realtime` publication is created automatically by Supabase.
-- Adding a table to it streams its INSERT/UPDATE/DELETE events to subscribed
-- clients. RLS still applies to Realtime: anon already has SELECT on `prices`
-- (migration 0001), so read-only browsers can receive these events. Writes
-- remain service-role only.
--
-- Idempotent: skip the ALTER if the table is already a member of the
-- publication (re-running the migration must not error).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'prices'
  ) then
    alter publication supabase_realtime add table public.prices;
  end if;
end
$$;
