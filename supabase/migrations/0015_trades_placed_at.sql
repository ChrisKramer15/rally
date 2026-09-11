-- ---------------------------------------------------------------------------
-- 0015_trades_placed_at.sql
--
-- Add a moment-in-time anchor to paper-trading positions.
--
-- WHY:
--   Limit orders were being matched against the LATEST completed daily bar the
--   instant they were placed, so an order whose day already traded through both
--   the entry and the stop would "buy and sell" in a single pass (VRT bug).
--   Real trading rests an order and only fills on price that comes AFTER it was
--   placed. `placed_at` records the exact instant (UTC) the order was submitted;
--   the client uses its ET calendar date as the floor: a resting limit can only
--   fill on a session STRICTLY AFTER placement, and can only settle on a session
--   after the fill bar.
--
-- Stored UTC (timestamptz); the UI renders it in Eastern time.
--
-- Nullable + backfilled from placed_date so existing rows stay valid. New rows
-- always set it. Re-runnable.
-- ---------------------------------------------------------------------------

alter table public.trades
  add column if not exists placed_at timestamptz;

-- Backfill any pre-existing rows: approximate the placement instant as the
-- start of the placed_date (UTC). Good enough for old rows; new rows carry the
-- precise submit instant.
update public.trades
  set placed_at = placed_date::timestamptz
  where placed_at is null;

comment on column public.trades.placed_at is
  'Moment-in-time anchor (UTC): exact instant the order was placed. A resting limit fills only on sessions strictly after this instant''s ET date. Displayed in ET.';
