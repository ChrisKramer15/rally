-- ---------------------------------------------------------------------------
-- 0023_trades_position_limits.sql
--
-- Enforce the two paper-trading invariants at the DATABASE level, not just in
-- the browser. The client already tries to enforce both (useBacktestPortfolio:
-- MAX_POSITIONS = 25, and a per-symbol dedupe in openTrade), but those checks
-- run against in-memory React state and therefore CANNOT see rows created by
-- another tab/session or by a write that raced a hydrate. That gap let the
-- table drift to 27 pending rows — including a DUPLICATE symbol — which in turn
-- inflates the distinct-symbol set the live-quote engines poll, risking the
-- Finnhub / Tiingo rate limits. These are the durable backstops.
--
-- Invariant 1: at most ONE active (pending or open) position per symbol.
--   Matches the dominant supply & demand convention — a ticker is a single
--   thesis (reacting to a demand OR supply zone), so you're in it once. Scaling
--   into a zone is modeled as shares within that one row, not two rows.
--
-- Invariant 2: at most MAX_POSITIONS (25) rows in `trades` total (pending +
--   open combined). Mirrors the client cap and, more importantly, caps the
--   number of distinct symbols the settle/live-quote path can fan out to.
--
-- Re-runnable: guarded with IF NOT EXISTS / CREATE OR REPLACE / idempotent drops.
-- ---------------------------------------------------------------------------

-- ── Invariant 1: one active position per symbol ─────────────────────────────
-- `trades` only ever holds pending + open rows (closed positions move to
-- `closed_trades`), so a plain unique index on symbol is exactly "one active
-- position per symbol". A partial predicate isn't needed, but we normalise to
-- upper-case defensively in case a symbol is ever stored lower/mixed case.
--
-- NOTE: if any duplicate symbols still exist this index creation will fail.
-- Migration 0023 assumes the table has already been de-duplicated (it was:
-- the pileup was cleaned up before this migration was written). If a future
-- environment still has dupes, resolve them first, then apply.
create unique index if not exists trades_unique_symbol
  on public.trades (upper(symbol));

comment on index public.trades_unique_symbol is
  'One active (pending/open) position per symbol — the S&D "one thesis per ticker" rule.';

-- ── Invariant 2: hard cap on total active positions ─────────────────────────
-- A BEFORE INSERT trigger rejects any insert that would push the row count over
-- the cap. Kept in one place so it stays in sync with the client MAX_POSITIONS.
--
-- Concurrency note: this counts rows inside the trigger, so two *simultaneous*
-- inserts could in theory both observe count = 24 and both succeed (25 -> 26).
-- For a single-user paper-trading app that's a non-issue in practice — inserts
-- are user-driven and serialised — and the unique-symbol index already blocks
-- the most common duplicate path. We deliberately avoid a heavier table lock
-- rather than pay that cost for a benign edge.
create or replace function public.enforce_trades_position_cap()
returns trigger
language plpgsql
as $$
declare
  -- Keep in sync with useBacktestPortfolio MAX_POSITIONS.
  max_positions constant integer := 25;
  current_count integer;
begin
  select count(*) into current_count from public.trades;
  if current_count >= max_positions then
    raise exception
      'Position limit reached (% / %). Cancel or close an existing position before opening a new one.',
      current_count, max_positions
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_trades_position_cap() is
  'BEFORE INSERT guard: rejects new trades once the table holds MAX_POSITIONS (25) rows.';

drop trigger if exists trades_position_cap on public.trades;
create trigger trades_position_cap
  before insert on public.trades
  for each row
  execute function public.enforce_trades_position_cap();
