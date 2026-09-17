-- ---------------------------------------------------------------------------
-- 0024_intraday_quotes.sql
--
-- Stores the near-real-time Finnhub quotes the settle-positions Edge Function
-- already pulls every minute during market hours. Until now those quotes were
-- used only in-memory to decide fills/settles and then discarded. Since we're
-- already spending the Finnhub free-tier budget to fetch them, we persist them
-- so:
--   * the browser can read live-ish prices from THIS table instead of calling
--     Finnhub directly (freeing the whole 60/min budget for the settler), and
--   * we accumulate an intraday price history for the symbols we actively trade.
--
-- Coverage: only symbols that have a pending/open row in `trades` at the moment
-- of a settle run. A closed position stops getting new rows; a newly-placed
-- pending order starts getting them the next minute. This is intentional
-- (Option A) — it captures exactly the quotes we're already fetching, at no
-- extra API cost.
--
-- Access model (mirrors prices):
--   * The Edge Function (service_role) BYPASSES RLS and WRITES rows.
--   * The browser (anon + authenticated) gets READ-ONLY access, so it can show
--     live prices without a Finnhub call. No client writes.
--
-- Retention: intraday rows accumulate fast (one per active symbol per minute of
-- market hours). The settler best-effort prunes rows older than the retention
-- window on each run, so the table stays bounded without a separate cron.
-- ---------------------------------------------------------------------------

create table if not exists public.intraday_quotes (
  symbol       text        not null,
  -- When the settler fetched this quote (server clock). Together with symbol
  -- this is the natural key: at most one row per symbol per settle run.
  quoted_at    timestamptz not null default now(),
  -- Last/current price from Finnhub (`c`).
  price        numeric(18, 4) not null,
  -- Prior session close from Finnhub (`pc`), for intraday % change. Nullable
  -- when the provider didn't supply one.
  prev_close   numeric(18, 4),
  -- Provider's own quote timestamp (`t`, unix seconds) — lets us tell a genuinely
  -- fresh tick from a stale one the provider re-served. Nullable.
  provider_ts  timestamptz,
  constraint intraday_quotes_pkey primary key (symbol, quoted_at)
);

comment on table public.intraday_quotes is
  'Near-real-time Finnhub quotes captured by settle-positions each minute for actively-traded (pending/open) symbols. Written only by the settler (service role); anon has read-only access so the browser reads live prices here instead of calling Finnhub directly.';

-- The browser reads "latest quote per symbol" and we prune by age, both of which
-- filter/scan on quoted_at, so index it descending within each symbol.
create index if not exists intraday_quotes_symbol_quoted_desc_idx
  on public.intraday_quotes (symbol, quoted_at desc);

-- Age-based prune scans purely on quoted_at.
create index if not exists intraday_quotes_quoted_desc_idx
  on public.intraday_quotes (quoted_at desc);

alter table public.intraday_quotes enable row level security;

-- Public read access to live quotes (safe: it's just market data, same as
-- prices). This is what lets the static frontend read live prices without a
-- Finnhub token/CORS call.
drop policy if exists intraday_quotes_public_read on public.intraday_quotes;
create policy intraday_quotes_public_read
  on public.intraday_quotes
  for select
  to anon, authenticated
  using (true);

-- NOTE: deliberately NO insert/update/delete policies for anon/authenticated.
-- All writes go through the settle-positions Edge Function (service_role, which
-- bypasses RLS).

-- ---------------------------------------------------------------------------
-- Enable Supabase Realtime for intraday_quotes so an open browser is pushed the
-- settler's freshly-written quotes each minute (no manual refresh needed). RLS
-- still applies: anon has SELECT (above), so read-only browsers receive events;
-- writes remain service-role only. Idempotent — skip if already published.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'intraday_quotes'
  ) then
    alter publication supabase_realtime add table public.intraday_quotes;
  end if;
end
$$;
