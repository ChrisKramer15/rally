-- ---------------------------------------------------------------------------
-- 0020_trade_fill_exit_timestamps
--
-- The paper-trading engine is moving from a daily-bar simulation to a LIVE
-- engine: a server-side Edge Function (settle-positions) fills pending limit
-- orders and settles open positions against near-real-time Finnhub quotes,
-- running on a cron every minute during market hours. Because fills/exits now
-- happen at a live MOMENT (not just a session date), we record the exact
-- instant alongside the existing date columns.
--
-- Additive + idempotent (nullable `add column if not exists`), mirroring the
-- 0015/0016 style. Existing rows keep their date columns; the new instants are
-- null for anything placed/closed before this engine, which the UI treats as
-- "no recorded time" and falls back to the date.
-- ---------------------------------------------------------------------------

-- trades: the instant a pending limit filled → open. Null while still pending,
-- and null for legacy open rows filled under the old daily-bar simulation.
alter table public.trades
  add column if not exists filled_at timestamptz;

comment on column public.trades.filled_at is
  'UTC instant a pending limit order filled to open (live engine). Null while pending / for legacy fills.';

-- closed_trades: the fill instant and the exit instant of the banked trade.
alter table public.closed_trades
  add column if not exists opened_at timestamptz;
alter table public.closed_trades
  add column if not exists closed_at timestamptz;

comment on column public.closed_trades.opened_at is
  'UTC instant the position was filled/opened (carried from trades.filled_at). Null for legacy trades.';
comment on column public.closed_trades.closed_at is
  'UTC instant the position was exited/closed (live settle or manual close). Null for legacy trades.';
