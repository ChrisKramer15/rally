-- ---------------------------------------------------------------------------
-- 0013_closed_trades_signal_provenance.sql
--
-- 0012 added signal-provenance columns to public.trades. The matching columns
-- on public.closed_trades were added to 0012 after it had already been applied
-- to the remote DB, so they never ran there. This migration adds them to
-- closed_trades so a reviewer can correlate realized outcomes with the signal
-- a trade was placed from (zone kind / base grade / signal strength).
--
-- All nullable; idempotent (IF NOT EXISTS + drop-then-add constraints).
-- ---------------------------------------------------------------------------

alter table public.closed_trades
  add column if not exists zone_kind       text,
  add column if not exists zone_grade      text,
  add column if not exists signal_strength text,
  add column if not exists proximal_price  numeric(18, 4),
  add column if not exists signal_date     date;

alter table public.closed_trades drop constraint if exists closed_trades_zone_kind_check;
alter table public.closed_trades
  add constraint closed_trades_zone_kind_check
  check (zone_kind is null or zone_kind in ('demand', 'supply'));

alter table public.closed_trades drop constraint if exists closed_trades_zone_grade_check;
alter table public.closed_trades
  add constraint closed_trades_zone_grade_check
  check (zone_grade is null or zone_grade in ('A+', 'good', 'weak'));

alter table public.closed_trades drop constraint if exists closed_trades_signal_strength_check;
alter table public.closed_trades
  add constraint closed_trades_signal_strength_check
  check (signal_strength is null or signal_strength in ('A+', 'strong'));

comment on column public.closed_trades.zone_kind is
  'Signal direction/type carried from the position at close. Nullable.';
comment on column public.closed_trades.zone_grade is
  'Basing-zone quality grade carried from the position at close. Nullable.';
comment on column public.closed_trades.signal_strength is
  'Explosive-move (signal) strength carried from the position at close. Nullable.';
comment on column public.closed_trades.proximal_price is
  'Zone proximal (entry) line carried from the position at close. Nullable.';
comment on column public.closed_trades.signal_date is
  'Explosive move-away date carried from the position at close. Nullable.';
