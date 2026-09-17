-- ---------------------------------------------------------------------------
-- 0026_trades_position_cap_45.sql
--
-- Raise the durable active-position cap from 25 -> 45 so it matches the client
-- and the settler.
--
-- BACKGROUND (the bug this fixes): the position ceiling lives in three places
-- that must agree:
--   • client  — useBacktestPortfolio MAX_POSITIONS  (currently 45)
--   • settler — settle-positions MAX_SYMBOLS         (currently 45)
--   • database — enforce_trades_position_cap()        (was still 25, from 0023)
-- The client cap was bumped to 45 to match the settler's per-minute quote
-- ceiling, but the BEFORE INSERT trigger from 0023 was never updated. Result:
-- the UI let a user submit a 26th+ order, then the DB trigger rejected the
-- insert with a check_violation (23514) surfaced as "position limit reached" —
-- even though the app believed it was under the limit.
--
-- This migration replaces the trigger function so 45 is the single durable
-- ceiling. Invariant 1 (one active position per symbol, the unique index from
-- 0023) is unchanged.
--
-- Re-runnable: CREATE OR REPLACE + idempotent trigger re-create.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_trades_position_cap()
returns trigger
language plpgsql
as $$
declare
  -- Keep in sync with useBacktestPortfolio MAX_POSITIONS and the settler's
  -- MAX_SYMBOLS (both 45).
  max_positions constant integer := 45;
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
  'BEFORE INSERT guard: rejects new trades once the table holds MAX_POSITIONS (45) rows.';

drop trigger if exists trades_position_cap on public.trades;
create trigger trades_position_cap
  before insert on public.trades
  for each row
  execute function public.enforce_trades_position_cap();
