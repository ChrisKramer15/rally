-- ---------------------------------------------------------------------------
-- 0016_closed_trades_detail.sql
--
-- Carry the full trade-level detail onto closed_trades so the Backtest
-- "Details" panel can show a closed trade's whole lifecycle — the managed
-- levels it was traded against and its placement timeline — the same way it
-- does for an open/pending position.
--
-- These mirror the corresponding columns on public.trades. All nullable so
-- trades banked before this was tracked stay valid. Idempotent.
-- ---------------------------------------------------------------------------

alter table public.closed_trades
  add column if not exists order_type      text,
  add column if not exists limit_price     numeric(18, 4),
  add column if not exists distal_price    numeric(18, 4),
  add column if not exists stop_loss_price numeric(18, 4),
  add column if not exists cash_out_price  numeric(18, 4),
  add column if not exists placed_date     date,
  add column if not exists placed_at       timestamptz;

alter table public.closed_trades drop constraint if exists closed_trades_order_type_check;
alter table public.closed_trades
  add constraint closed_trades_order_type_check
  check (order_type is null or order_type in ('market', 'limit'));

comment on column public.closed_trades.order_type is
  'How the order was placed (market|limit), carried from the position at close.';
comment on column public.closed_trades.stop_loss_price is
  'Managed stop-loss level the trade was exited against, carried at close.';
comment on column public.closed_trades.cash_out_price is
  'Managed cash-out (target) level, carried at close.';
comment on column public.closed_trades.placed_at is
  'Moment-in-time placement anchor (UTC), carried at close. Displayed in ET.';
