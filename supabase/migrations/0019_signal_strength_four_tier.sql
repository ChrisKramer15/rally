-- ---------------------------------------------------------------------------
-- 0019_signal_strength_four_tier.sql
--
-- Signals migrated from a two-tier strength scheme ('A+' | 'strong') to a
-- four-tier one ('A' | 'B' | 'C' | 'D') — see useExplosiveMoves.ts. The
-- signal_strength check constraints on public.trades and public.closed_trades
-- (added in 0012 / 0013) were never widened, so inserting a trade placed from
-- a new signal (e.g. grade 'A') fails with:
--
--   new row for relation "trades" violates check constraint
--   "trades_signal_strength_check"  (SQLSTATE 23514)
--
-- This migration widens both constraints to accept the new four-tier grades
-- while still permitting the legacy values so historical rows stay valid.
--
-- Idempotent (drop-then-add).
-- ---------------------------------------------------------------------------

alter table public.trades drop constraint if exists trades_signal_strength_check;
alter table public.trades
  add constraint trades_signal_strength_check
  check (signal_strength is null or signal_strength in ('A', 'B', 'C', 'D', 'A+', 'strong'));

alter table public.closed_trades drop constraint if exists closed_trades_signal_strength_check;
alter table public.closed_trades
  add constraint closed_trades_signal_strength_check
  check (signal_strength is null or signal_strength in ('A', 'B', 'C', 'D', 'A+', 'strong'));

comment on column public.trades.signal_strength is
  'Explosive-move (signal) strength: A | B | C | D (new four-tier), or legacy A+ | strong. Nullable.';
comment on column public.closed_trades.signal_strength is
  'Explosive-move (signal) strength carried from the position at close: A | B | C | D, or legacy A+ | strong. Nullable.';
