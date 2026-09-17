-- ---------------------------------------------------------------------------
-- 0029_trade_first_eval_invalidation.sql
--
-- Guards against the "placed a limit that instantly filled AND closed" case.
--
-- Background: the settle-positions Edge Function fills a pending LIMIT the first
-- time live price crosses it, then can settle it against the SAME price in the
-- same run. If a signal's zone was already traded through before the order was
-- placed (stale daily-close price on the Signals page), the very first live
-- quote the settler sees already satisfies the fill — so the order fills at the
-- limit and immediately stops out, booking a fake loss on a zone that was never
-- actually live.
--
-- Rule (product decision): a limit fill only counts as REAL if the order rested
-- through at least one settler run first. If it WOULD fill on the very first run
-- that evaluates it, it's invalidated instead of opened — banked as a $0 closed
-- trade so the history shows "didn't take, price already gone" rather than a
-- phantom stop-out.
--
-- This migration adds the two columns that rule needs:
--   * trades.first_evaluated_at — durable "the settler has seen this pending
--     order rest at least once" marker. Null until the first run that quotes the
--     symbol without filling; set to that run's instant thereafter. A fill is
--     only allowed once this is non-null.
--   * closed_trades.exit_reason — why a banked trade closed: 'stop' | 'target'
--     | 'invalidated'. Nullable so every trade banked before this stays valid
--     (treated as "reason unknown / legacy").
--
-- Additive + idempotent (nullable `add column if not exists`), mirroring the
-- 0015/0016/0020 style.
-- ---------------------------------------------------------------------------

-- trades: first-evaluation marker. Null while the pending order has never been
-- seen by a settler run (its first eval). Set to the run instant once it has
-- rested through a run without filling. Meaningless for market orders (born
-- open) and legacy rows (stays null; they were filled under the old engine).
alter table public.trades
  add column if not exists first_evaluated_at timestamptz;

comment on column public.trades.first_evaluated_at is
  'UTC instant the settle-positions cron first evaluated this pending limit without filling it (i.e. it rested through a run). Null on its first evaluation and for market/legacy rows. A limit fill is only honored once this is set — a would-be fill on the first evaluation is invalidated instead of opened.';

-- closed_trades: why the trade closed. 'invalidated' = a pending limit that
-- would have filled on its first evaluation (banked at $0 P/L, never opened).
alter table public.closed_trades
  add column if not exists exit_reason text;

alter table public.closed_trades drop constraint if exists closed_trades_exit_reason_check;
alter table public.closed_trades
  add constraint closed_trades_exit_reason_check
  check (exit_reason is null or exit_reason in ('stop', 'target', 'invalidated'));

comment on column public.closed_trades.exit_reason is
  'Why the trade closed: stop | target | invalidated. invalidated = a pending limit that would have filled on its first settler evaluation (never opened; realized_pnl = 0). Null for trades banked before this was tracked.';
