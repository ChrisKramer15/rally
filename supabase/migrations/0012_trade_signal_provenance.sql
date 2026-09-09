-- ---------------------------------------------------------------------------
-- 0012_trade_signal_provenance.sql
--
-- Connects a placed paper trade back to the signal (basing zone) it was placed
-- from, so the Backtest screen can show which signal each trade came from.
--
-- Adds five nullable columns to public.trades, captured at order time:
--   * zone_kind       — 'demand' (up move → long bias) | 'supply' (down → short).
--                       The signal TYPE / direction, stored independently of
--                       `side` so it survives the user flipping the side.
--   * zone_grade      — base-quality grade: 'A+' | 'good' | 'weak'
--                       (from useBasingZones — how clean the base is).
--   * signal_strength — explosive-candle grade: 'A+' | 'strong'
--                       (from useExplosiveMoves — the move that anchored it).
--   * proximal_price  — the zone's proximal (entry) line. Recorded for market
--                       orders too (limit_price only exists for limit orders).
--   * signal_date     — the explosive move-away date (the signal's origin).
--
-- All nullable so existing rows and trades placed with no detected zone still
-- load cleanly. Re-runnable: guarded with IF NOT EXISTS.
-- ---------------------------------------------------------------------------

-- Adds the five columns to `trades` (open/pending). The matching columns on
-- `closed_trades` are added in migration 0013 (they were split out because 0012
-- had already been applied remotely by the time closed_trades needed them).
alter table public.trades
  add column if not exists zone_kind       text,
  add column if not exists zone_grade      text,
  add column if not exists signal_strength text,
  add column if not exists proximal_price  numeric(18, 4),
  add column if not exists signal_date     date;

-- Constrain the enum-like text columns to the known values (nullable-friendly:
-- the CHECK passes for NULL). Idempotent drop-then-add so the migration re-runs.
alter table public.trades drop constraint if exists trades_zone_kind_check;
alter table public.trades
  add constraint trades_zone_kind_check
  check (zone_kind is null or zone_kind in ('demand', 'supply'));

alter table public.trades drop constraint if exists trades_zone_grade_check;
alter table public.trades
  add constraint trades_zone_grade_check
  check (zone_grade is null or zone_grade in ('A+', 'good', 'weak'));

alter table public.trades drop constraint if exists trades_signal_strength_check;
alter table public.trades
  add constraint trades_signal_strength_check
  check (signal_strength is null or signal_strength in ('A+', 'strong'));

comment on column public.trades.zone_kind is
  'Signal direction/type: demand (long bias) | supply (short bias). Nullable.';
comment on column public.trades.zone_grade is
  'Basing-zone quality grade: A+ | good | weak. Nullable.';
comment on column public.trades.signal_strength is
  'Explosive-move (signal) strength: A+ | strong. Nullable.';
comment on column public.trades.proximal_price is
  'Zone proximal (entry) line captured at order time. Nullable.';
comment on column public.trades.signal_date is
  'Explosive move-away date — the signal origin. Nullable.';
