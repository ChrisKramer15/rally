-- ---------------------------------------------------------------------------
-- 0011_backtest_trades.sql
--
-- Moves the paper-trading portfolio (Backtest page) off browser localStorage
-- and into Supabase so it's durable, cross-device, and never subject to the
-- localStorage quota. Previously the whole portfolio lived in one localStorage
-- key (`rally.backtest.v1`); once the daily-bar cache filled the origin quota,
-- new positions silently failed to persist and vanished on refresh.
--
-- Three tables mirror the client's PersistShape:
--   * portfolio     — the single budget value (one row, id = 'default').
--   * trades        — pending (resting limit) + open (filled) positions.
--   * closed_trades — banked closed trades (the source of realized P/L).
--
-- Single-user app model (same as watchlists, migration 0003/0008): the browser
-- uses the anon key and RLS grants anon full CRUD on these tables. This is a
-- tightly-scoped risk for a personal dashboard — the rows are just paper trades.
-- If this ever becomes multi-user, replace the anon policies with
-- authenticated-only policies tied to auth.uid() + a user_id column.
--
-- Re-runnable: guarded with IF NOT EXISTS / idempotent policy drops.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- portfolio: single-row account settings. Today just the cash budget, which
-- compounds as trades are banked. Keyed by a fixed 'default' id so the client
-- always upserts the same row (single-user).
-- ---------------------------------------------------------------------------
create table if not exists public.portfolio (
  id          text primary key default 'default',
  budget      numeric(18, 2) not null default 25000,
  updated_at  timestamptz not null default now()
);

comment on table public.portfolio is
  'Single-row paper-trading account settings (budget). One row, id = default.';

-- Seed the default row so the client can update it without an insert race.
insert into public.portfolio (id, budget)
values ('default', 25000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- trades: pending (resting limit) + open (filled) positions. Columns map 1:1
-- to the client BacktestPosition. `id` is client-generated (short string) so
-- optimistic local inserts keep their id through the round-trip.
-- ---------------------------------------------------------------------------
create table if not exists public.trades (
  id            text primary key,
  symbol        text not null,
  name          text,
  -- 'long' | 'short'
  side          text not null check (side in ('long', 'short')),
  -- 'pending' (resting limit) | 'open' (filled). Closed trades move to closed_trades.
  status        text not null check (status in ('pending', 'open')),
  -- 'market' | 'limit'
  order_type    text not null check (order_type in ('market', 'limit')),
  placed_date   date not null,
  -- Null while pending (not yet filled).
  opened_date   date,
  -- Fill price per share. Null while pending.
  entry_price   numeric(18, 4),
  -- Resting limit (proximal) price. Null for market orders.
  limit_price   numeric(18, 4),
  -- Zone distal line, captured at order time (anchors the stop). Nullable.
  distal_price  numeric(18, 4),
  -- ATR at order time (sizes the stop buffer). Nullable.
  atr           numeric(18, 6),
  -- Top of the prior trend leg (anchors the cash-out target). Nullable.
  swing_target  numeric(18, 4),
  -- Fallback reward:risk multiple used when no swing level applies.
  risk_reward   numeric(10, 4) not null default 2,
  shares        integer not null check (shares >= 1),
  -- Derived managed levels (set on fill; present for pending too as a preview).
  stop_loss_price numeric(18, 4) not null,
  cash_out_price  numeric(18, 4) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.trades is
  'Paper-trading positions: pending (resting limit) + open (filled). Mirrors client BacktestPosition.';

create index if not exists trades_status_idx on public.trades (status);
create index if not exists trades_symbol_idx on public.trades (symbol);

-- ---------------------------------------------------------------------------
-- closed_trades: banked closed positions. Distinct shape from `trades` — it
-- carries the exit + realized P/L rather than the managed levels. Mirrors the
-- client ClosedTrade.
-- ---------------------------------------------------------------------------
create table if not exists public.closed_trades (
  id            text primary key,
  symbol        text not null,
  name          text,
  side          text not null check (side in ('long', 'short')),
  shares        integer not null check (shares >= 1),
  entry_price   numeric(18, 4) not null,
  exit_price    numeric(18, 4) not null,
  realized_pnl  numeric(18, 4) not null,
  opened_date   date,
  closed_date   date not null,
  created_at    timestamptz not null default now()
);

comment on table public.closed_trades is
  'Banked closed paper trades (source of realized P/L). Mirrors client ClosedTrade.';

create index if not exists closed_trades_closed_date_idx
  on public.closed_trades (closed_date desc);

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- Single-user app: the browser (anon) gets full CRUD on all three tables so it
-- can place, fill, settle, and cancel trades and adjust the budget. The
-- service role (if ever used) bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.portfolio     enable row level security;
alter table public.trades        enable row level security;
alter table public.closed_trades enable row level security;

-- portfolio: read + update (the seed row already exists; no client insert/delete).
drop policy if exists portfolio_public_read on public.portfolio;
create policy portfolio_public_read
  on public.portfolio for select
  to anon, authenticated using (true);

drop policy if exists portfolio_client_update on public.portfolio;
create policy portfolio_client_update
  on public.portfolio for update
  to anon, authenticated using (true)
  with check (budget >= 0);

-- trades: full CRUD.
drop policy if exists trades_public_read on public.trades;
create policy trades_public_read
  on public.trades for select
  to anon, authenticated using (true);

drop policy if exists trades_client_insert on public.trades;
create policy trades_client_insert
  on public.trades for insert
  to anon, authenticated
  with check (symbol ~ '^[A-Z0-9.\-]{1,10}$' and shares >= 1);

drop policy if exists trades_client_update on public.trades;
create policy trades_client_update
  on public.trades for update
  to anon, authenticated using (true)
  with check (shares >= 1);

drop policy if exists trades_client_delete on public.trades;
create policy trades_client_delete
  on public.trades for delete
  to anon, authenticated using (true);

-- closed_trades: read + insert + delete (delete lets a full reset clear history).
drop policy if exists closed_trades_public_read on public.closed_trades;
create policy closed_trades_public_read
  on public.closed_trades for select
  to anon, authenticated using (true);

drop policy if exists closed_trades_client_insert on public.closed_trades;
create policy closed_trades_client_insert
  on public.closed_trades for insert
  to anon, authenticated
  with check (symbol ~ '^[A-Z0-9.\-]{1,10}$' and shares >= 1);

drop policy if exists closed_trades_client_delete on public.closed_trades;
create policy closed_trades_client_delete
  on public.closed_trades for delete
  to anon, authenticated using (true);
