-- ---------------------------------------------------------------------------
-- cleanup_delisted_20260905.sql
--
-- One-off maintenance run (2026-09-05):
--   1. Deactivate 8 tickers confirmed delisted via M&A / take-private.
--   2. Rename BK -> BNY (Bank of NY Mellon changed its NYSE ticker 2026-05-21;
--      the company still trades, so we keep the position, just re-symbol it).
--   3. Remove PSTG (per owner decision) and refill every affected list back to
--      40 with liquid, on-theme, still-active names (verified not already used
--      elsewhere; a symbol belongs to exactly one list).
--
-- Removal style = DEACTIVATE (active=false), not DELETE, to keep history +
-- audit trail and mirror the app's own reconcile logic. Idempotent + atomic.
--
-- Run against the linked project:
--   supabase db query --linked -f supabase/seed/cleanup_delisted_20260905.sql
-- ---------------------------------------------------------------------------

begin;

-- 1) Deactivate confirmed-delisted tickers (+ PSTG per owner decision).
--    X    US Steel        -> Nippon Steel (Jun 2025)
--    HES  Hess            -> Chevron       (Jul 2025)
--    CTRA Coterra         -> Devon/DVN     (May 2026)
--    JNPR Juniper         -> HPE           (Jul 2025)
--    CYBR CyberArk        -> Palo Alto     (Feb 2026)
--    DFS  Discover        -> Capital One   (May 2025)
--    SMAR Smartsheet      -> Blackstone/Vista take-private (Jan 2025)
--    CFLT Confluent       -> IBM           (Mar 2026)
--    PSTG Pure Storage    -> removed per owner decision
update public.watchlist
   set active = false
 where symbol in ('X','HES','CTRA','JNPR','CYBR','DFS','SMAR','CFLT','PSTG');

-- 2) Rename BK -> BNY, preserving its owning list (Financials & Fintech).
--    symbol is the PK, so update it directly; the row keeps its watchlist_id.
update public.watchlist
   set symbol = 'BNY', active = true
 where symbol = 'BK';

-- 3) Refill each affected list to 40 with active, on-theme, still-active names.
--    Driven by a temp table -> single upsert (same pattern as the seed).
create temporary table _refill(symbol text primary key, slot int) on commit drop;

insert into _refill(symbol, slot) values
  -- Energy & Materials (slot 8): replace X, HES, CTRA
  ('BKR',8),('EQT',8),('AR',8),
  -- AI, Data & Cyber (slot 4): replace JNPR, CYBR, PSTG
  ('NTNX',4),('DT',4),('GEN',4),
  -- Financials & Fintech (slot 7): replace DFS (BK handled by rename)
  ('NU',7),
  -- Software & Cloud (slot 3): replace SMAR, CFLT
  ('ZI',3),('PCOR',3)
on conflict (symbol) do update set slot = excluded.slot;

insert into public.watchlist (symbol, active, watchlist_id)
select r.symbol, true, w.id
from _refill r
join public.watchlists w on w.slot = r.slot
on conflict (symbol) do update
  set active = true,
      watchlist_id = excluded.watchlist_id;

commit;
