-- ---------------------------------------------------------------------------
-- 0028_intraday_quotes_retention.sql
--
-- Documentation-only migration: the intraday_quotes prune policy changed from a
-- blind 48-hour age cutoff to a LIFECYCLE-AWARE rule, and this updates the table
-- comment so the schema self-documents the new behavior.
--
-- The prune itself lives in the settle-positions Edge Function (persistQuotes),
-- not in SQL, so there's no trigger/cron to change here. The new rule is:
--   * Rows for a symbol that STILL has a live (pending/open) trade are NEVER
--     pruned — the full intraday history is kept for the entire life of the
--     trade so the TradeDetailModal can chart it (self-built hourly/4H candles).
--   * Once a trade closes (its `trades` row is deleted), the symbol's rows
--     become eligible and are pruned once they age past a 72h grace window, so a
--     just-closed trade stays chartable for a few days and the table stays
--     bounded.
--
-- Storage sanity: ~45 active symbols x ~390 market minutes/day is ~17.5k
-- rows/day while a position is held; a month-long trade is ~525k small rows.
-- Across the 45-position cap that's a few million rows worst case, which the
-- existing (symbol, quoted_at desc) index handles comfortably.
--
-- Idempotent: only re-sets a COMMENT; safe to re-run.
-- ---------------------------------------------------------------------------

comment on table public.intraday_quotes is
  'Near-real-time Finnhub quotes captured by settle-positions each minute for actively-traded (pending/open) symbols. Written only by the settler (service role); anon has read-only access so the browser reads live prices here (and builds hourly/4H candles for the trade detail chart) instead of calling Finnhub directly. Retention is lifecycle-aware: rows for a symbol with a live trade are kept for the whole life of the trade; after the trade closes they are pruned past a 72h grace window (see settle-positions persistQuotes / QUOTE_GRACE_HOURS).';
