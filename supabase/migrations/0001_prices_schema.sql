-- Rally daily-bar storage schema.
--
-- Design goals:
--   * Store adjusted daily OHLCV bars for US stocks & ETFs (swing-trading model).
--   * Let the static frontend (GitHub Pages) READ bars directly via the anon key
--     with CORS handled by Supabase — this is the whole reason for the DB, since
--     Tiingo isn't CORS-enabled for browser calls.
--   * Let ONLY the server-side collector (Edge Function using the service role)
--     WRITE bars. The anon/browser key must never be able to write.
--
-- Everything here is idempotent-friendly: re-running upserts the same rows.

-- ---------------------------------------------------------------------------
-- watchlist: the symbol universe the daily collector pulls.
-- Kept server-side so the collector has a source of truth independent of any
-- one browser's localStorage. The app can sync its local watchlist up later.
-- ---------------------------------------------------------------------------
create table if not exists public.watchlist (
  symbol      text primary key,
  added_at    timestamptz not null default now(),
  -- Optional display name; the collector can backfill from the provider.
  name        text,
  -- Lets us disable a symbol without deleting its history.
  active      boolean not null default true
);

comment on table public.watchlist is
  'Symbol universe the daily collector fetches. Server-side source of truth.';

-- ---------------------------------------------------------------------------
-- prices: one adjusted daily OHLCV bar per (symbol, date).
-- ---------------------------------------------------------------------------
create table if not exists public.prices (
  symbol      text        not null,
  -- Session date (exchange local). DATE, not timestamp: these are daily bars.
  date        date        not null,
  open        numeric(18, 4) not null,
  high        numeric(18, 4) not null,
  low         numeric(18, 4) not null,
  close       numeric(18, 4) not null,
  volume      bigint      not null default 0,
  -- When this row was written/refreshed by the collector.
  updated_at  timestamptz not null default now(),
  -- One bar per symbol per day. Enables clean upserts (on conflict do update).
  constraint prices_pkey primary key (symbol, date)
);

comment on table public.prices is
  'Adjusted daily OHLCV bars. One row per (symbol, date). Written only by the collector.';

-- Fast "latest N bars for a symbol" and date-range scans (sparklines/indicators).
create index if not exists prices_symbol_date_desc_idx
  on public.prices (symbol, date desc);

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- The service_role key (used only by the Edge Function) BYPASSES RLS entirely,
-- so it can always write. We enable RLS and grant the browser (anon + any
-- signed-in user) READ-ONLY access; no insert/update/delete policies exist for
-- them, so writes from the client are denied by default.
-- ---------------------------------------------------------------------------
alter table public.prices    enable row level security;
alter table public.watchlist enable row level security;

-- Public read access to price history (safe: it's just market data).
drop policy if exists prices_public_read on public.prices;
create policy prices_public_read
  on public.prices
  for select
  to anon, authenticated
  using (true);

-- Public read access to the watchlist so the UI can show the tracked universe.
drop policy if exists watchlist_public_read on public.watchlist;
create policy watchlist_public_read
  on public.watchlist
  for select
  to anon, authenticated
  using (true);

-- NOTE: deliberately NO insert/update/delete policies for anon/authenticated.
-- All writes go through the Edge Function with the service_role key.
